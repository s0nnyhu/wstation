#!/usr/bin/env bash
# Install and start the snapshot dashboard as a systemd service (Lightsail / any Linux).
# Usage: sudo ./scripts/install-snapshots-systemd.sh
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/deploy/wstation-snapshots.service"
UNIT_DST="/etc/systemd/system/wstation-snapshots.service"
APP_USER="${SUDO_USER:-${USER}}"
APP_GROUP="$(id -gn "$APP_USER")"
PYTHON="$(command -v python3)"

if [[ ! -f "$ROOT/scripts/snapshot_stations.py" ]]; then
  echo "snapshot_stations.py not found under $ROOT" >&2
  exit 1
fi
if [[ ! -x "$PYTHON" ]]; then
  echo "python3 not found" >&2
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_GROUP" "$ROOT/data"
chmod +x "$ROOT/scripts/snapshot_stations.py" "$ROOT/scripts/install-snapshots-systemd.sh"

sed \
  -e "s|__USER__|$APP_USER|g" \
  -e "s|__GROUP__|$APP_GROUP|g" \
  -e "s|__ROOT__|$ROOT|g" \
  -e "s|__PYTHON__|$PYTHON|g" \
  "$UNIT_SRC" > "$UNIT_DST"

systemctl daemon-reload
systemctl enable --now wstation-snapshots.service
systemctl --no-pager --full status wstation-snapshots.service || true

echo
echo "Dashboard: http://0.0.0.0:5002  (open Lightsail firewall / security group on TCP 5002)"
echo "Logs:      journalctl -u wstation-snapshots -f"
echo "Restart:   systemctl restart wstation-snapshots"
