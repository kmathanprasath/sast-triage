package main

import (
"bytes"
"context"
"encoding/json"
"fmt"
"log"
"os"
"os/exec"
"sort"
"strings"
)

// runSemgrepScan runs semgrep locally (installed in the container).
// Set SEMGREP_RULES env to control the ruleset.
// Note: --metrics off is skipped for "auto" config since auto requires metrics.
func runSemgrepScan(
ctx context.Context,
projectDir, projectKey string,
logs *strings.Builder,
) (*SemgrepReport, string, error) {

logs.WriteString("=== Running Semgrep Security Analysis ===\n")

rulesConfig := os.Getenv("SEMGREP_RULES")
if rulesConfig == "" {
rulesConfig = "p/security-audit"
logs.WriteString("  Using default: p/security-audit\n")
}

timeout := os.Getenv("SEMGREP_TIMEOUT")
if timeout == "" {
timeout = "300"
}

logs.WriteString(fmt.Sprintf("Rules: %s\nDir: %s\n", rulesConfig, projectDir))

args := []string{
"scan",
"--config", rulesConfig,
"--json",
"--no-git-ignore",
}

// Only add --metrics off when NOT using auto (auto requires metrics to be on)
if rulesConfig != "auto" {
args = append(args, "--metrics", "off")
}

args = append(args, "--timeout", timeout)

excludes := []string{
"**/node_modules/**", "**/vendor/**", "**/dist/**",
"**/build/**", "**/target/**", "**/.git/**",
"**/venv/**", "**/__pycache__/**", "**/.semgrep/**",
}
for _, ex := range excludes {
args = append(args, "--exclude", ex)
}
args = append(args, projectDir)

log.Printf("[semgrep] config=%s dir=%s", rulesConfig, projectDir)
logs.WriteString(fmt.Sprintf("Command: semgrep %s\n", strings.Join(args, " ")))

cmd := exec.CommandContext(ctx, "semgrep", args...)
var stdout, stderr bytes.Buffer
cmd.Stdout = &stdout
cmd.Stderr = &stderr

err := cmd.Run()

if stderr.Len() > 0 {
logs.WriteString("=== Semgrep Output ===\n")
logs.WriteString(stderr.String())
logs.WriteString("\n")
}

log.Printf("[semgrep] exit=%v stdout=%d stderr=%d", err, stdout.Len(), stderr.Len())

if err != nil {
if exitErr, ok := err.(*exec.ExitError); ok {
if exitErr.ExitCode() == 2 {
logs.WriteString("Semgrep fatal error (exit 2)\n")
return nil, rulesConfig, fmt.Errorf("semgrep fatal error: %w", err)
}
// exit 1 = findings found, that is fine
}
}

if stdout.Len() == 0 {
logs.WriteString("No output from semgrep, returning empty report\n")
return emptySeemgrepReport(), rulesConfig, nil
}

var report SemgrepReport
if jerr := json.Unmarshal(stdout.Bytes(), &report); jerr != nil {
logs.WriteString(fmt.Sprintf("JSON parse failed: %v\n", jerr))
return nil, rulesConfig, fmt.Errorf("semgrep JSON parse: %w", jerr)
}

report.Summary = buildSemgrepSummary(&report)
logs.WriteString(fmt.Sprintf("Found %d findings, %d files\n",
len(report.Results), len(report.Paths.Scanned)))

return &report, rulesConfig, nil
}

func emptySeemgrepReport() *SemgrepReport {
return &SemgrepReport{
Results: []SemgrepResult{},
Summary: SemgrepSummary{
Total:      0,
BySeverity: make(map[string]int),
},
}
}

func buildSemgrepSummary(report *SemgrepReport) SemgrepSummary {
s := SemgrepSummary{
Total:      len(report.Results),
BySeverity: make(map[string]int),
ByCategory: make(map[string]int),
}
ruleCount := make(map[string]int)
ruleSev := make(map[string]string)
files := make(map[string]bool)

for _, r := range report.Results {
sev := strings.ToLower(r.Extra.Severity)
s.BySeverity[sev]++
if r.Extra.MetaData.Category != "" {
s.ByCategory[r.Extra.MetaData.Category]++
}
ruleCount[r.CheckID]++
ruleSev[r.CheckID] = sev
files[r.Path] = true
}
s.FilesWithIssues = len(files)

type ri struct {
id, sev string
count   int
}
var rules []ri
for id, cnt := range ruleCount {
rules = append(rules, ri{id, ruleSev[id], cnt})
}
sort.Slice(rules, func(i, j int) bool { return rules[i].count > rules[j].count })
for i := 0; i < len(rules) && i < 10; i++ {
s.TopRules = append(s.TopRules, TopRuleInfo{
RuleID:   rules[i].id,
Count:    rules[i].count,
Severity: rules[i].sev,
})
}
return s
}
