# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod ./
RUN go mod download || true

COPY . .
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -o vaultscan-scanner .

# Run stage
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates unzip default-jre-headless \
    && pip install --no-cache-dir semgrep \
    && curl -sSL https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-6.2.1.4610-linux-x64.zip -o /tmp/sonar.zip \
    && unzip -q /tmp/sonar.zip -d /opt \
    && mv /opt/sonar-scanner-6.2.1.4610-linux-x64 /opt/sonar-scanner \
    && ln -s /opt/sonar-scanner/bin/sonar-scanner /usr/local/bin/sonar-scanner \
    && rm /tmp/sonar.zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/vaultscan-scanner .

RUN mkdir -p /app/temp_unified_scans

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["./vaultscan-scanner"]
