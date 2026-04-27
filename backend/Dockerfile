# ProjectAchilles Backend Dockerfile — Multi-stage build
# Stage 1: Build (compile native addons + TypeScript)
# Stage 2: Runtime (slim image with only runtime dependencies)

# ── Stage 1: Builder ──────────────────────────────────────────────────
# Pin updated: 2026-03-26. Run 'docker pull node:22-slim' to get latest digest.
FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea AS builder

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
FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

# Runtime-only system dependencies:
#   git          - test repository sync (GitSyncService)
#   openssl      - certificate generation
#   osslsigncode - Windows Authenticode code signing
#   wget         - Docker healthcheck
#   curl         - Go toolchain download (for agent builds)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git openssl osslsigncode wget curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install Go with checksum verification (required for agent cross-compilation at runtime)
ARG GO_VERSION=1.24.3
ARG GO_SHA256=3333f6ea53afa971e9078895eaa4ac7204a8c6b5c68c10e6bc9a33e8e391bdd8
RUN curl -fsSL -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" && \
    echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

# Copy only production artifacts from builder (no python3/make/g++)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Entrypoint script: wipes stale ~/.projectachilles/analytics.json on startup
# when explicit ES env vars are set, so env config wins. See script for the
# precise trigger conditions.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
