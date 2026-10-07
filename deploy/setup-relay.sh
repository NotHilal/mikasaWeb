#!/usr/bin/env bash
# On the server (run as root, by deploy/deploy-relay.sh): install or update the relay as the
# woods-relay service (port 8788), and make Caddy forward /woods to it. The server is shared with
# BdayZey (its own relay on 8787 behind /relay, and its game): this only adds next to them.
set -euo pipefail

id -u woods >/dev/null 2>&1 || useradd --system --home /srv/woods --shell /usr/sbin/nologin woods
(cd /srv/woods/server && npm install --omit=dev --no-audit --no-fund)
chown -R woods:woods /srv/woods
cp /srv/woods/deploy/woods-relay.service /etc/systemd/system/woods-relay.service
systemctl daemon-reload
systemctl enable --now woods-relay
systemctl restart woods-relay

# Caddy: add `handle /woods* { reverse_proxy 127.0.0.1:8788 }` to the site, just before its /relay
# route, once. A copy of the file is kept first; if the result isn't valid, the copy goes back.
CF=/etc/caddy/Caddyfile
if ! grep -q 'handle /woods\*' "$CF"; then
  cp "$CF" "$CF.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CF" /tmp/Caddyfile.before
  awk '/handle \/relay\*/ && !done { print "\thandle /woods* {\n\t\treverse_proxy 127.0.0.1:8788\n\t}"; done = 1 } { print }' /tmp/Caddyfile.before > "$CF"
  if ! grep -q 'handle /woods\*' "$CF" || ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
    cp /tmp/Caddyfile.before "$CF"
    echo "Couldn't add the /woods route to $CF; it's unchanged." >&2
    exit 1
  fi
  systemctl reload caddy
fi

echo "Relay up: $(systemctl is-active woods-relay)"
