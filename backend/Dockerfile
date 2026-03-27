# ProjectAchilles Backend Dockerfile
# Pin updated: 2026-03-26. Run 'docker pull node:22-slim' to get latest digest.
FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

# Install system dependencies:
#   git       - test repository sync
#   openssl   - certificate generation
#   osslsigncode - Windows Authenticode signing
#   python3 make g++ - native addon compilation (better-sqlite3)
#   wget      - health check
RUN apt-get update && \
    apt-get install -y git openssl osslsigncode python3 make g++ wget curl && \
    rm -rf /var/lib/apt/lists/*

# Install Go (required for building security tests)
ARG GO_VERSION=1.24.3
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (include dev for TypeScript compilation + native addon build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Expose port (default 3000 for Docker Compose, Railway overrides via PORT env)
EXPOSE 3000

# Health check for Docker Compose dependency ordering
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

# Start the server
CMD ["node", "dist/server.js"]
