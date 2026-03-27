# Stage 1: Build
# Pin updated: 2026-03-26. Run 'docker pull node:22-alpine' to get latest digest.
FROM node:22-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV VITE_API_URL=""
RUN npx vite build

# Stage 2: Serve via nginx
# Pin updated: 2026-03-26. Run 'docker pull nginx:alpine' to get latest digest.
FROM nginx:alpine@sha256:e7257f1ef28ba17cf7c248cb8ccf6f0c6e0228ab9c315c152f9c203cd34cf6d1
RUN apk add --no-cache jq
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown -R nginx:nginx /usr/share/nginx/html /docker-entrypoint.sh
EXPOSE 80
USER nginx
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
