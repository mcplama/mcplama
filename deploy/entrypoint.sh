#!/bin/bash
# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[MCPlama]${NC} $1"; }
warn() { echo -e "${YELLOW}[MCPlama]${NC} $1"; }

log "Starting MCPlama..."

# This is a shipped image, not a dev checkout — always run with the hardened
# check that refuses to boot on a default/leaked secret. There is no user-facing
# reason to ever run this entrypoint with ENVIRONMENT=development.
export ENVIRONMENT=production

# ── Secrets: generate once, then persist to the same volume the caller already
# mounts for Postgres data, so a container recreate reuses them automatically —
# no user-supplied SECRET_KEY/TOKEN_ENCRYPTION_KEY/DB_PASSWORD required. An
# explicit -e SECRET_KEY / -e TOKEN_ENCRYPTION_KEY still wins if someone does
# pass one (e.g. restoring onto a fresh volume), and gets persisted for next
# time. DB_PASSWORD is internal-only — Postgres is never exposed outside this
# container — so it is never read from the environment at all.
SECRETS_DIR="/var/lib/postgresql/.mcplama"
SECRETS_FILE="${SECRETS_DIR}/secrets.env"
mkdir -p "$SECRETS_DIR"

# DB_PASSWORD specifically is never honored from the environment, even on
# first boot — only the persisted file (below) or a freshly generated value.
unset DB_PASSWORD

if [ -f "$SECRETS_FILE" ]; then
    # shellcheck disable=SC1090
    source "$SECRETS_FILE"
    [ -n "$SECRET_KEY" ]           || export SECRET_KEY="$PERSISTED_SECRET_KEY"
    [ -n "$TOKEN_ENCRYPTION_KEY" ] || export TOKEN_ENCRYPTION_KEY="$PERSISTED_TOKEN_ENCRYPTION_KEY"
    export DB_PASSWORD="$PERSISTED_DB_PASSWORD"
fi

[ -n "$SECRET_KEY" ]           || export SECRET_KEY=$(openssl rand -hex 32)
[ -n "$TOKEN_ENCRYPTION_KEY" ] || export TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 16)
[ -n "$DB_PASSWORD" ]          || export DB_PASSWORD=$(openssl rand -hex 16)

cat > "$SECRETS_FILE" << SECEOF
PERSISTED_SECRET_KEY=${SECRET_KEY}
PERSISTED_TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
PERSISTED_DB_PASSWORD=${DB_PASSWORD}
SECEOF
chmod 600 "$SECRETS_FILE"

# ── Ensure mcplama Docker network exists ─────────────────────────────────────

log "Setting up Docker network..."
docker network inspect mcplama > /dev/null 2>&1 || docker network create mcplama
log "Network ready"

# ── Connect this container to mcplama network ─────────────────────────────────
docker network connect mcplama mcplama 2>/dev/null || true

export DATABASE_URL=${DATABASE_URL:-"postgresql+asyncpg://mcplama:${DB_PASSWORD}@localhost:5432/mcplama"}
export GATEWAY_URL=${GATEWAY_URL:-"http://localhost:8080"}
export REGISTRY_URL=${REGISTRY_URL:-"https://raw.githubusercontent.com/mcplama/mcplama/refs/heads/main/registry.json"}
# TLS is normally terminated by the administrator's reverse proxy. Keep the
# bundled HTTP default usable for local/LAN installs, but make the cookie risk
# explicit when the externally-visible gateway URL is not HTTPS.
if [[ "$GATEWAY_URL" != https://* ]]; then
    warn "GATEWAY_URL is not HTTPS ($GATEWAY_URL); dashboard cookies and MCP connection URLs are not protected in transit. Put MCPlama behind TLS and set GATEWAY_URL to the public https:// origin."
fi
# In this bundled image the dashboard and API are always served from the same
# origin as GATEWAY_URL — there is no separate frontend address to allow-list
# — so CORS_ORIGINS follows it by default. Only pass CORS_ORIGINS yourself if
# you need the dashboard reachable from more than one hostname/IP.
export CORS_ORIGINS=${CORS_ORIGINS:-$GATEWAY_URL}

# ── Container broker ──────────────────────────────────────────────────────────
# The broker is the only component that talks to the Docker socket; the backend
# reaches it on loopback. The token is generated per boot unless supplied — both
# processes live in this container and read the same environment, so there is
# nothing to keep in sync.
export BROKER_TOKEN=${BROKER_TOKEN:-$(openssl rand -hex 32)}
# Hostname the *runner* containers use to reach the broker's stdio relay. This
# container joins the mcplama network above under its own name, so that is the
# name they resolve.
export BROKER_HOST=${BROKER_HOST:-mcplama}
# Shared wrapper image used for npx, uvx, and stdio-based MCP servers. Most
# users should keep the default; advanced/private installs can point this at a
# registry mirror or pinned tag.
export RUNNER_IMAGE=${RUNNER_IMAGE:-"mcplama/runner:latest"}

# ── Write env file for supervisord to pick up ─────────────────────────────────
cat > /etc/mcplama.env << ENVEOF
DATABASE_URL=${DATABASE_URL}
SECRET_KEY=${SECRET_KEY}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
GATEWAY_URL=${GATEWAY_URL}
REGISTRY_URL=${REGISTRY_URL}
CORS_ORIGINS=${CORS_ORIGINS}
BROKER_TOKEN=${BROKER_TOKEN}
BROKER_HOST=${BROKER_HOST}
RUNNER_IMAGE=${RUNNER_IMAGE}
ENVEOF

# ── Start PostgreSQL cluster (Debian style) ───────────────────────────────────
log "Starting PostgreSQL..."
pg_ctlcluster 17 main start || true

# Wait for postgres to be ready
for i in $(seq 1 30); do
    if pg_ctlcluster 17 main status > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

# ── Create DB user and database if first run ──────────────────────────────────
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='mcplama'\"" | grep -q 1; then
    log "Creating database user and database..."
    su postgres -c "psql -c \"CREATE USER mcplama WITH PASSWORD '${DB_PASSWORD}';\""
    su postgres -c "psql -c \"CREATE DATABASE mcplama OWNER mcplama;\""
    log "Database ready"
else
    log "Database already exists"
fi

# ── Stop postgres so supervisord can manage it ────────────────────────────────
pg_ctlcluster 17 main stop || true
sleep 2

# ── Create log dir ────────────────────────────────────────────────────────────
mkdir -p /var/log/supervisor /var/log/mcplama
touch /var/log/mcplama/backend.log

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║        MCPlama is starting...            ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  Dashboard : http://localhost:8080       ║"
echo "  ║  API       : http://localhost:8080/api   ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Start all services ────────────────────────────────────────────────────────
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
