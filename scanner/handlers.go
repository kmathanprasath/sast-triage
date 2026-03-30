package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// ─────────────────────────────────────────
// POST /scan  — trigger a manual scan
// ─────────────────────────────────────────

func handleStartScan(c *gin.Context) {
	var req ScanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo_url and branch are required"})
		return
	}
	if err := validateRepoURL(req.RepoURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repo: " + err.Error()})
		return
	}
	if err := validateBranch(req.Branch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid branch: " + err.Error()})
		return
	}

	scanID := newUUID()
	projectKey := generateProjectKey(req.RepoURL)

	enqueueScan(scanID, req.RepoURL, req.Branch, projectKey, "manual")

	c.JSON(http.StatusAccepted, gin.H{
		"scan_id":     scanID,
		"status":      "accepted",
		"project":     projectKey,
		"branch":      req.Branch,
		"status_url":  fmt.Sprintf("/scan/%s", scanID),
		"report_url":  fmt.Sprintf("/scan/%s/report", scanID),
		"digest_url":  fmt.Sprintf("http://intelligence:8000/digest/%s", projectKey),
		"message":     "Scan queued. Intelligence clustering will trigger automatically on completion.",
	})
}

// ─────────────────────────────────────────
// GET /scan/:scan_id — poll scan status
// ─────────────────────────────────────────

func handleGetScanStatus(c *gin.Context) {
	scanID := c.Param("scan_id")

	// Check in-memory first (covers in-flight scans)
	if s, ok := getActiveScan(scanID); ok {
		c.JSON(http.StatusOK, s)
		return
	}

	// Fall back to DB (completed scans)
	scan, err := getScanFromDB(scanID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return
	}
	c.JSON(http.StatusOK, scan)
}

// ─────────────────────────────────────────
// GET /scan/:scan_id/report — full report
// ─────────────────────────────────────────

func handleGetReport(c *gin.Context) {
	scanID := c.Param("scan_id")
	scan, err := getScanFromDB(scanID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return
	}
	if scan.Results == nil {
		c.JSON(http.StatusAccepted, gin.H{
			"status":  "not_ready",
			"message": "scan is still in progress",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scan_id":      scanID,
		"project":      scan.ProjectKey,
		"branch":       scan.Branch,
		"report":       scan.Results,
		"generated_at": time.Now(),
	})
}

// ─────────────────────────────────────────
// GET /scan/:scan_id/report/download
// ─────────────────────────────────────────

func handleDownloadReport(c *gin.Context) {
	scanID := c.Param("scan_id")
	scan, err := getScanFromDB(scanID)
	if err != nil || scan.Results == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no results found"})
		return
	}
	data, _ := json.MarshalIndent(scan.Results, "", "  ")
	filename := fmt.Sprintf("vaultscan-report-%s-%s.json", scan.ProjectKey, scanID[:8])
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.Data(http.StatusOK, "application/json", data)
}

// ─────────────────────────────────────────
// DELETE /scan/:scan_id
// ─────────────────────────────────────────

func handleDeleteScan(c *gin.Context) {
	scanID := c.Param("scan_id")
	scan, err := getScanFromDB(scanID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return
	}
	if err := deleteScanFromDB(scanID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status":  "deleted",
		"scan_id": scanID,
		"project": scan.ProjectKey,
	})
}

// ─────────────────────────────────────────
// GET /scans — list all scans
// ─────────────────────────────────────────

func handleListScans(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	scans, total, err := getAllScansFromDB(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch scans"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"total":  total,
		"limit":  limit,
		"offset": offset,
		"scans":  scans,
	})
}

// ─────────────────────────────────────────
// POST /scan/trigger — manual cron trigger
// ─────────────────────────────────────────

func handleTriggerCronScan(c *gin.Context) {
	go scheduledMainBranchScan()
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "accepted",
		"message": "main branch scan triggered for all registered microservices",
	})
}

// ─────────────────────────────────────────
// GET /cron/status
// ─────────────────────────────────────────

func handleCronStatus(c *gin.Context) {
	schedule := cronSchedule()
	var nextRun *time.Time
	if cronScheduler != nil {
		next := cronScheduler.Entry(cronJobID).Next
		if !next.IsZero() {
			nextRun = &next
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":  true,
		"schedule": schedule,
		"next_run": nextRun,
		"branch":   defaultBranch,
	})
}

// ─────────────────────────────────────────
// POST /microservice — register a repo
// ─────────────────────────────────────────

func handleRegisterMicroservice(c *gin.Context) {
	var body struct {
		Name          string `json:"name"           binding:"required"`
		SourceRepoURL string `json:"source_repo_url" binding:"required"`
		Description   string `json:"description"`
		Team          string `json:"team"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateRepoURL(body.SourceRepoURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repo URL: " + err.Error()})
		return
	}

	var id int
	err := db.QueryRow(`
		INSERT INTO microservices (name, source_repo_url, description, team)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (name) DO UPDATE SET
			source_repo_url = EXCLUDED.source_repo_url,
			description     = EXCLUDED.description,
			team            = EXCLUDED.team,
			updated_at      = NOW()
		RETURNING id
	`, body.Name, body.SourceRepoURL, body.Description, body.Team).Scan(&id)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":      id,
		"name":    body.Name,
		"status":  "registered",
		"message": "Microservice registered. It will be scanned on the next cron run.",
	})
}

// ─────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────

func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":     "healthy",
		"service":    "scanner",
		"semgrep":    "enabled",
		"sonarqube":  sonarToken != "",
		"database":   "connected",
		"version":    "1.0.0",
	})
}
