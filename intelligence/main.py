"""
DebtScan -- Intelligence Service
Python + FastAPI

Responsibilities:
  1. Pull scan results from PostgreSQL
  2. Run root cause clustering (clusterer.py)
  3. Calculate compound risk / debt interest (scorer.py)
  4. Call Gemini API for AI triage (triage.py)
  5. Serve /digest and /debt-trend endpoints
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()

# -- DB connection pool ----------------------
db_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    db_pool = await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        user=os.getenv("DB_USER", "debtscan"),
        password=os.getenv("DB_PASSWORD", "debtscan123"),
        database=os.getenv("DB_NAME", "debtscan"),
        min_size=2,
        max_size=10,
    )
    print("Connected to PostgreSQL")
    yield
    await db_pool.close()

app = FastAPI(
    title="DebtScan Intelligence",
    description="Root cause clustering + compound risk scoring",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- Health ----------------------------------
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "intelligence",
        "features": ["clustering", "compound-risk", "ai-triage"],
    }

# -- Cluster endpoint ------------------------
@app.post("/cluster/{microservice_name}")
async def cluster_findings(microservice_name: str, branch: str = "master"):
    """
    Phase 1: Pull latest SAST findings for a microservice,
    run root cause clustering, save clusters to DB, return digest.
    """
    from clusterer import run_clustering
    try:
        result = await run_clustering(db_pool, microservice_name, branch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -- Digest endpoint -------------------------
@app.get("/digest/{microservice_name}")
async def get_digest(microservice_name: str, branch: str = "master"):
    """
    Returns the one-page digest:
    'Fix these N root causes -> kills M issues'
    """
    from triage import get_or_generate_digest
    try:
        digest = await get_or_generate_digest(db_pool, microservice_name, branch)
        return digest
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -- Debt trend endpoint ---------------------
@app.get("/debt-trend/{microservice_name}")
async def get_debt_trend(microservice_name: str, branch: str = "master"):
    """
    Phase 2: Returns sprint-over-sprint growth rate per root cause cluster.
    This is the compound risk / debt interest novelty.
    """
    from scorer import get_debt_trend
    try:
        trend = await get_debt_trend(db_pool, microservice_name, branch)
        return trend
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -- Force re-cluster endpoint ---------------
@app.post("/recluster/{microservice_name}")
async def force_recluster(microservice_name: str, branch: str = "master"):
    """Force clustering + scoring + triage refresh for a service"""
    from clusterer import run_clustering
    from scorer import calculate_compound_risk
    from triage import generate_fresh_digest

    cluster_result = await run_clustering(db_pool, microservice_name, branch)
    score_result = await calculate_compound_risk(db_pool, microservice_name, branch)
    digest = await generate_fresh_digest(db_pool, microservice_name, branch)

    return {
        "microservice": microservice_name,
        "branch":       branch,
        "clustered":    cluster_result,
        "scored":       score_result,
        "digest":       digest,
    }

# -- List all services with debt summary -----
@app.get("/summary")
async def get_all_summaries():
    """
    Returns a table of all microservices with their current urgency scores.
    """
    rows = await db_pool.fetch("""
        SELECT
            microservice_name,
            branch,
            COUNT(*) as cluster_count,
            SUM(blast_radius) as total_blast_radius,
            MAX(urgency_score) as max_urgency,
            COUNT(*) FILTER (WHERE is_accelerating = true) as accelerating_count,
            MAX(scan_timestamp) as last_scanned
        FROM root_cause_clusters
        GROUP BY microservice_name, branch
        ORDER BY max_urgency DESC, total_blast_radius DESC
    """)
    return [dict(r) for r in rows]

# -- TP/FP Validation endpoint ---------------
@app.patch("/validate/{cluster_id}")
async def validate_cluster(cluster_id: str, body: dict):
    from datetime import datetime, timezone
    status   = body.get("status", "unreviewed")
    note     = body.get("note", "")
    reviewer = body.get("reviewer", "analyst")
    if status not in ("true_positive", "false_positive", "false_negative", "true_negative", "unreviewed"):
        raise HTTPException(status_code=400, detail="status must be true_positive, false_positive, or unreviewed")
    result = await db_pool.execute("""
        UPDATE root_cause_clusters
        SET validation_status = $1, validation_note = $2, validated_by = $3, validated_at = $4
        WHERE cluster_id = $5
    """, status, note, reviewer, datetime.utcnow(), cluster_id)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="cluster not found")
    await db_pool.execute("""
        DELETE FROM digest_reports WHERE microservice_name = (
            SELECT microservice_name FROM root_cause_clusters WHERE cluster_id = $1 LIMIT 1)
    """, cluster_id)
    return {"cluster_id": cluster_id, "validation_status": status, "validated_by": reviewer}


# -- Get validation summary for a service ----
@app.get("/validations/{microservice_name}")
async def get_validations(microservice_name: str, branch: str = "main"):
    rows = await db_pool.fetch("""
        SELECT cluster_id, rule_family, origin_file, validation_status,
               validated_by, validated_at, validation_note
        FROM root_cause_clusters
        WHERE microservice_name = $1 AND branch = $2
        ORDER BY urgency_score DESC
    """, microservice_name, branch)
    return [dict(r) for r in rows]




