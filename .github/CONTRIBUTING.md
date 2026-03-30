# Contributing to VaultScan

Thanks for your interest. Here's how to get involved.

## Ways to Contribute

- **Bug reports** — open an issue with steps to reproduce
- **Feature requests** — open an issue describing the use case
- **Code** — pick an open issue, comment that you're working on it, open a PR
- **Documentation** — improve the README, add examples, fix typos

## Development Setup

```bash
git clone https://github.com/kmathanprasath/sast-triage
cd sast-triage/SAST-Triage
cp .env.example .env
docker compose up -d
```

See the README for the full setup guide including SonarQube token configuration.

## Project Structure

```
SAST-Triage/
├── scanner/          Go + Gin — scan engine (Semgrep + SonarQube)
├── intelligence/     Python + FastAPI — clustering, scoring, AI triage
├── dashboard/        React + TypeScript — UI
├── db/               PostgreSQL schema
├── .github/          CI workflows and community files
├── docker-compose.yml
└── Makefile          Shortcuts for common tasks
```

## Making Changes

**Intelligence layer (Python)**
- `clusterer.py` — two-level pattern clustering logic
- `scorer.py` — compound risk / debt interest scoring
- `triage.py` — Gemini AI triage and digest generation
- `main.py` — FastAPI routes

**Scanner (Go)**
- `scan.go` — full scan pipeline (clone → semgrep → sonar → unify → cluster)
- `handlers.go` — HTTP route handlers
- `semgrep.go` / `sonar.go` — tool integrations
- `unify.go` — deduplication and finding normalization

**Dashboard (React)**
- `src/components/DigestReport.tsx` — Overview tab
- `src/components/DebtTrendChart.tsx` — Debt Trend tab
- `src/components/AllFindings.tsx` — All Findings tab
- `src/hooks/useData.ts` — API hooks
- `src/utils/exportPdf.ts` — PDF export

## Testing Your Changes

```bash
# Run the full end-to-end test against DVWA (safe vulnerable app)
make test-e2e

# Check all services are healthy
make health

# Rebuild a specific service after changes
docker compose build intelligence
docker compose up -d --no-deps intelligence
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Update the README if you add or change behaviour
- Test with at least one real repo scan before submitting
- Add a short description of what changed and why

## Code Style

- **Go**: standard `gofmt` formatting
- **Python**: PEP 8, type hints where practical
- **TypeScript**: existing style in the codebase (no semicolons, single quotes)

## Reporting Security Issues

Do not open a public issue for security vulnerabilities.  
Email directly or use GitHub's private vulnerability reporting under the Security tab.
