FROM node:22-slim

WORKDIR /app

# Copy entire repo (includes tests_source)
COPY . .

# Install dependencies with dev for build
WORKDIR /app/backend
RUN npm ci --include=dev

# Build TypeScript
RUN npm run build

# Remove devDependencies for smaller image
RUN npm prune --production

WORKDIR /app

# Start command
CMD ["node", "backend/dist/server.js"]
