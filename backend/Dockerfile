# ProjectAchilles Backend Dockerfile
FROM node:22-slim

# Install git (repo sync), openssl (cert generation), and native build deps for better-sqlite3
RUN apt-get update && \
    apt-get install -y git openssl python3 make g++ wget && \
    rm -rf /var/lib/apt/lists/*

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
