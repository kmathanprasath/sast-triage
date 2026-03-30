package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

// ─────────────────────────────────────────
// Save completed scan to SAST table
// ─────────────────────────────────────────

func saveScanToDB(scan *ScanStatus) error {
	if scan.Results == nil {
		return nil
	}

	secJSON, err := json.Marshal(scan.Results.SecurityFindings)
	if err != nil {
		return fmt.Errorf("marshal security findings: %w", err)
	}
	qualJSON, err := json.Marshal(scan.Results.QualityIssues)
	if err != nil {
		return fmt.Errorf("marshal quality issues: %w", err)
	}

	_, err = db.Exec(`
		INSERT INTO sast (
			scan_id, microservice_name, branch, scan_timestamp,
			security_findings, quality_issues
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (microservice_name, branch)
		DO UPDATE SET
			scan_id           = EXCLUDED.scan_id,
			scan_timestamp    = EXCLUDED.scan_timestamp,
			security_findings = EXCLUDED.security_findings,
			quality_issues    = EXCLUDED.quality_issues
	`,
		scan.ID,
		scan.ProjectKey,
		scan.Branch,
		scan.Results.ScanTimestamp,
		string(secJSON),
		string(qualJSON),
	)
	if err != nil {
		return fmt.Errorf("save to sast table: %w", err)
	}

	log.Printf("[%s] ✓ Saved: %s | branch: %s | security: %d | quality: %d",
		scan.ID, scan.ProjectKey, scan.Branch,
		len(scan.Results.SecurityFindings),
		len(scan.Results.QualityIssues),
	)
	return nil
}

// ─────────────────────────────────────────
// Fetch single scan by ID
// ─────────────────────────────────────────

func getScanFromDB(scanID string) (*ScanStatus, error) {
	var scan ScanStatus
	var secJSON, qualJSON sql.NullString
	var scanTimestamp time.Time

	err := db.QueryRow(`
		SELECT scan_id, microservice_name, branch, scan_timestamp,
		       security_findings, quality_issues
		FROM sast WHERE scan_id = $1
	`, scanID).Scan(
		&scan.ID, &scan.ProjectKey, &scan.Branch,
		&scanTimestamp, &secJSON, &qualJSON,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("scan not found")
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	scan.Results = &UnifiedReport{
		ProjectKey:       scan.ProjectKey,
		Branch:           scan.Branch,
		ScanTimestamp:    scanTimestamp,
		SecurityFindings: []UnifiedIssue{},
		QualityIssues:    []UnifiedIssue{},
	}
	if secJSON.Valid {
		json.Unmarshal([]byte(secJSON.String), &scan.Results.SecurityFindings)
	}
	if qualJSON.Valid {
		json.Unmarshal([]byte(qualJSON.String), &scan.Results.QualityIssues)
	}
	scan.Status = "completed"
	return &scan, nil
}

// ─────────────────────────────────────────
// Fetch paginated list of all scans
// ─────────────────────────────────────────

func getAllScansFromDB(limit, offset int) ([]*ScanStatus, int, error) {
	if limit == 0 || limit > 500 {
		limit = 50
	}

	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sast`).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count failed: %w", err)
	}

	rows, err := db.Query(`
		SELECT scan_id, microservice_name, branch, scan_timestamp,
		       security_findings, quality_issues
		FROM sast
		ORDER BY scan_timestamp DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var scans []*ScanStatus
	for rows.Next() {
		var scan ScanStatus
		var secJSON, qualJSON sql.NullString
		var scanTimestamp time.Time

		if err := rows.Scan(
			&scan.ID, &scan.ProjectKey, &scan.Branch,
			&scanTimestamp, &secJSON, &qualJSON,
		); err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}

		scan.Results = &UnifiedReport{
			ProjectKey:       scan.ProjectKey,
			Branch:           scan.Branch,
			ScanTimestamp:    scanTimestamp,
			SecurityFindings: []UnifiedIssue{},
			QualityIssues:    []UnifiedIssue{},
		}
		if secJSON.Valid {
			json.Unmarshal([]byte(secJSON.String), &scan.Results.SecurityFindings)
		}
		if qualJSON.Valid {
			json.Unmarshal([]byte(qualJSON.String), &scan.Results.QualityIssues)
		}
		scan.Status = "completed"
		scans = append(scans, &scan)
	}
	return scans, total, rows.Err()
}

// ─────────────────────────────────────────
// Delete a scan record
// ─────────────────────────────────────────

func deleteScanFromDB(scanID string) error {
	result, err := db.Exec(`DELETE FROM sast WHERE scan_id = $1`, scanID)
	if err != nil {
		return fmt.Errorf("delete failed: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("scan not found")
	}
	return nil
}

// ─────────────────────────────────────────
// Fetch all microservices for cron scanning
// ─────────────────────────────────────────

func fetchMicroservicesFromDB() ([]MicroserviceRecord, error) {
	rows, err := db.Query(`
		SELECT id, name, source_repo_url
		FROM microservices
		WHERE source_repo_url IS NOT NULL AND source_repo_url != ''
	`)
	if err != nil {
		return nil, fmt.Errorf("query microservices: %w", err)
	}
	defer rows.Close()

	var list []MicroserviceRecord
	for rows.Next() {
		var ms MicroserviceRecord
		if err := rows.Scan(&ms.ID, &ms.Name, &ms.SourceRepoURL); err != nil {
			log.Printf("scan row error: %v", err)
			continue
		}
		list = append(list, ms)
	}
	log.Printf("Fetched %d microservices from DB", len(list))
	return list, rows.Err()
}
