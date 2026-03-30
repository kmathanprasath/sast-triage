"""
triage.py — AI Triage via Gemini

The core insight: show the developer the MINIMUM set of pattern fixes
that cascade to resolve ALL issues.

"Fix 6 patterns → resolves 454 issues across 254 files"
"Pattern #1: Apply DOMPurify → kills 307 XSS across 176 files"
"""

import json
import os
from datetime import datetime, timezone
import google.generativeai as genai

_api_key = os.getenv("GEMINI_API_KEY", "")
if _api_key:
    genai.configure(api_key=_api_key)


def _build_triage_prompt(microservice: str, patterns: list, total_findings: int) -> str:
    pattern_text = ""
    for i, p in enumerate(patterns[:10], 1):
        # Sample a few file names to show spread
        files_sample = p.get("files_sample", [])[:4]
        files_str = "\n    ".join(f.split("/")[-1] for f in files_sample)
        if p.get("total_files", 0) > 4:
            files_str += f"\n    ... and {p['total_files'] - 4} more files"

        pattern_text += f"""
Pattern #{i}: {p['rule_family']}
  Severity:     {p['severity']}
  Total issues: {p['total_issues']} findings across {p['total_files']} files
  Effort:       {p['effort']}
  Urgency:      {p['urgency_score']}/10
  Sample files affected:
    {files_str}
  Sample finding description: {p.get('sample_description', 'N/A')}
"""

    return f"""You are a senior AppSec engineer reviewing SAST results for: {microservice}

Total findings: {total_findings}
Distinct vulnerability patterns: {len(patterns)}

KEY INSIGHT: These are not {total_findings} separate bugs. They are {len(patterns)} repeating patterns.
Fixing the ROOT PATTERN once cascades to resolve ALL instances of that pattern.

Here are the patterns ranked by impact:
{pattern_text}

Your task — for EACH pattern:
1. Identify the ONE root fix that cascades to resolve ALL instances
2. Explain WHY fixing this pattern kills all those issues (the cascade mechanism)
3. Give the EXACT code-level fix (library to use, method to replace, config to add)
4. Estimate realistic effort to apply this fix across all affected files

Respond ONLY as valid JSON, no markdown:
{{
  "executive_summary": "2-3 sentences: total scope, the cascade insight, recommended priority",
  "patterns": [
    {{
      "rank": 1,
      "pattern_id": "...",
      "rule_family": "...",
      "total_issues": 0,
      "total_files": 0,
      "cascade_explanation": "Fixing X in file Y cascades because all N files use the same pattern Z. One fix propagates everywhere.",
      "root_fix": "Exact code-level instruction: replace X with Y, add library Z, change config W",
      "effort_realistic": "e.g. 2 hours to add DOMPurify import to shared utils, then 30 min to update each file",
      "effort_label": "QUICK_WIN|MEDIUM|HARD",
      "kills_issues": 0,
      "kills_files": 0
    }}
  ],
  "total_fixable": 0,
  "minimum_fixes_needed": 0
}}"""


async def get_or_generate_digest(db_pool, microservice_name: str, branch: str):
    """Returns cached digest if fresh (< 1 hour), else generates new one."""
    cached = await db_pool.fetchrow("""
        SELECT plain_english_summary, top_clusters_json, generated_at
        FROM digest_reports
        WHERE microservice_name = $1 AND branch = $2
    """, microservice_name, branch)

    if cached:
        age_hours = (datetime.now(timezone.utc) - cached["generated_at"].replace(tzinfo=timezone.utc)).seconds / 3600
        if age_hours < 1:
            top = cached["top_clusters_json"]
            if isinstance(top, str):
                top = json.loads(top or "[]")
            top = top or []

            # Re-enrich with live cluster_ids + validation_status
            live_clusters = await db_pool.fetch("""
                SELECT cluster_id, rule_family, blast_radius, validation_status
                FROM root_cause_clusters
                WHERE microservice_name = $1 AND branch = $2
            """, microservice_name, branch)
            rule_to_live = {r["rule_family"]: r for r in live_clusters}
            for item in top:
                matched = rule_to_live.get(item.get("rule_family", ""))
                if matched:
                    item["cluster_id"]        = matched["cluster_id"]
                    item["blast_radius"]      = matched["blast_radius"]
                    item["kills_issues"]      = matched["blast_radius"]
                    item["validation_status"] = matched.get("validation_status", "unreviewed")

            # Get pattern-level stats
            pattern_stats = await db_pool.fetch("""
                SELECT rule_family,
                       COUNT(*) as file_count,
                       SUM(blast_radius) as total_issues
                FROM root_cause_clusters
                WHERE microservice_name = $1 AND branch = $2
                GROUP BY rule_family
                ORDER BY total_issues DESC
            """, microservice_name, branch)

            total_findings = sum(r["total_issues"] for r in pattern_stats)
            total_patterns = len(pattern_stats)
            total_fixable  = sum(c.get("kills_issues", 0) for c in top)

            return {
                "microservice":       microservice_name,
                "cached":             True,
                "generated_at":       cached["generated_at"].isoformat(),
                "total_findings":     total_findings,
                "total_clusters":     total_patterns,
                "headline":           f"Fix {total_patterns} patterns → resolves all {total_findings} issues",
                "summary":            cached["plain_english_summary"],
                "fix_these_first":    top,
                "total_fixable_top5": total_fixable,
                "ai_triage":          True,
            }

    return await generate_fresh_digest(db_pool, microservice_name, branch)


async def generate_fresh_digest(db_pool, microservice_name: str, branch: str):
    """Calls Gemini with pattern-level data and caches the result."""

    # Get pattern-level aggregation
    pattern_rows = await db_pool.fetch("""
        SELECT rule_family,
               COUNT(*) as file_count,
               SUM(blast_radius) as total_issues,
               MAX(urgency_score) as urgency_score,
               MAX(severity) as severity,
               MAX(effort_estimate) as effort
        FROM root_cause_clusters
        WHERE microservice_name = $1 AND branch = $2
        GROUP BY rule_family
        ORDER BY SUM(blast_radius) DESC
    """, microservice_name, branch)

    if not pattern_rows:
        return {"error": "No clusters found. Run /cluster first."}

    # For each pattern, get sample files and a sample finding description
    patterns = []
    for pr in pattern_rows:
        sample_files = await db_pool.fetch("""
            SELECT origin_file, blast_radius, findings
            FROM root_cause_clusters
            WHERE microservice_name = $1 AND branch = $2 AND rule_family = $3
            ORDER BY blast_radius DESC LIMIT 5
        """, microservice_name, branch, pr["rule_family"])

        files_sample = [r["origin_file"] for r in sample_files]
        sample_desc = ""
        if sample_files:
            findings_raw = sample_files[0]["findings"]
            if isinstance(findings_raw, str):
                findings_raw = json.loads(findings_raw or "[]")
            if findings_raw:
                sample_desc = findings_raw[0].get("description", "")[:200]

        patterns.append({
            "rule_family":       pr["rule_family"],
            "total_issues":      pr["total_issues"],
            "total_files":       pr["file_count"],
            "severity":          pr["severity"],
            "effort":            pr["effort"],
            "urgency_score":     pr["urgency_score"],
            "files_sample":      files_sample,
            "sample_description": sample_desc,
        })

    total_findings = sum(p["total_issues"] for p in patterns)

    # Fallback if no API key
    if not os.getenv("GEMINI_API_KEY"):
        return _rule_based_digest(microservice_name, patterns, total_findings)

    # Call Gemini
    prompt = _build_triage_prompt(microservice_name, patterns, total_findings)
    try:
        model = genai.GenerativeModel("gemini-flash-lite-latest")
        response = model.generate_content(prompt)
        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        triage = json.loads(raw)
    except Exception:
        return _rule_based_digest(microservice_name, patterns, total_findings)

    # Map pattern_ids and real cluster_ids back into Gemini's response
    pattern_map = {p["rule_family"]: p for p in patterns}

    # Get one representative cluster_id per rule_family (highest blast radius)
    rep_clusters = await db_pool.fetch("""
        SELECT DISTINCT ON (rule_family) rule_family, cluster_id, blast_radius, validation_status
        FROM root_cause_clusters
        WHERE microservice_name = $1 AND branch = $2
        ORDER BY rule_family, blast_radius DESC
    """, microservice_name, branch)
    rule_to_cluster = {r["rule_family"]: r for r in rep_clusters}

    fix_list = []
    for item in triage.get("patterns", []):
        rf = item.get("rule_family", "")
        p  = pattern_map.get(rf, {})
        rc = rule_to_cluster.get(rf, {})
        fix_list.append({
            "rank":              item.get("rank", 0),
            "cluster_id":        rc.get("cluster_id", ""),
            "rule_family":       rf,
            "origin_file":       p.get("files_sample", [""])[0] if p.get("files_sample") else "",
            "why_dangerous":     item.get("cascade_explanation", ""),
            "exact_fix":         item.get("root_fix", ""),
            "effort":            item.get("effort_label", p.get("effort", "MEDIUM")),
            "blast_radius":      p.get("total_issues", 0),
            "kills_issues":      item.get("kills_issues", p.get("total_issues", 0)),
            "kills_files":       item.get("kills_files", p.get("total_files", 0)),
            "total_files":       p.get("total_files", 0),
            "validation_status": rc.get("validation_status", "unreviewed"),
        })

    total_fixable = sum(f["kills_issues"] for f in fix_list)

    # Cache
    await db_pool.execute("""
        INSERT INTO digest_reports (
            microservice_name, branch, generated_at,
            total_findings, total_clusters, fixable_by_top_n, top_n,
            plain_english_summary, top_clusters_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (microservice_name, branch)
        DO UPDATE SET
            generated_at          = EXCLUDED.generated_at,
            total_findings        = EXCLUDED.total_findings,
            total_clusters        = EXCLUDED.total_clusters,
            fixable_by_top_n      = EXCLUDED.fixable_by_top_n,
            plain_english_summary = EXCLUDED.plain_english_summary,
            top_clusters_json     = EXCLUDED.top_clusters_json
    """,
        microservice_name, branch, datetime.utcnow(),
        total_findings, len(patterns), total_fixable, len(fix_list),
        triage.get("executive_summary", ""),
        json.dumps(fix_list),
    )

    return {
        "microservice":       microservice_name,
        "cached":             False,
        "total_findings":     total_findings,
        "total_clusters":     len(patterns),
        "headline":           f"Fix {len(fix_list)} patterns → resolves all {total_findings} issues",
        "summary":            triage.get("executive_summary", ""),
        "fix_these_first":    fix_list,
        "total_fixable_top5": total_fixable,
        "ai_triage":          True,
        "minimum_fixes":      triage.get("minimum_fixes_needed", len(fix_list)),
    }


def _rule_based_digest(microservice: str, patterns: list, total: int) -> dict:
    fix_list = []
    for i, p in enumerate(patterns, 1):
        rf    = p["rule_family"]
        files = p["total_files"]
        issues = p["total_issues"]
        fix_list.append({
            "rank":          i,
            "cluster_id":    "",
            "rule_family":   rf,
            "origin_file":   p.get("files_sample", [""])[0] if p.get("files_sample") else "",
            "why_dangerous": f"This pattern repeats across {files} files causing {issues} findings. One root fix cascades to all instances.",
            "exact_fix":     f"Fix the {rf} pattern at its source — apply a shared sanitization/validation utility used by all {files} affected files.",
            "effort":        p.get("effort", "MEDIUM"),
            "blast_radius":  issues,
            "kills_issues":  issues,
            "kills_files":   files,
            "total_files":   files,
            "validation_status": "unreviewed",
        })

    return {
        "microservice":       microservice,
        "cached":             False,
        "total_findings":     total,
        "total_clusters":     len(patterns),
        "headline":           f"Fix {len(patterns)} patterns → resolves all {total} issues",
        "summary":            f"Rule-based summary (set GEMINI_API_KEY for AI triage). {len(patterns)} distinct vulnerability patterns found.",
        "fix_these_first":    fix_list,
        "total_fixable_top5": total,
        "ai_triage":          False,
        "minimum_fixes":      len(patterns),
    }
