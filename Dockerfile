# noaide — Multi-stage Docker build
# Stage 1: Build Rust backend
FROM rust:1.89-slim-bookworm AS rust-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev protobuf-compiler && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ .cargo/
COPY server/ server/
COPY crates/ crates/
COPY wasm/ wasm/
COPY xtask/ xtask/
RUN cargo build --release -p noaide-server && \
    cp target/release/noaide-server /build/noaide-server

# Stage 2: Build frontend
FROM node:22-slim AS frontend-builder
WORKDIR /build
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
COPY frontend/ ./
RUN pnpm build

# Stage 3: Runtime
FROM debian:bookworm-slim
# wget is used by the docker-compose healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 wget && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash noaide && \
    mkdir -p /data/noaide && \
    chown -R noaide:noaide /data
WORKDIR /app
COPY --from=rust-builder /build/noaide-server /app/noaide-server
# /app/static contains the full Vite output (index.html, assets/, fonts/, etc.).
COPY --from=frontend-builder /build/dist /app/static
USER noaide
VOLUME ["/data/noaide"]
ENV NOAIDE_HTTP_PORT=8080
ENV NOAIDE_PORT=4433
ENV NOAIDE_STATIC_DIR=/app/static
EXPOSE 8080 4433
CMD ["/app/noaide-server"]
