#!/bin/sh
# ─────────────────────────────────────────
# bootstrap.sh — run once after cloning
# Usage:  sh bootstrap.sh
#   or:   chmod +x bootstrap.sh && ./bootstrap.sh
# ─────────────────────────────────────────
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     DebtScan — Bootstrap             ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check Docker is running ───────────────
if ! docker info > /dev/null 2>&1; then
  echo "✗ Docker Desktop is not running."
  echo "  Start Docker Desktop and try again."
  exit 1
fi
echo "✓ Docker Desktop is running"

# ── Generate go.sum ───────────────────────
echo ""
echo "Generating go.sum for scanner service..."
docker run --rm \
  -v "$(pwd)/scanner:/app" \
  -w /app \
  golang:1.22-alpine \
  sh -c "go mod tidy" \
  && echo "✓ scanner/go.sum generated" \
  || { echo "✗ go mod tidy failed"; exit 1; }

# ── Create .env ───────────────────────────
echo ""
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ .env created from .env.example"
  echo ""
  echo "  Optional — edit .env to add:"
  echo "    SONAR_TOKEN       (SonarQube analysis)"
  echo "    GITHUB_TOKEN      (private repos)"
  echo "    GEMINI_API_KEY    (AI triage — Gemini)"
else
  echo "✓ .env already exists — skipping"
fi

# ── Make self executable for next time ────
chmod +x bootstrap.sh

# ── Done ─────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Bootstrap complete. Next steps:     ║"
echo "║                                      ║"
echo "║  make up          start everything   ║"
echo "║  make test-e2e    run E2E test        ║"
echo "║                                      ║"
echo "║  Dashboard:  http://localhost:3000   ║"
echo "║  Scanner:    http://localhost:5000   ║"
echo "║  Intel:      http://localhost:8000   ║"
echo "╚══════════════════════════════════════╝"
echo ""
