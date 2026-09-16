# syntax=docker/dockerfile:1
# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
# ─────────────────────────────────────────────────────────────────────────────
# Public runtime image — plain CPython source, suitable for self-hosting and
# distribution. The published image is the primary deployment artifact.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Build UI
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY ui/package*.json ./
RUN npm ci --silent
COPY ui/ ./
RUN npm run build

# Stage 2: Final image
FROM python:3.12-slim

ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    postgresql \
    postgresql-client \
    supervisor \
    curl \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI. Select the matching binary for the image architecture.
RUN case "${TARGETARCH}" in \
      amd64) DOCKER_ARCH="x86_64" ;; \
      arm64) DOCKER_ARCH="aarch64" ;; \
      *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-27.0.3.tgz" \
    | tar -xz --strip-components=1 -C /usr/local/bin docker/docker

WORKDIR /app

# Backend — public source running on standard CPython.
COPY server/requirements.txt ./server/
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ ./server/

# Frontend — minified build only
COPY --from=frontend-builder /build/dist ./ui/dist/

# Bundled registry used when the remote catalog is unavailable.
COPY registry ./registry

# Deploy configs
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
