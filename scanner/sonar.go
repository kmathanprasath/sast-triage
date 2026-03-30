package main

import (
"bytes"
"context"
"encoding/json"
"fmt"
"io"
"log"
"net/http"
"net/url"
"os/exec"
"strconv"
"strings"
"time"
)

// runSonarScanner runs sonar-scanner locally (installed in the container).
func runSonarScanner(
ctx context.Context,
dir, projectKey string,
logs *strings.Builder,
) (int, error) {

logs.WriteString("=== SonarQube Analysis ===\n")

if sonarToken == "" && (sonarUsername == "" || sonarPassword == "") {
logs.WriteString("No SonarQube credentials configured, skipping\n")
return -1, fmt.Errorf("sonar credentials not configured")
}

logs.WriteString(fmt.Sprintf("URL:     %s\n", SONARQUBE_URL))
logs.WriteString(fmt.Sprintf("Project: %s\n", projectKey))

args := []string{
"-Dsonar.projectKey=" + projectKey,
"-Dsonar.sources=.",
"-Dsonar.sourceEncoding=UTF-8",
"-Dsonar.host.url=" + SONARQUBE_URL,
"-Dsonar.token=" + sonarToken,
}

cmd := exec.CommandContext(ctx, "sonar-scanner", args...)
cmd.Dir = dir
var stdout, stderr bytes.Buffer
cmd.Stdout = &stdout
cmd.Stderr = &stderr

log.Printf("[sonar] Starting analysis for project: %s", projectKey)
err := cmd.Run()

if stdout.Len() > 0 {
logs.WriteString("\n=== SonarQube Output ===\n")
logs.WriteString(stdout.String())
}
if stderr.Len() > 0 {
logs.WriteString("\n=== SonarQube Stderr ===\n")
logs.WriteString(stderr.String())
}

exitCode := 0
if err != nil {
if exitErr, ok := err.(*exec.ExitError); ok {
exitCode = exitErr.ExitCode()
}
log.Printf("[sonar] exit=%d err=%v", exitCode, err)
}
return exitCode, err
}

// waitForSonarQubeResults retries fetching results up to maxAttempts (10s gap each).
func waitForSonarQubeResults(projectKey string, maxAttempts int) (*SonarQubeReport, error) {
if sonarToken == "" && (sonarUsername == "" || sonarPassword == "") {
return emptySonarReport(projectKey), nil
}

var lastReport *SonarQubeReport
var lastErr error

for attempt := 1; attempt <= maxAttempts; attempt++ {
log.Printf("   SonarQube fetch attempt %d/%d", attempt, maxAttempts)
report, err := fetchSonarQubeResults(projectKey)
if err == nil && (report.Issues.Total > 0 || len(report.Metrics.Metrics) > 0) {
log.Printf("   SonarQube results ready: %d issues", report.Issues.Total)
return report, nil
}
lastReport = report
lastErr = err
if attempt < maxAttempts {
time.Sleep(10 * time.Second)
}
}

if lastReport != nil {
return lastReport, lastErr
}
return emptySonarReport(projectKey), lastErr
}

func emptySonarReport(projectKey string) *SonarQubeReport {
return &SonarQubeReport{
ProjectInfo: ProjectInfo{Key: projectKey},
Issues:      IssuesReport{Summary: IssuesSummary{}},
}
}

// fetchSonarQubeResults fetches all issues (paginated) + metrics from SonarQube API.
func fetchSonarQubeResults(projectKey string) (*SonarQubeReport, error) {
client := &http.Client{Timeout: 30 * time.Second}
base := strings.TrimSuffix(SONARQUBE_URL, "/") + "/api"

report := &SonarQubeReport{
ProjectInfo: ProjectInfo{Key: projectKey, Name: projectKey},
Issues:      IssuesReport{Summary: IssuesSummary{}},
}

var allIssues []Issue
pageSize := 500
for page := 1; page <= 100; page++ {
issuesURL := fmt.Sprintf("%s/issues/search?componentKeys=%s&ps=%d&p=%d",
base, url.QueryEscape(projectKey), pageSize, page)

body, status, err := sonarAPIRequest(client, issuesURL)
if err != nil {
if status == 401 || status == 403 {
return nil, fmt.Errorf("sonarqube auth failed: HTTP %d", status)
}
break
}

var result struct {
Total  int     `json:"total"`
Issues []Issue `json:"issues"`
}
if err := json.Unmarshal(body, &result); err != nil {
break
}
allIssues = append(allIssues, result.Issues...)
if len(allIssues) >= result.Total {
break
}
}

report.Issues.Total = len(allIssues)
report.Issues.Issues = allIssues

for _, issue := range allIssues {
switch issue.Severity {
case "BLOCKER":
report.Issues.Summary.Blocker++
case "CRITICAL":
report.Issues.Summary.Critical++
}
if issue.Type == "VULNERABILITY" {
report.Issues.Summary.Vulnerability++
} else if issue.Type == "CODE_SMELL" {
report.Issues.Summary.CodeSmell++
}
}

metricsURL := fmt.Sprintf(
"%s/measures/component?component=%s&metricKeys=coverage,sqale_index,sqale_rating",
base, url.QueryEscape(projectKey))

if body, status, err := sonarAPIRequest(client, metricsURL); err == nil && status == 200 {
var result struct {
Component struct {
Measures []Metric `json:"measures"`
} `json:"component"`
}
if json.Unmarshal(body, &result) == nil {
for _, m := range result.Component.Measures {
switch m.Key {
case "coverage":
report.Coverage.LineCoverage, _ = strconv.ParseFloat(m.Value, 64)
case "sqale_index":
report.TechnicalDebt.TotalDebt = m.Value
case "sqale_rating":
report.TechnicalDebt.Maintainability = m.Value
}
}
report.Metrics.Metrics = result.Component.Measures
}
}

log.Printf("   SonarQube: %d issues fetched", len(allIssues))
return report, nil
}

func sonarAPIRequest(client *http.Client, apiURL string) ([]byte, int, error) {
req, err := http.NewRequest("GET", apiURL, nil)
if err != nil {
return nil, 0, err
}

if sonarToken != "" {
req.SetBasicAuth(sonarToken, "")
} else if sonarUsername != "" && sonarPassword != "" {
req.SetBasicAuth(sonarUsername, sonarPassword)
} else {
return nil, 0, fmt.Errorf("no auth credentials")
}

req.Header.Set("Accept", "application/json")

resp, err := client.Do(req)
if err != nil {
return nil, 0, err
}
defer resp.Body.Close()

body, err := io.ReadAll(resp.Body)
if err != nil {
return nil, resp.StatusCode, err
}

ct := resp.Header.Get("Content-Type")
if strings.Contains(ct, "text/html") ||
strings.HasPrefix(strings.TrimSpace(string(body)), "<") {
return body, resp.StatusCode, fmt.Errorf("received HTML (likely auth error)")
}

if resp.StatusCode == 401 {
return body, 401, fmt.Errorf("unauthorized")
}
if resp.StatusCode == 403 {
return body, 403, fmt.Errorf("forbidden")
}
if resp.StatusCode != 200 {
return body, resp.StatusCode, fmt.Errorf("HTTP %d", resp.StatusCode)
}

return body, 200, nil
}
