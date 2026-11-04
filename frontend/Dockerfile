# Stage 1: Build
# Pin updated: 2026-03-26. Run 'docker pull node:22-alpine' to get latest digest.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV VITE_API_URL=""
RUN npx vite build

# Stage 2: Serve via nginx
# Pin updated: 2026-03-26. Run 'docker pull nginx:alpine' to get latest digest.
FROM nginx:alpine@sha256:785835ea65db4bba6f021acc0f3be91b0fef76a53fe41f8588c6698d2aed0606
RUN apk add --no-cache jq
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
# Note: nginx master process runs as root to bind port 80, worker processes
# drop to the 'nginx' user. This is nginx's built-in privilege separation model.
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
