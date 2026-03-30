# VaultScan

> SAST tools give you 454 findings. VaultScan tells you the 6 patterns causing all of them — and exactly how to fix each one so it cascades everywhere.

---

## The Problem

Every SAST tool gives you hundreds of findings.  
Nobody reads hundreds of findings.  
So teams ignore them, and the debt compounds.

The real problem isn't 454 findings. It's 6 repeating patterns nobody connected.

```
454 findings
  └─ cwe-79 (XSS)              → 307 findings across 176 files  ← same innerHTML pattern
  └─ cwe-353 (integrity check) → 128 findings across 68 files   ← same missing SRI tag
  └─ hardcoded-secret          →   2 findings in 1 file
  └─ cwe-95 (eval injection)   →   8 findings across 7 files
  └─ cwe-116 (output encoding) →   8 findings in 1 file
  └─ cwe-1333 (regex DoS)      →   1 finding
```

Fix the XSS pattern once (add DOMPurify to a shared util) → kills 307 issues.  
That's the insight VaultScan surfaces.

---

## What It Does

```
Any GitHub/GitLab/Bitbucket repo
          ↓
  Semgrep + SonarQube scan
          ↓
  Two-level root cause clustering
  (pattern groups → per-file breakdown)
          ↓
  Gemini AI triage
  "Fix this pattern → cascades to kill N issues across M files"
          ↓
  Compound risk scoring
  "This pattern is growing 23%/sprint. Fix cost doubles in 42 days."
          ↓
  Dashboard: 6 action items, not 454 noise
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard :3000                      │
│              React + TypeScript + Recharts               │
│   Overview · Debt Trend · All Findings · Export PDF      │
└────────────────────────┬────────────────────────────────┘
                         │ nginx proxy
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌──────────────────┐         ┌──────────────────────┐
│  Scanner :5000   │         │  Intelligence :8000   │
│  Go + Gin        │────────▶│  Python + FastAPI     │
│                  │         │                       │
│  • Semgrep       │         │  • Pattern clustering │
│  • SonarQube     │         │  • Compound risk      │
│  • Deduplication │         │  • Gemini AI triage   │
│  • Cron scanner  │         │  • TP/FP/FN/TN valid. │
└────────┬─────────┘         └──────────┬────────────┘
         │                              │
         └──────────────┬───────────────┘
                        ▼
              ┌──────────────────┐
              │  PostgreSQL :5432 │
              │                  │
              │  • sast           │
              │  • root_cause_    │
              │    clusters       │
              │  • cluster_history│  ← compound risk
              │  • digest_reports │
              └──────────────────┘
                        │
              ┌──────────────────┐
              │  SonarQube :9000  │
              │  Community Ed.    │
              └──────────────────┘
```

| Service      | Tech                    | Port |
|--------------|-------------------------|------|
| dashboard    | React 18 + TypeScript   | 3000 |
| scanner      | Go 1.22 + Gin           | 5000 |
| intelligence | Python 3.12 + FastAPI   | 8000 |
| sonarqube    | SonarQube 10 CE         | 9000 |
| postgres     | PostgreSQL 15           | 5432 |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.x or later
- 8 GB RAM minimum (SonarQube needs ~4 GB alone)
- Git

That's it. No local installs of Go, Python, Node, or Semgrep needed.

---

## Installation

### 1. Clone

```bash
git clone https://github.com/kmathanprasath/sast-triage
cd sast-triage/SAST-Triage
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
# Required for SonarQube integration (get this after first boot — see step 4)
SONAR_TOKEN=

# Optional — enables AI-powered triage with cascade explanations
# Get a free key at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=

# Optional — required only for scanning private GitHub repos
GITHUB_TOKEN=
```

Leave everything else as-is for local development.

### 3. Start

```bash
docker compose up -d
```

First build takes 3–5 minutes (downloading base images, compiling Go, installing Python deps).  
Subsequent starts take under 30 seconds.

### 4. Get the SonarQube token (one-time setup)

SonarQube takes ~2 minutes to boot on first run.

```bash
# Wait until this returns "UP"
curl -s http://localhost:9000/api/system/status | grep status
```

Then:
1. Open http://localhost:9000
2. Login: `admin` / `admin` → change password when prompted
3. Go to **My Account → Security → Generate Token**
4. Name it `vaultscan`, click Generate
5. Copy the token into your `.env` as `SONAR_TOKEN=squ_xxxxx`
6. Restart the scanner: `docker compose restart scanner`

### 5. Verify everything is running

```bash
make health
```

Expected output:
```
  ✓ Scanner
  ✓ Intelligence
  ✓ Dashboard
  ✓ SonarQube
```

Or check manually:
- Dashboard: http://localhost:3000
- Scanner API: http://localhost:5000/health
- Intelligence API: http://localhost:8000/health
- SonarQube: http://localhost:9000

---

## Running Your First Scan

### Via the Dashboard (recommended)

1. Open http://localhost:3000
2. Click **New Scan**
3. Paste a GitHub repo URL (e.g. `https://github.com/digininja/DVWA`)
4. Set branch (e.g. `main` or `master`)
5. Click **Start Scan**

The progress modal shows each stage: Cloning → Semgrep → SonarQube → Unifying → Clustering → Done.

### Via CLI

```bash
# Trigger a scan
curl -X POST http://localhost:5000/scan \
  -H 'Content-Type: application/json' \
  -d '{"repo_url":"https://github.com/digininja/DVWA","branch":"master"}'

# Returns: {"scan_id":"abc-123", "status_url":"/scan/abc-123"}

# Poll status
curl http://localhost:5000/scan/abc-123

# Once completed, view the pattern digest
curl http://localhost:8000/digest/digininja-DVWA | python3 -m json.tool
```

### Via Makefile

```bash
# Scan a repo
make scan REPO=https://github.com/digininja/DVWA BRANCH=master

# Get the digest
make digest SERVICE=digininja-DVWA

# Get debt trend
make trend SERVICE=digininja-DVWA

# Full end-to-end test with DVWA
make test-e2e
```

---

## Dashboard Features

### Overview tab
- **KPI strip** — Total findings, distinct patterns, minimum fixes needed, AI triage status
- **Pattern digest** — Each row is one vulnerability pattern, not one finding
  - "XSS pattern → kills 307 issues across 176 files"
  - Expand to see: cascade explanation, root fix, exact code instruction
- **Vulnerability distribution** — Pie + bar charts by rule family
- **Fix coverage** — Progress bar showing % of issues resolved by fixing listed patterns
- **Validation** — Mark each pattern as TP / FP / FN / TN, persisted to DB
- **Export PDF** — Full report with all patterns, cascade explanations, and validation status

### Debt Trend tab
- Sprint-over-sprint blast radius growth per cluster
- Accelerating clusters flagged with doubling-time estimate
- "Fix cost today: MEDIUM → Fix cost in 30 days: HARD"

### All Findings tab
- All 254 clusters (per-file breakdown), paginated
- Each row expandable: shows every individual finding with line number, CWE, description
- Justification: "Fixing this file kills N issues because the same pattern repeats at lines X, Y, Z"
- Filter by validation status (All / Unreviewed / TP / FP)

---

## How the Clustering Works

VaultScan uses a two-level clustering model:

**Level 1 — Pattern Groups** (what the developer sees)
- Groups ALL findings by vulnerability pattern (rule family)
- One pattern = one fix action that cascades across all affected files
- 454 findings → 6 patterns

**Level 2 — File Clusters** (drill-down)
- Per-file breakdown within each pattern group
- Used in "All Findings" tab to show exactly which files need touching
- 454 findings → 254 file-level clusters

**Gemini's role**: For each pattern group, generate the one root fix that cascades everywhere, with a plain-English explanation of why fixing it once resolves all instances.

---

## Compound Risk Scoring

The novelty of VaultScan. Every scan appends to `cluster_history`, enabling sprint-over-sprint growth tracking:

```
Growth rate:     +23%/sprint
Projected next:  72 issues (up from 58)
Doubles in:      42 days
Fix cost today:  MEDIUM (3 hours)
Fix cost in 30d: HARD   (3 days)
Urgency score:   9/10  ← ACCELERATING
```

This answers the question teams never ask: "If we ignore this today, how much worse does it get?"

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_USER` | No | PostgreSQL username (default: `debtscan`) |
| `DB_PASSWORD` | No | PostgreSQL password (default: `debtscan123`) |
| `DB_NAME` | No | PostgreSQL database name (default: `debtscan`) |
| `SONAR_TOKEN` | Recommended | SonarQube user token — enables SonarQube analysis |
| `GEMINI_API_KEY` | Optional | Google Gemini API key — enables AI triage with cascade explanations |
| `GITHUB_TOKEN` | Optional | GitHub PAT — required for private GitHub repo scanning. Needs `repo` (read) scope |
| `GITLAB_TOKEN` | Optional | GitLab Personal Access Token — required for private GitLab repos. Needs `read_repository` scope |
| `BITBUCKET_TOKEN` | Optional | Bitbucket App Password — required for private Bitbucket repos. Needs `repository` (read) permission |
| `SEMGREP_RULES` | No | Semgrep ruleset (default: `auto`) |
| `SEMGREP_APP_TOKEN` | Optional | Semgrep Cloud token for managed rules |
| `SCAN_CRON_ENABLED` | No | Enable scheduled scanning (default: `true`) |
| `SCAN_CRON_SCHEDULE` | No | Cron expression (default: `0 3 * * *` — 3am daily) |

---

## API Reference

### Scanner (port 5000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/scan` | Trigger a scan `{"repo_url":"...","branch":"..."}` |
| GET | `/scan/:id` | Poll scan status |
| GET | `/scan/:id/report` | Full unified findings report |
| GET | `/scan/:id/report/download` | Download report as JSON |
| DELETE | `/scan/:id` | Delete a scan |
| GET | `/scans` | List all scans |
| POST | `/microservice` | Register a repo for cron scanning |
| GET | `/cron/status` | Cron scheduler status |
| GET | `/health` | Health check |

### Intelligence (port 8000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/digest/:service` | Pattern digest with AI cascade explanations |
| GET | `/debt-trend/:service` | Sprint-over-sprint compound risk data |
| GET | `/all-findings/:service` | All clusters with per-finding breakdown |
| GET | `/summary` | All services with urgency scores |
| POST | `/recluster/:service` | Force re-cluster + re-score + re-triage |
| PATCH | `/validate/:cluster_id` | Set TP/FP/FN/TN validation status |
| GET | `/validations/:service` | Get all validation statuses for a service |
| GET | `/health` | Health check |

---

## Private Repositories

VaultScan supports private repos on GitHub, GitLab, and Bitbucket.

**Option 1 — Per-scan token (dashboard)**

Click "New Scan", toggle on "Private repository", and paste your access token. The token is used only for cloning and never stored.

**Option 2 — Global token (cron scanning)**

Set the token in `.env` so scheduled scans can access private repos automatically:

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxx        # GitHub PAT — needs repo (read) scope
GITLAB_TOKEN=glpat-xxxxxxxxxxxx      # GitLab token — needs read_repository scope
BITBUCKET_TOKEN=your-app-password    # Bitbucket app password — needs repository (read)
```

**Where to get tokens**

- GitHub: Settings → Developer settings → Personal access tokens → Fine-grained → `Contents: Read`
- GitLab: User Settings → Access Tokens → `read_repository`
- Bitbucket: Personal settings → App passwords → `Repositories: Read`

---

## Supported Repositories

VaultScan scans any public or private repository on:
- GitHub (`github.com`)
- GitLab (`gitlab.com`)
- Bitbucket (`bitbucket.org`)

Supported languages (via Semgrep + SonarQube):
JavaScript, TypeScript, Python, Java, Go, PHP, Ruby, C, C++, C#, Kotlin, Swift, and more.

---

## Troubleshooting

**SonarQube stays unhealthy for more than 5 minutes**
```bash
docker compose logs sonarqube | tail -20
```
Usually a memory issue. Ensure Docker Desktop has at least 8 GB RAM allocated (Settings → Resources).

**Scanner fails with "clone failed"**
- Public repos: no action needed
- Private repos: set `GITHUB_TOKEN` in `.env`
- Branch not found: VaultScan automatically falls back to `master` then `main`

**"No clusters found" in dashboard**
The scan completed but clustering hasn't run yet. Click **Re-cluster** in the dashboard, or:
```bash
curl -X POST http://localhost:8000/recluster/your-service-name
```

**Dashboard shows stale data after re-scan**
Click **Re-cluster** to invalidate the digest cache and regenerate with fresh data.

**Port conflicts**
If ports 3000, 5000, 8000, or 9000 are in use, edit the `ports` section in `docker-compose.yml`.

---

## Stopping and Cleanup

```bash
# Stop all services (data preserved)
docker compose down

# Stop and delete all scan data
docker compose down -v

# Full cleanup including images
make clean
```

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test with `make test-e2e`
5. Open a pull request

The project is structured so each service is independently deployable. Changes to the intelligence layer (Python) don't require rebuilding the scanner (Go) or dashboard (React).

---

## License

MIT — see [LICENSE](LICENSE)
