package main

import (
	"encoding/json"
	"time"
)

// ─────────────────────────────────────────
// Database models
// ─────────────────────────────────────────

type MicroserviceRecord struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	SourceRepoURL string `json:"source_repo_url"`
}

// ─────────────────────────────────────────
// Scan lifecycle
// ─────────────────────────────────────────

type ScanRequest struct {
	RepoURL string `json:"repo_url" binding:"required"`
	Branch  string `json:"branch"   binding:"required"`
}

type ScanStatus struct {
	ID         string         `json:"id"`
	Status     string         `json:"status"`
	ProjectKey string         `json:"project_key"`
	Branch     string         `json:"branch"`
	ScanType   string         `json:"scan_type"`
	StartTime  time.Time      `json:"start_time"`
	EndTime    time.Time      `json:"end_time,omitempty"`
	Error      string         `json:"error,omitempty"`
	Results    *UnifiedReport `json:"results,omitempty"`
}

// ─────────────────────────────────────────
// Semgrep types
// ─────────────────────────────────────────

type SemgrepReport struct {
	Results []SemgrepResult `json:"results"`
	Paths   struct {
		Scanned []string `json:"scanned"`
	} `json:"paths"`
	Summary SemgrepSummary `json:"summary"`
}

type SemgrepResult struct {
	CheckID string `json:"check_id"`
	Path    string `json:"path"`
	Start   struct {
		Line int `json:"line"`
		Col  int `json:"col"`
	} `json:"start"`
	End struct {
		Line int `json:"line"`
		Col  int `json:"col"`
	} `json:"end"`
	Extra struct {
		Severity  string `json:"severity"`
		Message   string `json:"message"`
		IsIgnored bool   `json:"is_ignored"`
		Lines     string `json:"lines"`
		MetaData  struct {
			Category   string        `json:"category"`
			CWE        StringOrArray `json:"cwe"`
			OWASP      StringOrArray `json:"owasp"`
			Confidence string        `json:"confidence"`
			References StringOrArray `json:"references"`
		} `json:"metadata"`
	} `json:"extra"`
}

type SemgrepSummary struct {
	Total           int            `json:"total"`
	BySeverity      map[string]int `json:"by_severity"`
	ByCategory      map[string]int `json:"by_category"`
	FilesWithIssues int            `json:"files_with_issues"`
	TopRules        []TopRuleInfo  `json:"top_rules"`
}

type TopRuleInfo struct {
	RuleID   string `json:"rule_id"`
	Count    int    `json:"count"`
	Severity string `json:"severity"`
}

// StringOrArray handles semgrep fields that are sometimes a
// string and sometimes a []string in the JSON output.
type StringOrArray []string

func (soa *StringOrArray) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		if s != "" {
			*soa = []string{s}
		}
		return nil
	}
	var arr []string
	if err := json.Unmarshal(data, &arr); err != nil {
		return err
	}
	*soa = arr
	return nil
}

// ─────────────────────────────────────────
// SonarQube types
// ─────────────────────────────────────────

type SonarQubeReport struct {
	ProjectInfo   ProjectInfo   `json:"project_info"`
	Issues        IssuesReport  `json:"issues"`
	Coverage      Coverage      `json:"coverage"`
	TechnicalDebt TechnicalDebt `json:"technical_debt"`
	Metrics       struct {
		Metrics []Metric `json:"metrics"`
	} `json:"metrics"`
}

type ProjectInfo struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type IssuesReport struct {
	Total   int           `json:"total"`
	Issues  []Issue       `json:"issues"`
	Summary IssuesSummary `json:"summary"`
}

type Issue struct {
	Key       string `json:"key"`
	Rule      string `json:"rule"`
	Severity  string `json:"severity"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Component string `json:"component"`
	Line      int    `json:"line"`
	Effort    string `json:"effort"`
}

type IssuesSummary struct {
	Blocker       int `json:"blocker"`
	Critical      int `json:"critical"`
	Vulnerability int `json:"vulnerability"`
	CodeSmell     int `json:"code_smell"`
}

type Coverage struct {
	LineCoverage float64 `json:"line_coverage"`
}

type TechnicalDebt struct {
	TotalDebt       string `json:"total_debt"`
	Maintainability string `json:"maintainability"`
}

type Metric struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ─────────────────────────────────────────
// Unified report — output of the scanner
// consumed by the intelligence service
// ─────────────────────────────────────────

type UnifiedReport struct {
	ProjectKey        string              `json:"project_key"`
	Branch            string              `json:"branch"`
	ScanTimestamp     time.Time           `json:"scan_timestamp"`
	SemgrepDetails    *SemgrepReport      `json:"semgrep_details"`
	SonarQubeDetails  *SonarQubeReport    `json:"sonarqube_details"`
	SecurityFindings  []UnifiedIssue      `json:"security_findings"`
	QualityIssues     []UnifiedIssue      `json:"quality_issues"`
	Summary           UnifiedSummary      `json:"summary"`
	DeduplicationInfo DeduplicationStats  `json:"deduplication_info"`
}

type UnifiedIssue struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Severity    string   `json:"severity"`
	Priority    int      `json:"priority"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	File        string   `json:"file"`
	Line        int      `json:"line"`
	Column      int      `json:"column,omitempty"`
	Category    string   `json:"category,omitempty"`
	CWE         []string `json:"cwe,omitempty"`
	OWASP       []string `json:"owasp,omitempty"`
	Confidence  string   `json:"confidence"`
	DetectedBy  []string `json:"detected_by"`
	RuleID      string   `json:"rule_id"`
	Effort      string   `json:"effort,omitempty"`
	References  []string `json:"references,omitempty"`
	CodeSnippet string   `json:"code_snippet,omitempty"`
}

type UnifiedSummary struct {
	SecurityIssuesCount int            `json:"security_issues_count"`
	QualityIssuesCount  int            `json:"quality_issues_count"`
	TotalIssues         int            `json:"total_issues"`
	CriticalCount       int            `json:"critical_count"`
	HighCount           int            `json:"high_count"`
	MediumCount         int            `json:"medium_count"`
	LowCount            int            `json:"low_count"`
	BySeverity          map[string]int `json:"by_severity"`
	ByTool              map[string]int `json:"by_tool"`
	TopCWEs             []CWECount     `json:"top_cwes"`
	TopOWASPs           []OWASPCount   `json:"top_owasps"`
	QualityMetrics      QualityMetricsSummary `json:"quality_metrics"`
}

type CWECount struct {
	CWE   string `json:"cwe"`
	Count int    `json:"count"`
}

type OWASPCount struct {
	OWASP string `json:"owasp"`
	Count int    `json:"count"`
}

type QualityMetricsSummary struct {
	TechnicalDebt         string  `json:"technical_debt"`
	CodeSmells            int     `json:"code_smells"`
	Coverage              float64 `json:"coverage"`
	MaintainabilityRating string  `json:"maintainability_rating"`
}

type DeduplicationStats struct {
	SemgrepFindings   int     `json:"semgrep_findings"`
	SonarQubeFindings int     `json:"sonarqube_findings"`
	OverlapCount      int     `json:"overlap_count"`
	UniqueFindings    int     `json:"unique_findings"`
	DeduplicationRate float64 `json:"deduplication_rate"`
}
