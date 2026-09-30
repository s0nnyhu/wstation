#!/usr/bin/env bash
# Install and start the meteoblue multimodel dashboard as a systemd service.
# Usage: sudo ./scripts/install-meteoblue-systemd.sh
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/deploy/wstation-meteoblue.service"
UNIT_DST="/etc/systemd/system/wstation-meteoblue.service"
APP_USER="${SUDO_USER:-${USER}}"
APP_GROUP="$(id -gn "$APP_USER")"
PYTHON="$(command -v python3)"

if [[ ! -f "$ROOT/scripts/meteoblue_multimodel.py" ]]; then
  echo "meteoblue_multimodel.py not found under $ROOT" >&2
  exit 1
fi
if [[ ! -f "$ROOT/scripts/meteoblue_dashboard.html" ]]; then
  echo "meteoblue_dashboard.html not found under $ROOT" >&2
  exit 1
fi
if [[ ! -x "$PYTHON" ]]; then
  echo "python3 not found" >&2
  exit 1
fi

install -d -o "$APP_USER" -g "$APP_GROUP" "$ROOT/data/meteoblue"
chmod +x "$ROOT/scripts/meteoblue_multimodel.py" "$ROOT/scripts/install-meteoblue-systemd.sh"

sed \
  -e "s|__USER__|$APP_USER|g" \
  -e "s|__GROUP__|$APP_GROUP|g" \
  -e "s|__ROOT__|$ROOT|g" \
  -e "s|__PYTHON__|$PYTHON|g" \
  "$UNIT_SRC" > "$UNIT_DST"

systemctl daemon-reload
systemctl enable --now wstation-meteoblue.service
systemctl --no-pager --full status wstation-meteoblue.service || true

echo
echo "Dashboard: http://0.0.0.0:5004  (open Lightsail firewall / security group on TCP 5004)"
echo "Logs:      journalctl -u wstation-meteoblue -f"
echo "Restart:   systemctl restart wstation-meteoblue"
