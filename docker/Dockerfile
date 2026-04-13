FROM rust:1.86-bookworm AS builder
WORKDIR /app

COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/src ./src-tauri/src

RUN cd src-tauri && cargo build --release --features web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/src-tauri/target/release/fit-dashboard-core /usr/local/bin/fit-dashboard

ENV FIT_DASHBOARD_DB=/data/fit-dashboard.duckdb
EXPOSE 8080
VOLUME ["/data"]

CMD ["fit-dashboard"]
