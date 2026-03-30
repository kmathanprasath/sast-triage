"""
clusterer.py — Two-Level Root Cause Clustering Engine

Level 1: PATTERN GROUP (the actionable unit)
  - Groups ALL findings by rule_family (the vulnerable code pattern)
  - One pattern group = one fix action that cascades across all affected files
  - e.g. "innerHTML without sanitization" → 307 findings across 176 files

Level 2: FILE CLUSTERS (stored in root_cause_clusters, linked to pattern group)
  - Per-file breakdown within each pattern group
  - Used for drill-down: "which 176 files need this fix?"

The developer sees Level 1: "Fix 6 patterns → resolves all 254 issues"
They drill into Level 2 to see exactly which files to touch.
"""

import json
import hashlib
from collections import defaultdict
from datetime import datetime


def estimate_effort(total_files: int, rule_family: str) -> str:
    """Effort to fix the PATTERN across all files."""
    if rule_family in ("hardcoded-secret", "weak-crypto", "insecure-random"):
        return "QUICK_WIN"
    if total_files <= 3:
        return "QUICK_WIN"
    if total_files <= 15:
        return "MEDIUM"
    return "HARD"  # many files = architectural/shared-lib fix


RULE_FAMILY_MAP = {
    "sql":        "sql-injection",
    "sqli":       "sql-injection",
    "xss":        "xss",
    "cross-site": "xss",
    "csrf":       "csrf",
    "path":       "path-traversal",
    "traversal":  "path-traversal",
    "command":    "command-injection",
    "exec":       "command-injection",
    "xxe":        "xxe",
    "ssrf":       "ssrf",
    "crypto":     "weak-crypto",
    "md5":        "weak-crypto",
    "sha1":       "weak-crypto",
    "random":     "insecure-random",
    "hardcoded":  "hardcoded-secret",
    "secret":     "hardcoded-secret",
    "password":   "hardcoded-secret",
    "token":      "hardcoded-secret",
    "auth":       "auth-failure",
    "deserializ": "insecure-deserialization",
    "root":       "container-privilege",
    "privilege":  "container-privilege",
    "tls":        "weak-tls",
    "ssl":        "weak-tls",
}

def normalize_rule_family(rule_id: str, cwe_list: list) -> str:
    rule_lower = rule_id.lower()
    for key, family in RULE_FAMILY_MAP.items():
        if key in rule_lower:
            return family
    if cwe_list:
        return f"cwe-{str(cwe_list[0]).replace('CWE-', '').lower()}"
    return rule_lower[:60]


def make_pattern_id(microservice: str, rule_family: str) -> str:
    """Stable ID for a pattern group."""
    raw = f"pattern:{microservice}:{rule_family}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def make_cluster_id(microservice: str, rule_family: str, origin_file: str) -> str:
    """Stable ID for a per-file cluster."""
    raw = f"{microservice}:{rule_family}:{origin_file}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def run_clustering(db_pool, microservice_name: str, branch: str = "main"):
    row = await db_pool.fetchrow("""
        SELECT scan_id, security_findings, quality_issues, scan_timestamp
        FROM sast
        WHERE microservice_name = $1 AND branch = $2
        ORDER BY scan_timestamp DESC LIMIT 1
    """, microservice_name, branch)

    if not row:
        return {"error": f"No scan found for {microservice_name} on branch {branch}"}

    security = _parse_jsonb(row["security_findings"])
    quality  = _parse_jsonb(row["quality_issues"])
    all_findings = security + quality

    if not all_findings:
        return {"microservice": microservice_name, "clusters": [], "total_findings": 0}

    # ── Step 1: Group by rule_family (pattern level) ──────────────────────────
    # pattern_key → { file_path → [findings] }
    pattern_groups: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    pattern_severity: dict[str, str] = {}
    sev_order = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}

    for finding in all_findings:
        rule_id   = finding.get("rule_id", "")
        file_path = finding.get("file", "") or "unknown"
        cwe_list  = finding.get("cwe", [])
        severity  = finding.get("severity", "LOW")

        rule_family = normalize_rule_family(rule_id, cwe_list)
        pattern_groups[rule_family][file_path].append(finding)

        # Track highest severity per pattern
        existing = pattern_severity.get(rule_family, "LOW")
        if sev_order.get(severity, 0) > sev_order.get(existing, 0):
            pattern_severity[rule_family] = severity

    # ── Step 2: Build per-file clusters AND pattern-level summary ─────────────
    now = datetime.utcnow()
    all_clusters = []       # per-file clusters for DB
    pattern_summary = []    # pattern-level summary for response

    for rule_family, file_map in pattern_groups.items():
        total_issues = sum(len(findings) for findings in file_map.values())
        total_files  = len(file_map)
        severity     = pattern_severity.get(rule_family, "LOW")
        effort       = estimate_effort(total_files, rule_family)
        pattern_id   = make_pattern_id(microservice_name, rule_family)

        # Find the highest-blast-radius file as the "origin" (most impactful fix)
        origin_file, origin_findings = max(file_map.items(), key=lambda x: len(x[1]))
        origin_line = origin_findings[0].get("line", 0) if origin_findings else 0

        # Build per-file clusters
        file_clusters = []
        for file_path, findings in sorted(file_map.items(), key=lambda x: -len(x[1])):
            cluster_id = make_cluster_id(microservice_name, rule_family, file_path)
            file_clusters.append({
                "cluster_id":        cluster_id,
                "pattern_id":        pattern_id,   # links back to pattern group
                "microservice_name": microservice_name,
                "branch":            branch,
                "rule_family":       rule_family,
                "origin_file":       file_path,
                "origin_line":       findings[0].get("line", 0),
                "severity":          severity,
                "blast_radius":      len(findings),
                "affected_files":    [file_path],
                "findings":          findings,
                "effort_estimate":   "QUICK_WIN" if len(findings) <= 3 else effort,
                "urgency_score":     _calculate_urgency(len(findings), severity, effort),
                "is_accelerating":   False,
            })
            all_clusters.append(file_clusters[-1])

        pattern_summary.append({
            "pattern_id":    pattern_id,
            "rule_family":   rule_family,
            "severity":      severity,
            "total_issues":  total_issues,
            "total_files":   total_files,
            "effort":        effort,
            "origin_file":   origin_file,
            "urgency_score": _calculate_urgency(total_issues, severity, effort),
            "file_clusters": file_clusters,
        })

    # Sort patterns by urgency (most impactful first)
    pattern_summary.sort(key=lambda x: (x["urgency_score"], x["total_issues"]), reverse=True)
    all_clusters.sort(key=lambda x: x["urgency_score"], reverse=True)

    # ── Step 3: Persist per-file clusters to DB ───────────────────────────────
    async with db_pool.acquire() as conn:
        await conn.execute("""
            DELETE FROM root_cause_clusters
            WHERE microservice_name = $1 AND branch = $2
        """, microservice_name, branch)

        for rc in all_clusters:
            await conn.execute("""
                INSERT INTO root_cause_clusters (
                    cluster_id, microservice_name, branch, scan_timestamp,
                    rule_family, origin_file, origin_line, severity,
                    blast_radius, affected_files, findings,
                    effort_estimate, urgency_score, is_accelerating
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT (cluster_id, microservice_name, branch)
                DO UPDATE SET
                    scan_timestamp = EXCLUDED.scan_timestamp,
                    blast_radius   = EXCLUDED.blast_radius,
                    findings       = EXCLUDED.findings,
                    urgency_score  = EXCLUDED.urgency_score,
                    severity       = EXCLUDED.severity
            """,
                rc["cluster_id"], rc["microservice_name"], rc["branch"],
                now, rc["rule_family"], rc["origin_file"], rc["origin_line"],
                rc["severity"], rc["blast_radius"],
                json.dumps(rc["affected_files"]),
                json.dumps(rc["findings"]),
                rc["effort_estimate"], rc["urgency_score"],
                rc["is_accelerating"],
            )

        for rc in all_clusters:
            await conn.execute("""
                INSERT INTO cluster_history (
                    cluster_id, microservice_name, branch, scan_timestamp,
                    blast_radius, severity, rule_family, origin_file, affected_file_count
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            """,
                rc["cluster_id"], rc["microservice_name"], rc["branch"],
                now, rc["blast_radius"], rc["severity"],
                rc["rule_family"], rc["origin_file"], 1,
            )

    total_findings = len(all_findings)
    total_patterns = len(pattern_summary)

    return {
        "microservice":    microservice_name,
        "branch":          branch,
        "total_findings":  total_findings,
        "total_clusters":  len(all_clusters),
        "total_patterns":  total_patterns,
        "message":         f"Fix {total_patterns} patterns → resolves all {total_findings} issues",
        "pattern_summary": [
            {
                "pattern_id":   p["pattern_id"],
                "rule_family":  p["rule_family"],
                "severity":     p["severity"],
                "total_issues": p["total_issues"],
                "total_files":  p["total_files"],
                "effort":       p["effort"],
                "urgency_score": p["urgency_score"],
            }
            for p in pattern_summary
        ],
    }


def _parse_jsonb(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def _calculate_urgency(blast_radius: int, severity: str, effort: str) -> int:
    score = 0
    if blast_radius >= 100: score += 4
    elif blast_radius >= 30: score += 3
    elif blast_radius >= 10: score += 2
    else:                    score += 1

    sev_scores = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    score += sev_scores.get(severity, 1)

    effort_modifier = {"QUICK_WIN": 2, "MEDIUM": 1, "HARD": 0}
    score += effort_modifier.get(effort, 0)

    return min(score, 10)
