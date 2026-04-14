FROM node:20-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM rust:1-bookworm AS backend-builder
WORKDIR /app

COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/src ./src-tauri/src
RUN cd src-tauri && cargo build --release --features web

FROM debian:bookworm-slim
RUN apt-get update \
		&& apt-get install -y --no-install-recommends ca-certificates nginx \
		&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend-builder /app/src-tauri/target/release/fit-dashboard-core /usr/local/bin/fit-dashboard
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default

RUN cat <<'EOF' >/usr/local/bin/start-fit-dashboard.sh
#!/usr/bin/env bash
set -euo pipefail

fit-dashboard &
backend_pid=$!

cleanup() {
	kill "$backend_pid" 2>/dev/null || true
	nginx -s quit >/dev/null 2>&1 || true
}
trap cleanup TERM INT EXIT

nginx -g 'daemon off;' &
nginx_pid=$!

wait -n "$backend_pid" "$nginx_pid"
exit_code=$?

kill "$backend_pid" "$nginx_pid" 2>/dev/null || true
wait || true
exit "$exit_code"
EOF
RUN chmod +x /usr/local/bin/start-fit-dashboard.sh

ENV FIT_DASHBOARD_DOCKER=1
ENV FIT_DASHBOARD_DATA_DIR=/data
ENV FIT_DASHBOARD_DB=/data/fit-dashboard.duckdb
ENV RUST_LOG=info,fit_dashboard_core=debug,hyper=warn,h2=warn

EXPOSE 80
VOLUME ["/data"]

CMD ["/usr/local/bin/start-fit-dashboard.sh"]
