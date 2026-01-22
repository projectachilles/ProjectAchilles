# ProjectAchilles Backend Dockerfile
FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Expose port (Railway sets PORT env var)
EXPOSE 8080

# Start the server
CMD ["node", "dist/server.js"]
