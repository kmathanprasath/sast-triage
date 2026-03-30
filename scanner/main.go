package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/robfig/cron/v3"
)

// ─────────────────────────────────────────
// Globals
// ─────────────────────────────────────────

var (
	db            *sql.DB
	sonarToken    string
	sonarUsername string
	sonarPassword string
	githubToken   string
	SONARQUBE_URL string
	cronScheduler *cron.Cron
	cronJobID     cron.EntryID
	scanSemaphore = make(chan struct{}, 5)
)

// ─────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────

func main() {
	// Load .env (ignore error — env vars may already be set via Docker)
	_ = godotenv.Load("../.env")

	if err := initDB(); err != nil {
		log.Fatalf("DB init failed: %v", err)
	}
	defer db.Close()

	initCron()
	defer func() {
		if cronScheduler != nil {
			cronScheduler.Stop()
		}
	}()

	os.MkdirAll(tempDir, 0755)

	r := gin.Default()
	registerRoutes(r)

	printBanner()
	log.Fatal(r.Run(":5000"))
}

// ─────────────────────────────────────────
// Database connection
// ─────────────────────────────────────────

func initDB() error {
	host     := getEnv("DB_HOST", "localhost")
	port     := getEnv("DB_PORT", "5432")
	user     := getEnv("DB_USER", "debtscan")
	password := getEnv("DB_PASSWORD", "debtscan123")
	dbname   := getEnv("DB", getEnv("DB_NAME", "debtscan"))

	sonarToken    = os.Getenv("SONAR_TOKEN")
	sonarUsername = os.Getenv("SONAR_USERNAME")
	sonarPassword = os.Getenv("SONAR_PASSWORD")
	githubToken   = os.Getenv("GITHUB_TOKEN")
	SONARQUBE_URL = getEnv("SONARQUBE_URL", "http://sonarqube:9000")

	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname,
	)

	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	if err = db.Ping(); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}

	log.Printf("✓ Connected to PostgreSQL: %s@%s/%s", user, host, dbname)
	return nil
}

// ─────────────────────────────────────────
// Routes
// ─────────────────────────────────────────

func registerRoutes(r *gin.Engine) {
	// Scan management
	r.POST("/scan",                          handleStartScan)
	r.POST("/scan/trigger",                  handleTriggerCronScan)
	r.GET("/scan/:scan_id",                  handleGetScanStatus)
	r.GET("/scan/:scan_id/report",           handleGetReport)
	r.GET("/scan/:scan_id/report/download",  handleDownloadReport)
	r.DELETE("/scan/:scan_id",               handleDeleteScan)
	r.GET("/scans",                          handleListScans)

	// Microservice registry
	r.POST("/microservice", handleRegisterMicroservice)

	// Cron
	r.GET("/cron/status", handleCronStatus)

	// Health
	r.GET("/health", handleHealth)
}

// ─────────────────────────────────────────
// Cron scheduler
// ─────────────────────────────────────────

func initCron() {
	cronScheduler = cron.New()
	schedule := cronSchedule()
	enabled := getEnv("SCAN_CRON_ENABLED", "true")

	if enabled == "true" {
		var err error
		cronJobID, err = cronScheduler.AddFunc(schedule, scheduledMainBranchScan)
		if err != nil {
			log.Printf("Cron setup failed: %v", err)
			return
		}
		cronScheduler.Start()
		log.Printf("✓ Cron scanner enabled — schedule: %s", schedule)
		log.Printf("  Next run: %v", cronScheduler.Entry(cronJobID).Next)
	} else {
		log.Println("  Cron scanner disabled (SCAN_CRON_ENABLED=false)")
	}
}

func cronSchedule() string {
	s := os.Getenv("SCAN_CRON_SCHEDULE")
	if s == "" {
		return "0 3 * * *" // 3am daily
	}
	return s
}

// ─────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────

func validateRepoURL(repoURL string) error {
	allowed := []string{"github.com", "gitlab.com", "bitbucket.org"}
	parsed, err := url.Parse(repoURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("only http/https allowed")
	}
	for _, domain := range allowed {
		if parsed.Host == domain || strings.HasSuffix(parsed.Host, "."+domain) {
			if strings.ContainsAny(repoURL, `; "|&()<>`) {
				return fmt.Errorf("invalid characters in URL")
			}
			return nil
		}
	}
	return fmt.Errorf("unsupported domain — allowed: github.com, gitlab.com, bitbucket.org")
}

func validateBranch(branch string) error {
	if !regexp.MustCompile(`^[a-zA-Z0-9/_.-]+$`).MatchString(branch) {
		return fmt.Errorf("invalid branch name characters")
	}
	if strings.Contains(branch, "..") {
		return fmt.Errorf("path traversal not allowed")
	}
	return nil
}

// ─────────────────────────────────────────
// Project key helpers
// ─────────────────────────────────────────

func generateProjectKey(repoURL string) string {
	parsed, err := url.Parse(repoURL)
	if err != nil {
		return sanitizeProjectKey(repoURL)
	}
	path := strings.TrimSuffix(strings.Trim(parsed.Path, "/"), ".git")
	if path == "" {
		path = parsed.Host
	}
	return sanitizeProjectKey(path)
}

func sanitizeProjectKey(name string) string {
	key := regexp.MustCompile(`[^a-zA-Z0-9_\-.:]+`).ReplaceAllString(name, "-")
	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9]`, key); !matched {
		key = "project-" + key
	}
	return key
}

// ─────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func newUUID() string {
	return uuid.New().String()
}

// ─────────────────────────────────────────
// Startup banner
// ─────────────────────────────────────────

func printBanner() {
	log.Println("")
	log.Println("╔══════════════════════════════════════════════╗")
	log.Println("║          VaultScan — Scanner Service         ║")
	log.Println("╚══════════════════════════════════════════════╝")
	log.Println("")
	log.Println("  Endpoints:")
	log.Println("   POST /scan                      trigger scan")
	log.Println("   POST /microservice               register repo")
	log.Println("   GET  /scan/:id/report            unified findings")
	log.Println("   GET  /scans                      list all scans")
	log.Println("   GET  /health                     health check")
	log.Println("")
	log.Println("  Intelligence service auto-clusters after each scan.")
	log.Println("  Digest + debt trend: http://localhost:8000")
	log.Println("  Dashboard:           http://localhost:3000")
	log.Println("")
}
