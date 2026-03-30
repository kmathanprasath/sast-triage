package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ─────────────────────────────────────────
// In-memory scan status for in-flight scans
// ─────────────────────────────────────────

var (
	activeScansMu sync.RWMutex
	activeScans   = map[string]*ScanStatus{}
)

func setActiveScan(s *ScanStatus) {
	activeScansMu.Lock()
	activeScans[s.ID] = s
	activeScansMu.Unlock()
}

func getActiveScan(id string) (*ScanStatus, bool) {
	activeScansMu.RLock()
	s, ok := activeScans[id]
	activeScansMu.RUnlock()
	return s, ok
}

func removeActiveScan(id string) {
	activeScansMu.Lock()
	delete(activeScans, id)
	activeScansMu.Unlock()
}

const (
	tempDir       = "./temp_unified_scans"
	maxScanTime   = 45 * time.Minute
	defaultBranch = "main"
)

// ─────────────────────────────────────────
// Enqueue — put scan on goroutine pool
// ─────────────────────────────────────────

func enqueueScan(scanID, repoURL, branch, projectKey, scanType string) {
	// Register immediately so /scan/:id returns status right away
	s := &ScanStatus{
		ID:         scanID,
		Status:     "queued",
		ProjectKey: projectKey,
		Branch:     branch,
		ScanType:   scanType,
		StartTime:  time.Now(),
	}
	setActiveScan(s)

	scanSemaphore <- struct{}{}
	go func() {
		defer func() { <-scanSemaphore }()
		performScan(scanID, repoURL, branch, projectKey, scanType)
	}()
}

// ─────────────────────────────────────────
// Full scan pipeline
// ─────────────────────────────────────────

func performScan(scanID, repoURL, branch, projectKey, scanType string) {
	scanDir := filepath.Join(tempDir, scanID)
	absDir, _ := filepath.Abs(scanDir)

	ctx, cancel := context.WithTimeout(context.Background(), maxScanTime)
	defer cancel()
	defer os.RemoveAll(scanDir)

	var logs strings.Builder

	updateStatus := func(stage string) {
		if s, ok := getActiveScan(scanID); ok {
			s.Status = stage
		}
	}

	// ── 1. Clone ──────────────────────────
	updateStatus("cloning")
	log.Printf("[%s] Cloning %s @ %s", scanID, repoURL, branch)
	logs.WriteString(fmt.Sprintf("repo: %s\nbranch: %s\n\n", repoURL, branch))

	if err := cloneRepo(ctx, repoURL, absDir, branch); err != nil {
		log.Printf("[%s] Clone failed: %v", scanID, err)
		saveFailed(scanID, projectKey, branch, err)
		if s, ok := getActiveScan(scanID); ok {
			s.Status = "failed"
			s.Error = err.Error()
		}
		return
	}

	// ── 2. Semgrep ────────────────────────
	updateStatus("scanning")
	log.Printf("[%s] Running Semgrep", scanID)
	semgrepReport, _, err := runSemgrepScan(ctx, absDir, projectKey, &logs)
	if err != nil {
		log.Printf("[%s] Semgrep error (continuing): %v", scanID, err)
		semgrepReport = emptySeemgrepReport()
	}

	// ── 3. SonarQube ─────────────────────
	updateStatus("sonar")
	log.Printf("[%s] Running SonarQube", scanID)
	sonarExitCode, sonarErr := runSonarScanner(ctx, absDir, projectKey, &logs)

	sonarDone := sonarErr == nil || sonarExitCode == 3 // 3 = quality gate fail but analysis ok
	if sonarErr != nil && sonarExitCode != 3 {
		log.Printf("[%s] SonarQube failed (exit %d): %v", scanID, sonarExitCode, sonarErr)
	}

	// ── 4. Fetch SonarQube results ────────
	var sonarReport *SonarQubeReport
	if sonarDone {
		log.Printf("[%s] Fetching SonarQube results", scanID)
		sonarReport, _ = waitForSonarQubeResults(projectKey, 6)
	}
	if sonarReport == nil {
		sonarReport = emptySonarReport(projectKey)
	}

	// ── 5. Unify ──────────────────────────
	updateStatus("unifying")
	log.Printf("[%s] Unifying reports", scanID)
	unified := unifyReports(semgrepReport, sonarReport, projectKey, branch)

	// ── 6. Save to DB ─────────────────────
	updateStatus("clustering")
	scan := &ScanStatus{
		ID:         scanID,
		ProjectKey: projectKey,
		Branch:     branch,
		Status:     "completed",
		Results:    unified,
	}
	if err := saveScanToDB(scan); err != nil {
		log.Printf("[%s] DB save failed: %v", scanID, err)
	}

	log.Printf("[%s] Done: security=%d quality=%d dedup=%.1f%%",
		scanID,
		unified.Summary.SecurityIssuesCount,
		unified.Summary.QualityIssuesCount,
		unified.DeduplicationInfo.DeduplicationRate,
	)

	// Mark completed in memory then clean up after a delay
	updateStatus("completed")
	go func() {
		time.Sleep(5 * time.Minute)
		removeActiveScan(scanID)
	}()

	// ── 7. Notify intelligence service ───
	go notifyIntelligence(projectKey, branch)
}

// ─────────────────────────────────────────
// Notify the Python intelligence service
// Calls /recluster which runs ALL three steps:
//   1. root cause clustering
//   2. compound risk scoring  ← the novelty
//   3. AI triage digest
// ─────────────────────────────────────────

func notifyIntelligence(microservice, branch string) {
	intelligenceURL := os.Getenv("INTELLIGENCE_URL")
	if intelligenceURL == "" {
		intelligenceURL = "http://intelligence:8000"
	}

	// /recluster runs cluster + score + triage in one shot
	endpoint := fmt.Sprintf("%s/recluster/%s?branch=%s",
		intelligenceURL,
		url.PathEscape(microservice),
		url.QueryEscape(branch),
	)

	// Give the DB write a moment to commit
	time.Sleep(2 * time.Second)

	resp, err := http.Post(endpoint, "application/json", bytes.NewBufferString("{}"))
	if err != nil {
		log.Printf("[intelligence] notify failed for %s: %v", microservice, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		log.Printf("[intelligence] ✓ cluster + score + triage complete for %s", microservice)
	} else {
		log.Printf("[intelligence] recluster returned HTTP %d for %s", resp.StatusCode, microservice)
	}
}

// ─────────────────────────────────────────
// Clone repo using Docker alpine/git
// ─────────────────────────────────────────

func cloneRepo(ctx context.Context, repoURL, targetDir, branch string) error {
	os.MkdirAll(targetDir, 0755)

	// Inject GitHub token for private repos
	cloneURL := repoURL
	if githubToken != "" && strings.Contains(repoURL, "github.com") {
		parsed, _ := url.Parse(repoURL)
		parsed.User = url.UserPassword("token", githubToken)
		cloneURL = parsed.String()
	}

	cmd := exec.CommandContext(ctx, "git", "clone", "-b", branch, "--depth", "1", cloneURL, targetDir)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Fallback: try "master" then "main" if custom branch not found
		if branch != "master" {
			log.Printf("Branch '%s' not found, falling back to 'master'", branch)
			cmd2 := exec.CommandContext(ctx, "git", "clone", "-b", "master", "--depth", "1", cloneURL, targetDir)
			if cmd2.Run() == nil {
				return nil
			}
		}
		if branch != "main" {
			log.Printf("Branch '%s' not found, falling back to 'main'", branch)
			cmd3 := exec.CommandContext(ctx, "git", "clone", "-b", "main", "--depth", "1", cloneURL, targetDir)
			if cmd3.Run() == nil {
				return nil
			}
		}
		return fmt.Errorf("clone failed: %s", stderr.String())
	}
	return nil
}

// ─────────────────────────────────────────
// Save a failed scan marker to logs
// (not persisted to SAST table, just logged)
// ─────────────────────────────────────────

func saveFailed(scanID, projectKey, branch string, err error) {
	log.Printf("[%s] SCAN FAILED — project=%s branch=%s error=%v",
		scanID, projectKey, branch, err)
}

// ─────────────────────────────────────────
// Cron: scan all microservices on main branch
// ─────────────────────────────────────────

func scheduledMainBranchScan() {
	log.Println("═══ SCHEDULED SCAN STARTED ═══")
	microservices, err := fetchMicroservicesFromDB()
	if err != nil {
		log.Printf("Scheduled scan: DB error: %v", err)
		return
	}
	if len(microservices) == 0 {
		log.Println("Scheduled scan: no microservices registered")
		return
	}

	for _, ms := range microservices {
		scanID := newUUID()
		projectKey := sanitizeProjectKey(ms.Name)
		enqueueScan(scanID, ms.SourceRepoURL, defaultBranch, projectKey, "cron")
		log.Printf("  Queued: %s", ms.Name)
		time.Sleep(2 * time.Second) // stagger to avoid Docker rate limits
	}
	log.Printf("═══ SCHEDULED SCAN: %d jobs queued ═══", len(microservices))
}


