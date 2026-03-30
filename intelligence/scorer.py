"""
scorer.py — Compound Risk / Debt Interest Engine

The novelty of DebtScan.

Every sprint, this compares the current cluster blast radius
against historical snapshots and calculates:

  - Growth rate:    how fast is this root cause spreading?
  - Projection:     blast radius next sprint if unfixed
  - Doubles in:     how many days until fix cost doubles?
  - Fix cost drift: QUICK_WIN today → HARD in 3 sprints

Output example:
  Cluster: sql-injection via db/query_helper.go
  Current blast radius:    58 issues
  Last sprint:             47 issues
  Growth rate:             +23%/sprint
  Projected next sprint:   72 issues
  Doubles in:              18 days
  Fix cost today:          MEDIUM (3 hours)
  Fix cost in 30 days:     HARD   (3 days)
  Urgency score:           9/10   ← ACCELERATING
"""

import json
import math
from datetime import datetime, timezone, timedelta


SPRINT_DAYS = 14  # assume 2-week sprints


def _days_to_double(growth_rate_pct: float) -> int | None:
    """
    Using the Rule of 70 from finance:
    days_to_double = (SPRINT_DAYS * 70) / growth_rate_per_sprint
    Returns None if not growing.
    """
    if growth_rate_pct <= 0:
        return None
    return int((SPRINT_DAYS * 70) / growth_rate_pct)


def _project_next_sprint(current: int, growth_rate_pct: float) -> int:
    return max(current, int(current * (1 + growth_rate_pct / 100)))


def _fix_cost_drift(current_effort: str, blast_radius_now: int, blast_radius_projected: int) -> str:
    """
    If blast radius grows significantly, the fix gets harder.
    More call sites = bigger refactor.
    """
    if current_effort == "HARD":
        return "HARD"
    growth = blast_radius_projected - blast_radius_now
    if current_effort == "QUICK_WIN" and growth > 10:
        return "MEDIUM"
    if current_effort == "MEDIUM" and growth > 15:
        return "HARD"
    return current_effort


async def calculate_compound_risk(db_pool, microservice_name: str, branch: str = "main"):
    """
    For each current cluster, look at its history and calculate:
    growth rate, projection, urgency boost, doubling time.
    Updates root_cause_clusters table with compound risk fields.
    Updates cluster_history with growth_rate for latest snapshot.
    """
    # Get current clusters
    clusters = await db_pool.fetch("""
        SELECT cluster_id, blast_radius, severity, rule_family,
               origin_file, effort_estimate, urgency_score
        FROM root_cause_clusters
        WHERE microservice_name = $1 AND branch = $2
    """, microservice_name, branch)

    for cluster in clusters:
        cluster_id = cluster["cluster_id"]
        current_radius = cluster["blast_radius"]

        # Get last 4 history snapshots for trend
        history = await db_pool.fetch("""
            SELECT blast_radius, scan_timestamp
            FROM cluster_history
            WHERE cluster_id = $1
              AND microservice_name = $2
              AND branch = $3
            ORDER BY scan_timestamp DESC
            LIMIT 5
        """, cluster_id, microservice_name, branch)

        growth_rate_pct = 0.0
        is_accelerating = False
        doubles_in_days = None
        projected_next  = current_radius

        if len(history) >= 2:
            prev_radius = history[1]["blast_radius"]  # second latest = previous sprint

            if prev_radius > 0:
                growth_rate_pct = ((current_radius - prev_radius) / prev_radius) * 100
                is_accelerating = growth_rate_pct > 10  # >10% growth = accelerating
                doubles_in_days = _days_to_double(growth_rate_pct)
                projected_next  = _project_next_sprint(current_radius, growth_rate_pct)

        # Fix cost today vs projected
        fix_cost_today     = cluster["effort_estimate"]
        fix_cost_projected = _fix_cost_drift(fix_cost_today, current_radius, projected_next)

        # Recalculate urgency with growth rate boost
        urgency = cluster["urgency_score"]
        if is_accelerating:
            urgency = min(urgency + 2, 10)  # boost accelerating clusters
        if growth_rate_pct > 30:
            urgency = min(urgency + 1, 10)  # extra boost for fast-growing

        # Update root_cause_clusters
        await db_pool.execute("""
            UPDATE root_cause_clusters SET
                urgency_score   = $1,
                is_accelerating = $2
            WHERE cluster_id = $3
              AND microservice_name = $4
              AND branch = $5
        """, urgency, is_accelerating, cluster_id, microservice_name, branch)

        # Update the LATEST cluster_history row with computed metrics
        await db_pool.execute("""
            UPDATE cluster_history SET
                growth_rate_pct    = $1,
                projected_next     = $2,
                doubles_in_days    = $3,
                fix_cost_today     = $4,
                fix_cost_projected = $5
            WHERE id = (
                SELECT id FROM cluster_history
                WHERE cluster_id = $6
                  AND microservice_name = $7
                  AND branch = $8
                ORDER BY scan_timestamp DESC
                LIMIT 1
            )
        """,
            growth_rate_pct, projected_next, doubles_in_days,
            fix_cost_today, fix_cost_projected,
            cluster_id, microservice_name, branch,
        )

    return {"status": "compound risk calculated", "clusters_processed": len(clusters)}


async def get_debt_trend(db_pool, microservice_name: str, branch: str = "main"):
    """
    Returns sprint-over-sprint growth data for all clusters.
    Used by the React dashboard to render the trend chart.
    """
    rows = await db_pool.fetch("""
        SELECT
            ch.cluster_id,
            rc.rule_family,
            rc.origin_file,
            rc.severity,
            ch.blast_radius,
            ch.growth_rate_pct,
            ch.projected_next,
            ch.doubles_in_days,
            ch.fix_cost_today,
            ch.fix_cost_projected,
            ch.scan_timestamp,
            rc.is_accelerating,
            rc.urgency_score
        FROM cluster_history ch
        JOIN root_cause_clusters rc
          ON ch.cluster_id = rc.cluster_id
         AND ch.microservice_name = rc.microservice_name
         AND ch.branch = rc.branch
        WHERE ch.microservice_name = $1
          AND ch.branch = $2
        ORDER BY ch.cluster_id, ch.scan_timestamp ASC
    """, microservice_name, branch)

    # Group by cluster_id for frontend chart
    trend_map: dict[str, dict] = {}
    for row in rows:
        cid = row["cluster_id"]
        if cid not in trend_map:
            trend_map[cid] = {
                "cluster_id":      cid,
                "rule_family":     row["rule_family"],
                "origin_file":     row["origin_file"],
                "severity":        row["severity"],
                "is_accelerating": row["is_accelerating"],
                "urgency_score":   row["urgency_score"],
                "doubles_in_days": row["doubles_in_days"],
                "fix_cost_today":  row["fix_cost_today"],
                "fix_cost_in_30d": row["fix_cost_projected"],
                "history":         [],
            }
        trend_map[cid]["history"].append({
            "sprint":           row["scan_timestamp"].isoformat() if row["scan_timestamp"] else None,
            "blast_radius":     row["blast_radius"],
            "growth_rate_pct":  float(row["growth_rate_pct"] or 0),
            "projected_next":   row["projected_next"],
        })

    # Separate accelerating from stable
    accelerating = [v for v in trend_map.values() if v["is_accelerating"]]
    stable       = [v for v in trend_map.values() if not v["is_accelerating"]]

    accelerating.sort(key=lambda x: x["urgency_score"], reverse=True)
    stable.sort(key=lambda x: x["urgency_score"], reverse=True)

    return {
        "microservice":          microservice_name,
        "branch":                branch,
        "accelerating_clusters": accelerating,
        "stable_clusters":       stable,
        "total_clusters":        len(trend_map),
        "accelerating_count":    len(accelerating),
        "summary": _build_debt_summary(accelerating),
    }


def _build_debt_summary(accelerating: list) -> dict:
    if not accelerating:
        return {"message": "No accelerating root causes detected. Debt is stable."}

    top = accelerating[0]
    msg = (
        f"⚠ {len(accelerating)} root cause(s) are accelerating. "
        f"Most urgent: '{top['rule_family']}' in {top['origin_file']} "
    )
    if top["doubles_in_days"]:
        msg += f"— fix cost doubles in {top['doubles_in_days']} days."
    else:
        msg += "— fix cost is rising."

    return {
        "message":               msg,
        "accelerating_count":    len(accelerating),
        "top_urgent_cluster":    top["cluster_id"],
        "top_urgent_rule":       top["rule_family"],
        "top_urgent_file":       top["origin_file"],
        "top_doubles_in_days":   top["doubles_in_days"],
    }
