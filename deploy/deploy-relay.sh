#!/usr/bin/env bash
# Upload the relay to the Hetzner server (the one BdayZey uses) and (re)start it.
#   bash deploy/deploy-relay.sh [root@<server-ip>]
# The game itself is on Vercel; it finds the relay at VITE_RELAY_URL (.env.production).
set -euo pipefail
HOST="${1:-root@159.69.106.241}"
cd "$(dirname "$0")/.."
# use the Hetzner key if there is one (override with SSH_KEY=...)
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hetzner}"
OPTS=()
[ -f "$KEY" ] && OPTS=(-i "$KEY")

ssh "${OPTS[@]}" "$HOST" 'mkdir -p /srv/woods/server /srv/woods/deploy'
scp "${OPTS[@]}" server/relay.mjs server/package.json "$HOST:/srv/woods/server/"
scp "${OPTS[@]}" deploy/woods-relay.service deploy/setup-relay.sh "$HOST:/srv/woods/deploy/"
ssh "${OPTS[@]}" "$HOST" 'bash /srv/woods/deploy/setup-relay.sh'
