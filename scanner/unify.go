package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ─────────────────────────────────────────
// Merge Semgrep + SonarQube into one report
// with smart deduplication
// ─────────────────────────────────────────

func unifyReports(
	semgrep *SemgrepReport,
	sonar *SonarQubeReport,
	projectKey, branch string,
) *UnifiedReport {

	report := &UnifiedReport{
		ProjectKey:       projectKey,
		Branch:           branch,
		ScanTimestamp:    time.Now(),
		SemgrepDetails:   semgrep,
		SonarQubeDetails: sonar,
	}

	issueMap := make(map[string]*UnifiedIssue)
	fpToKey := make(map[string]string)

	// ── Process Semgrep findings ──────────
	semgrepCount := 0
	for _, r := range semgrep.Results {
		if r.Extra.IsIgnored {
			continue
		}
		fp := strictFingerprint(r.Path, r.Start.Line, r.CheckID, r.Extra.Message)
		key := "sg-" + fp

		conf := r.Extra.MetaData.Confidence
		if conf == "" {
			conf = "MEDIUM"
		}

		issue := &UnifiedIssue{
			ID:          key,
			Type:        "security",
			Severity:    normalizeSeverity(r.Extra.Severity),
			Priority:    getPriority(r.Extra.Severity),
			Title:       r.CheckID,
			Description: r.Extra.Message,
			File:        r.Path,
			Line:        r.Start.Line,
			Column:      r.Start.Col,
			Category:    r.Extra.MetaData.Category,
			CWE:         r.Extra.MetaData.CWE,
			OWASP:       r.Extra.MetaData.OWASP,
			Confidence:  conf,
			DetectedBy:  []string{"semgrep"},
			RuleID:      r.CheckID,
			References:  r.Extra.MetaData.References,
			CodeSnippet: r.Extra.Lines,
		}

		if !isFalsePositive(issue) {
			issueMap[key] = issue
			fpToKey[fp] = key
			semgrepCount++
		}
	}

	// ── Process SonarQube findings ────────
	sonarCount := 0
	overlapCount := 0

	for _, si := range sonar.Issues.Issues {
		file := extractFilePath(si.Component)
		line := si.Line
		if line <= 0 {
			line = 1
		}

		isSec := si.Type == "VULNERABILITY" || si.Type == "SECURITY_HOTSPOT"
		issueType := "quality"
		if isSec {
			issueType = "security"
		}

		// Try strict match first
		sfp := strictFingerprint(file, line, si.Rule, si.Message)
		if existingKey, found := fpToKey[sfp]; found {
			if existing := issueMap[existingKey]; existing != nil {
				existing.DetectedBy = append(existing.DetectedBy, "sonarqube")
				if existing.Effort == "" {
					existing.Effort = si.Effort
				}
				existing.Confidence = "HIGH"
				boostSeverityForOverlap(existing)
				overlapCount++
				sonarCount++
				continue
			}
		}

		// Try loose (fuzzy) match
		lfp := looseFingerprint(file, si.Rule, si.Message)
		if existingKey, found := fpToKey[lfp]; found {
			if existing := issueMap[existingKey]; existing != nil {
				existing.DetectedBy = append(existing.DetectedBy, "sonarqube")
				if existing.Effort == "" {
					existing.Effort = si.Effort
				}
				existing.Confidence = "HIGH"
				boostSeverityForOverlap(existing)
				overlapCount++
				sonarCount++
				continue
			}
		}

		// New unique finding from SonarQube
		key := "sq-" + sfp
		issue := &UnifiedIssue{
			ID:          key,
			Type:        issueType,
			Severity:    normalizeSeverity(si.Severity),
			Priority:    getPriority(si.Severity),
			Title:       si.Rule,
			Description: si.Message,
			File:        file,
			Line:        line,
			Effort:      si.Effort,
			DetectedBy:  []string{"sonarqube"},
			RuleID:      si.Rule,
			Confidence:  "MEDIUM",
		}

		if !isFalsePositive(issue) {
			issueMap[key] = issue
			fpToKey[sfp] = key
			sonarCount++
		}
	}

	// ── Separate and sort ─────────────────
	var security, quality []UnifiedIssue
	for _, issue := range issueMap {
		if len(issue.DetectedBy) > 1 && issue.Priority > 1 {
			issue.Priority--
		}
		if issue.Type == "security" {
			security = append(security, *issue)
		} else {
			quality = append(quality, *issue)
		}
	}

	rankFn := func(issues []UnifiedIssue) {
		sort.Slice(issues, func(i, j int) bool {
			if issues[i].Priority != issues[j].Priority {
				return issues[i].Priority < issues[j].Priority
			}
			confScore := map[string]int{"HIGH": 3, "MEDIUM": 2, "LOW": 1}
			return confScore[issues[i].Confidence] > confScore[issues[j].Confidence]
		})
	}
	rankFn(security)
	rankFn(quality)

	report.SecurityFindings = security
	report.QualityIssues = quality
	report.Summary = buildUnifiedSummary(security, quality, sonar)

	unique := len(security) + len(quality)
	total := semgrepCount + sonarCount
	dedupRate := 0.0
	if total > 0 {
		dedupRate = float64(overlapCount) / float64(total) * 100
	}
	report.DeduplicationInfo = DeduplicationStats{
		SemgrepFindings:   semgrepCount,
		SonarQubeFindings: sonarCount,
		OverlapCount:      overlapCount,
		UniqueFindings:    unique,
		DeduplicationRate: dedupRate,
	}

	log.Printf("  Dedup: semgrep=%d sonar=%d overlap=%d unique=%d rate=%.1f%%",
		semgrepCount, sonarCount, overlapCount, unique, dedupRate)

	return report
}

// ─────────────────────────────────────────
// Fingerprinting
// ─────────────────────────────────────────

func strictFingerprint(file string, line int, ruleID, message string) string {
	file = strings.ToLower(strings.TrimPrefix(file, "./"))
	data := fmt.Sprintf("%s:%d:%s:%s",
		file, line, normalizeRuleID(ruleID), normalizeMessageStrict(message))
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:8])
}

func looseFingerprint(file, ruleID, message string) string {
	file = strings.ToLower(strings.TrimPrefix(file, "./"))
	data := fmt.Sprintf("%s:%s:%s",
		file, normalizeRuleID(ruleID), normalizeMessageLoose(message))
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:8])
}

func normalizeRuleID(ruleID string) string {
	ruleID = strings.ToLower(strings.TrimSpace(ruleID))
	patterns := map[string]string{
		"sql":           "sql-injection",
		"sqli":          "sql-injection",
		"xss":           "xss",
		"csrf":          "csrf",
		"path-traversal": "path-traversal",
		"command":       "command-injection",
		"xxe":           "xxe",
		"ssrf":          "ssrf",
		"insecure-random": "weak-crypto",
		"hardcoded":     "hardcoded-secret",
		"deserialization": "insecure-deserialization",
	}
	for pattern, normalized := range patterns {
		if strings.Contains(ruleID, pattern) {
			return normalized
		}
	}
	return ruleID
}

func normalizeMessageStrict(msg string) string {
	if msg == "" {
		return ""
	}
	msg = strings.ToLower(strings.TrimSpace(msg))
	msg = regexp.MustCompile(`\bat\s+line\s+\d+\b`).ReplaceAllString(msg, "lineX")
	msg = regexp.MustCompile(`['"][^'"]{0,50}['"]`).ReplaceAllString(msg, `"VAL"`)
	msg = regexp.MustCompile(`https?://[^\s)]+`).ReplaceAllString(msg, "URL")
	msg = regexp.MustCompile(`v?\d+\.\d+\.\d+`).ReplaceAllString(msg, "VERSION")
	msg = regexp.MustCompile(`\s+`).ReplaceAllString(msg, " ")
	if len(msg) > 150 {
		msg = msg[:150]
	}
	return msg
}

func normalizeMessageLoose(msg string) string {
	msg = normalizeMessageStrict(msg)
	for _, w := range []string{" and ", " or ", "the ", "a ", "is ", "was "} {
		msg = strings.ReplaceAll(msg, w, " ")
	}
	for _, p := range []string{".", ",", ";", ":", "-", "_", "/"} {
		msg = strings.ReplaceAll(msg, p, " ")
	}
	msg = regexp.MustCompile(`\s+`).ReplaceAllString(msg, " ")
	if len(msg) > 150 {
		msg = msg[:150]
	}
	return strings.TrimSpace(msg)
}

// ─────────────────────────────────────────
// Severity helpers
// ─────────────────────────────────────────

func normalizeSeverity(sev string) string {
	switch strings.ToUpper(sev) {
	case "ERROR", "BLOCKER":
		return "CRITICAL"
	case "WARNING", "MAJOR":
		return "HIGH"
	case "MINOR":
		return "MEDIUM"
	case "INFO":
		return "LOW"
	default:
		return strings.ToUpper(sev)
	}
}

func getPriority(sev string) int {
	switch normalizeSeverity(sev) {
	case "CRITICAL":
		return 1
	case "HIGH":
		return 2
	case "MEDIUM":
		return 3
	case "LOW":
		return 4
	default:
		return 5
	}
}

func boostSeverityForOverlap(issue *UnifiedIssue) {
	if len(issue.DetectedBy) > 1 {
		switch issue.Severity {
		case "LOW":
			issue.Severity = "MEDIUM"
			issue.Priority = 3
		case "MEDIUM":
			issue.Severity = "HIGH"
			issue.Priority = 2
		case "HIGH":
			issue.Severity = "CRITICAL"
			issue.Priority = 1
		}
	}
}

// ─────────────────────────────────────────
// False positive filter
// ─────────────────────────────────────────

func isFalsePositive(issue *UnifiedIssue) bool {
	msg := strings.ToLower(issue.Description)
	if strings.Contains(msg, "test") && strings.Contains(msg, "password") {
		return true
	}
	if strings.Contains(msg, "example") && strings.Contains(msg, "hardcoded") {
		return true
	}
	return false
}

// ─────────────────────────────────────────
// Summary builder
// ─────────────────────────────────────────

func buildUnifiedSummary(
	security, quality []UnifiedIssue,
	sonar *SonarQubeReport,
) UnifiedSummary {

	s := UnifiedSummary{
		SecurityIssuesCount: len(security),
		QualityIssuesCount:  len(quality),
		TotalIssues:         len(security) + len(quality),
		BySeverity:          make(map[string]int),
		ByTool:              make(map[string]int),
	}

	cweMap := make(map[string]int)
	owaspMap := make(map[string]int)

	for _, issue := range append(security, quality...) {
		s.BySeverity[issue.Severity]++
		for _, tool := range issue.DetectedBy {
			s.ByTool[tool]++
		}
		switch issue.Priority {
		case 1:
			s.CriticalCount++
		case 2:
			s.HighCount++
		case 3:
			s.MediumCount++
		case 4:
			s.LowCount++
		}
		for _, cwe := range issue.CWE {
			cweMap[cwe]++
		}
		for _, owasp := range issue.OWASP {
			owaspMap[owasp]++
		}
	}

	for cwe, count := range cweMap {
		s.TopCWEs = append(s.TopCWEs, CWECount{cwe, count})
	}
	sort.Slice(s.TopCWEs, func(i, j int) bool {
		return s.TopCWEs[i].Count > s.TopCWEs[j].Count
	})
	if len(s.TopCWEs) > 10 {
		s.TopCWEs = s.TopCWEs[:10]
	}

	for owasp, count := range owaspMap {
		s.TopOWASPs = append(s.TopOWASPs, OWASPCount{owasp, count})
	}
	sort.Slice(s.TopOWASPs, func(i, j int) bool {
		return s.TopOWASPs[i].Count > s.TopOWASPs[j].Count
	})
	if len(s.TopOWASPs) > 10 {
		s.TopOWASPs = s.TopOWASPs[:10]
	}

	s.QualityMetrics = QualityMetricsSummary{
		TechnicalDebt:         sonar.TechnicalDebt.TotalDebt,
		CodeSmells:            sonar.Issues.Summary.CodeSmell,
		Coverage:              sonar.Coverage.LineCoverage,
		MaintainabilityRating: sonar.TechnicalDebt.Maintainability,
	}
	return s
}

// ─────────────────────────────────────────
// Utility
// ─────────────────────────────────────────

func extractFilePath(component string) string {
	parts := strings.Split(component, ":")
	if len(parts) > 1 {
		return parts[len(parts)-1]
	}
	return component
}


