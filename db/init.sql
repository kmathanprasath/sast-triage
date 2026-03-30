-- ═══════════════════════════════════════════════════════════
-- DebtScan — Database Schema
-- Runs automatically when postgres container starts fresh
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. Microservices registry
--    Tracks all repos DebtScan monitors
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS microservices (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL UNIQUE,
    source_repo_url TEXT NOT NULL,
    description     TEXT,
    team            VARCHAR(255),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 2. SAST raw scan results
--    One row per microservice per branch
--    Updated on every scan (upsert)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sast (
    id                  SERIAL PRIMARY KEY,
    scan_id             VARCHAR(255) NOT NULL UNIQUE,
    microservice_name   VARCHAR(255) NOT NULL,
    branch              VARCHAR(255) NOT NULL DEFAULT 'main',
    scan_timestamp      TIMESTAMP NOT NULL DEFAULT NOW(),
    security_findings   JSONB DEFAULT '[]'::jsonb,
    quality_issues      JSONB DEFAULT '[]'::jsonb,
    created_at          TIMESTAMP DEFAULT NOW(),

    -- one active result per service per branch
    CONSTRAINT uq_sast_service_branch UNIQUE (microservice_name, branch)
);

CREATE INDEX IF NOT EXISTS idx_sast_microservice ON sast(microservice_name);
CREATE INDEX IF NOT EXISTS idx_sast_timestamp    ON sast(scan_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sast_scan_id      ON sast(scan_id);

-- ─────────────────────────────────────────
-- 3. Root cause clusters
--    OUTPUT of the Python clustering engine
--    One row per identified root cause
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS root_cause_clusters (
    id                  SERIAL PRIMARY KEY,
    cluster_id          VARCHAR(255) NOT NULL,
    microservice_name   VARCHAR(255) NOT NULL,
    branch              VARCHAR(255) NOT NULL DEFAULT 'main',
    scan_timestamp      TIMESTAMP NOT NULL DEFAULT NOW(),

    -- what is the root cause?
    rule_family         VARCHAR(255),   -- e.g. sql-injection, weak-crypto
    origin_file         TEXT,           -- the ONE file to fix
    origin_line         INT,
    pattern_signature   TEXT,           -- normalized code pattern

    -- how bad is it?
    severity            VARCHAR(50),    -- CRITICAL / HIGH / MEDIUM / LOW
    blast_radius        INT DEFAULT 0,  -- how many findings this fix kills
    affected_files      JSONB DEFAULT '[]'::jsonb,
    findings            JSONB DEFAULT '[]'::jsonb,

    -- how hard is it to fix?
    effort_estimate     VARCHAR(50),    -- QUICK_WIN / MEDIUM / HARD
    fix_suggestion      TEXT,           -- AI-generated fix description
    fix_code_diff       TEXT,           -- AI-generated actual code change

    -- novelty: compound risk
    urgency_score       INT DEFAULT 0,  -- 1-10, higher = fix sooner
    is_accelerating     BOOLEAN DEFAULT false,

    -- TP/FP validation
    validation_status   VARCHAR(20) DEFAULT 'unreviewed', -- unreviewed | true_positive | false_positive
    validated_by        VARCHAR(255),
    validated_at        TIMESTAMP,
    validation_note     TEXT,

    created_at          TIMESTAMP DEFAULT NOW(),

    CONSTRAINT uq_cluster_service_branch UNIQUE (cluster_id, microservice_name, branch)
);

CREATE INDEX IF NOT EXISTS idx_clusters_microservice ON root_cause_clusters(microservice_name);
CREATE INDEX IF NOT EXISTS idx_clusters_blast_radius ON root_cause_clusters(blast_radius DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_urgency      ON root_cause_clusters(urgency_score DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_timestamp    ON root_cause_clusters(scan_timestamp DESC);

-- ─────────────────────────────────────────
-- 4. Cluster history  ← THE NOVELTY TABLE
--    Snapshot of every cluster on every scan
--    This is what powers compound risk scoring
--    Never upserted — always appended
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cluster_history (
    id                  SERIAL PRIMARY KEY,
    cluster_id          VARCHAR(255) NOT NULL,
    microservice_name   VARCHAR(255) NOT NULL,
    branch              VARCHAR(255) NOT NULL DEFAULT 'main',
    scan_timestamp      TIMESTAMP NOT NULL DEFAULT NOW(),

    -- metrics snapshot at this point in time
    blast_radius        INT DEFAULT 0,
    severity            VARCHAR(50),
    rule_family         VARCHAR(255),
    origin_file         TEXT,
    affected_file_count INT DEFAULT 0,

    -- compound risk calculated at this snapshot
    growth_rate_pct     FLOAT DEFAULT 0,      -- vs previous snapshot
    projected_next      INT DEFAULT 0,         -- predicted blast radius next sprint
    doubles_in_days     INT,                   -- how many days until blast radius doubles
    fix_cost_today      VARCHAR(50),           -- QUICK_WIN / MEDIUM / HARD
    fix_cost_projected  VARCHAR(50)            -- estimated cost if ignored
);

CREATE INDEX IF NOT EXISTS idx_history_cluster    ON cluster_history(cluster_id);
CREATE INDEX IF NOT EXISTS idx_history_service    ON cluster_history(microservice_name);
CREATE INDEX IF NOT EXISTS idx_history_timestamp  ON cluster_history(scan_timestamp DESC);

-- ─────────────────────────────────────────
-- 5. Digest reports
--    Cached AI triage output per scan
--    So we don't re-call Claude API on every /digest request
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS digest_reports (
    id                  SERIAL PRIMARY KEY,
    microservice_name   VARCHAR(255) NOT NULL,
    branch              VARCHAR(255) NOT NULL DEFAULT 'main',
    generated_at        TIMESTAMP DEFAULT NOW(),

    -- summary numbers
    total_findings      INT DEFAULT 0,
    total_clusters      INT DEFAULT 0,
    fixable_by_top_n    INT DEFAULT 0,   -- how many issues top-N clusters fix
    top_n               INT DEFAULT 8,

    -- AI-generated content
    plain_english_summary   TEXT,
    top_clusters_json       JSONB DEFAULT '[]'::jsonb,
    accelerating_clusters   JSONB DEFAULT '[]'::jsonb,

    CONSTRAINT uq_digest_service_branch UNIQUE (microservice_name, branch)
);

-- ─────────────────────────────────────────
-- 6. Helper view — latest scan per service
--    Used by intelligence layer constantly
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW latest_scans AS
SELECT DISTINCT ON (microservice_name, branch)
    scan_id,
    microservice_name,
    branch,
    scan_timestamp,
    security_findings,
    quality_issues
FROM sast
ORDER BY microservice_name, branch, scan_timestamp DESC;

-- ─────────────────────────────────────────
-- 7. Helper view — cluster growth trend
--    Shows blast radius over time per cluster
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW cluster_growth_trend AS
SELECT
    cluster_id,
    microservice_name,
    branch,
    scan_timestamp,
    blast_radius,
    growth_rate_pct,
    LAG(blast_radius) OVER (
        PARTITION BY cluster_id, microservice_name, branch
        ORDER BY scan_timestamp
    ) AS prev_blast_radius
FROM cluster_history
ORDER BY cluster_id, scan_timestamp DESC;

-- ─────────────────────────────────────────
-- Done — print confirmation
-- ─────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE ' DebtScan schema initialized successfully';
    RAISE NOTICE ' Tables: microservices, sast, root_cause_clusters,';
    RAISE NOTICE '         cluster_history, digest_reports';
    RAISE NOTICE ' Views:  latest_scans, cluster_growth_trend';
    RAISE NOTICE '═══════════════════════════════════════════';
END $$;
