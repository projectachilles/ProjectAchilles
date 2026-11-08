# ProjectAchilles Backend Dockerfile — Multi-stage build
# Stage 1: Build (compile native addons + TypeScript)
# Stage 2: Runtime (slim image with only runtime dependencies)

# ── Stage 1: Builder ──────────────────────────────────────────────────
# Pin updated: 2026-03-26. Run 'docker pull node:22-slim' to get latest digest.
FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder

# Build tools for native addon compilation (better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────────────
FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

# Runtime-only system dependencies:
#   git          - test repository sync (GitSyncService)
#   openssl      - certificate generation
#   osslsigncode - Windows Authenticode code signing
#   wget         - Docker healthcheck
#   curl         - Go toolchain download (for agent builds)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git openssl osslsigncode wget curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install Go with checksum verification (required for agent cross-compilation at runtime).
# Must be >= the `go` directive in agent/go.mod, otherwise `go mod tidy` triggers an
# auto-toolchain download to /root/.projectachilles/go-cache (~140 MB) which can blow
# the 1 GB persistent-disk budget. Bump in lockstep with agent/go.mod.
# The toolchain matches the image's architecture (TARGETARCH, set by BuildKit),
# so an arm64 image (Apple Silicon) runs `go` natively, not emulated.
# Checksums: https://go.dev/dl/?mode=json&include=all
ARG GO_VERSION=1.25.9
ARG GO_SHA256_AMD64=00859d7bd6defe8bf84d9db9e57b9a4467b2887c18cd93ae7460e713db774bc1
ARG GO_SHA256_ARM64=ec342e7389b7f489564ed5463c63b16cf8040023dabc7861256677165a8c0e2b
ARG TARGETARCH
RUN case "${TARGETARCH:-amd64}" in \
      amd64) GO_SHA256="${GO_SHA256_AMD64}" ;; \
      arm64) GO_SHA256="${GO_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH:-amd64}.tar.gz" && \
    echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

# Copy only production artifacts from builder (no python3/make/g++)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Commit stamped into the image so GET /api/health can report exactly what is
# running. Managed platforms (Render, Vercel, Railway) inject their own variable
# and take precedence; this is the fallback for Docker Compose, VPS and on-prem:
#   docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) ...
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
