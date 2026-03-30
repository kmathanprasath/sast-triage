.PHONY: up down restart logs scan digest trend register health clean test-e2e

# ─────────────────────────────────────────
# Core commands
# ─────────────────────────────────────────

## Start the full stack
up:
	@echo "Starting DebtScan..."
	docker compose up -d --build
	@echo ""
	@echo "  Scanner:      http://localhost:5000"
	@echo "  Intelligence: http://localhost:8000"
	@echo "  Dashboard:    http://localhost:3000"
	@echo "  SonarQube:    http://localhost:9000 (takes ~2 min to boot)"
	@echo ""
	@echo "  Waiting for services to be healthy..."
	@sleep 5
	@make health

## Stop everything
down:
	docker compose down

## Rebuild and restart
restart:
	docker compose down
	docker compose up -d --build

## Follow all logs
logs:
	docker compose logs -f

## Logs for one service: make logs-scanner
logs-%:
	docker compose logs -f $*

# ─────────────────────────────────────────
# Health checks
# ─────────────────────────────────────────

health:
	@echo "Checking service health..."
	@curl -sf http://localhost:5000/health  > /dev/null && echo "  ✓ Scanner"      || echo "  ✗ Scanner (not ready)"
	@curl -sf http://localhost:8000/health  > /dev/null && echo "  ✓ Intelligence" || echo "  ✗ Intelligence (not ready)"
	@curl -sf http://localhost:3000         > /dev/null && echo "  ✓ Dashboard"    || echo "  ✗ Dashboard (not ready)"
	@curl -sf http://localhost:9000/api/system/status > /dev/null && echo "  ✓ SonarQube" || echo "  ✗ SonarQube (still booting)"

# ─────────────────────────────────────────
# Workflow shortcuts
# ─────────────────────────────────────────

## Register a repo: make register NAME=my-api REPO=https://github.com/user/repo
register:
	@test -n "$(NAME)"  || (echo "Usage: make register NAME=my-api REPO=https://github.com/user/repo" && exit 1)
	@test -n "$(REPO)"  || (echo "Usage: make register NAME=my-api REPO=https://github.com/user/repo" && exit 1)
	curl -s -X POST http://localhost:5000/microservice \
		-H 'Content-Type: application/json' \
		-d '{"name":"$(NAME)","source_repo_url":"$(REPO)"}' | python3 -m json.tool

## Trigger a scan: make scan REPO=https://github.com/user/repo BRANCH=main
scan:
	@test -n "$(REPO)" || (echo "Usage: make scan REPO=https://github.com/user/repo BRANCH=main" && exit 1)
	@BRANCH=$${BRANCH:-main}; \
	curl -s -X POST http://localhost:5000/scan \
		-H 'Content-Type: application/json' \
		-d "{\"repo_url\":\"$(REPO)\",\"branch\":\"$$BRANCH\"}" | python3 -m json.tool

## Get digest for a service: make digest SERVICE=my-api
digest:
	@test -n "$(SERVICE)" || (echo "Usage: make digest SERVICE=my-api" && exit 1)
	curl -s http://localhost:8000/digest/$(SERVICE) | python3 -m json.tool

## Get debt trend: make trend SERVICE=my-api
trend:
	@test -n "$(SERVICE)" || (echo "Usage: make trend SERVICE=my-api" && exit 1)
	curl -s http://localhost:8000/debt-trend/$(SERVICE) | python3 -m json.tool

## Re-cluster a service: make cluster SERVICE=my-api
cluster:
	@test -n "$(SERVICE)" || (echo "Usage: make cluster SERVICE=my-api" && exit 1)
	curl -s -X POST http://localhost:8000/recluster/$(SERVICE) | python3 -m json.tool

## List all scans
scans:
	curl -s http://localhost:5000/scans | python3 -m json.tool

## Summary of all services + urgency scores
summary:
	curl -s http://localhost:8000/summary | python3 -m json.tool

# ─────────────────────────────────────────
# End-to-end test with DVWA
# (Damn Vulnerable Web App — safe test target)
# ─────────────────────────────────────────

test-e2e:
	@echo ""
	@echo "═══ DebtScan End-to-End Test ═══"
	@echo "Target: DVWA (Damn Vulnerable Web Application)"
	@echo ""

	@echo "Step 1: Register DVWA..."
	curl -s -X POST http://localhost:5000/microservice \
		-H 'Content-Type: application/json' \
		-d '{"name":"dvwa","source_repo_url":"https://github.com/digininja/DVWA","team":"test"}' \
		| python3 -m json.tool

	@echo ""
	@echo "Step 2: Trigger scan..."
	@SCAN_RESPONSE=$$(curl -s -X POST http://localhost:5000/scan \
		-H 'Content-Type: application/json' \
		-d '{"repo_url":"https://github.com/digininja/DVWA","branch":"master"}'); \
	echo $$SCAN_RESPONSE | python3 -m json.tool; \
	echo $$SCAN_RESPONSE > /tmp/debtscan-e2e-scan.json

	@echo ""
	@echo "Step 3: Waiting 90 seconds for scan to complete..."
	@sleep 90

	@echo ""
	@echo "Step 4: Running clustering + scoring..."
	curl -s -X POST "http://localhost:8000/recluster/dvwa" | python3 -m json.tool

	@echo ""
	@echo "Step 5: Fetching digest..."
	curl -s http://localhost:8000/digest/dvwa | python3 -m json.tool

	@echo ""
	@echo "Step 6: Fetching debt trend..."
	curl -s http://localhost:8000/debt-trend/dvwa | python3 -m json.tool

	@echo ""
	@echo "═══ E2E test complete ═══"
	@echo "  Open http://localhost:3000 and select 'dvwa' to see the dashboard"

# ─────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────

## Remove all containers, volumes (WARNING: deletes all scan data)
clean:
	@echo "WARNING: This deletes all scan data. Press Ctrl+C to cancel, Enter to continue."
	@read confirm
	docker compose down -v
	docker system prune -f

## Remove only temp scan directories
clean-temp:
	docker compose exec scanner rm -rf /app/temp_unified_scans/*
	@echo "Temp scan directories cleared"

# ─────────────────────────────────────────
# Go scanner helpers
# ─────────────────────────────────────────

## Generate go.sum (run inside scanner container)
go-tidy:
	docker compose run --rm scanner sh -c "cd /app && go mod tidy"

## Run scanner locally (without Docker)
run-scanner:
	cd scanner && go run .
