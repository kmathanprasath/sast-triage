// ── Intelligence API types ────────────────

export interface RootCause {
  cluster_id:      string
  rule_family:     string
  origin_file:     string
  origin_line:     number
  severity:        'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  blast_radius:    number
  effort_estimate: 'QUICK_WIN' | 'MEDIUM' | 'HARD'
  urgency_score:   number
  is_accelerating: boolean
}

export interface FixItem {
  rank:               number
  cluster_id:         string
  rule_family:        string
  origin_file:        string
  why_dangerous:      string
  exact_fix:          string
  effort:             string
  blast_radius:       number
  kills_issues:       number
  kills_files?:       number
  total_files?:       number
  validation_status?: 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative' | 'unreviewed'
  validation_note?:   string
}

export interface DigestReport {
  microservice:        string
  cached:              boolean
  total_findings:      number
  total_clusters:      number
  headline:            string
  summary:             string
  fix_these_first:     FixItem[]
  total_fixable_top5:  number
  ai_triage?:          boolean
  minimum_fixes?:      number
}

export interface HistoryPoint {
  sprint:          string
  blast_radius:    number
  growth_rate_pct: number
  projected_next:  number
}

export interface ClusterTrend {
  cluster_id:       string
  rule_family:      string
  origin_file:      string
  severity:         string
  is_accelerating:  boolean
  urgency_score:    number
  doubles_in_days:  number | null
  fix_cost_today:   string
  fix_cost_in_30d:  string
  history:          HistoryPoint[]
}

export interface DebtTrend {
  microservice:          string
  branch:                string
  accelerating_clusters: ClusterTrend[]
  stable_clusters:       ClusterTrend[]
  total_clusters:        number
  accelerating_count:    number
  summary: {
    message:              string
    accelerating_count:   number
    top_urgent_cluster?:  string
    top_urgent_rule?:     string
    top_urgent_file?:     string
    top_doubles_in_days?: number
  }
}

export interface ServiceSummary {
  microservice_name:  string
  branch:             string
  cluster_count:      number
  total_blast_radius: number
  max_urgency:        number
  accelerating_count: number
  last_scanned:       string
}

export interface FindingItem {
  id:           string
  file:         string
  line:         number
  column:       number
  severity:     string
  rule_id:      string
  description:  string
  cwe:          string[]
  owasp:        string[]
  detected_by:  string[]
  code_snippet: string
}

export interface ClusterDetail {
  cluster_id:        string
  rule_family:       string
  origin_file:       string
  origin_line:       number
  severity:          string
  blast_radius:      number
  effort_estimate:   string
  urgency_score:     number
  is_accelerating:   boolean
  validation_status: string
  validation_note:   string | null
  justification:     string
  findings:          FindingItem[]
  affected_files:    string[]
}

export interface AllFindingsResponse {
  microservice: string
  branch:       string
  total:        number
  page:         number
  per_page:     number
  pages:        number
  clusters:     ClusterDetail[]
}
