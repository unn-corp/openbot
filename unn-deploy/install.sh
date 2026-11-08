#!/usr/bin/env bash
# Installs the UNN OpenBot auto-update on the server VM. Run as root from this directory.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
id unnbuild >/dev/null 2>&1 || useradd --system --home-dir /var/lib/unn-update/home --create-home --shell /usr/sbin/nologin unnbuild
install -d -m 0755 /usr/local/lib/unn-openbot /var/lib/unn-update
install -d -o unnbuild -m 0755 /var/lib/unn-update/work
install -m 0755 "$here/unn-update" /usr/local/lib/unn-openbot/unn-update
install -m 0644 "$here/unn.patch" /usr/local/lib/unn-openbot/unn.patch
: >/var/lib/unn-update/failed.tmp && rm -f /var/lib/unn-update/failed.tmp   # keeps `failed` as is
for u in openbot-update.service openbot-update-request.service openbot-update.timer; do
  rm -f /etc/systemd/system/$u.d/unn-pinned.conf
  install -d /etc/systemd/system/$u.d
  install -m 0644 "$here/systemd/$u.unn.conf" /etc/systemd/system/$u.d/unn.conf
done
install -m 0644 "$here/systemd/unn-update-install.service" "$here/systemd/unn-update-install.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now openbot-update.timer unn-update-install.timer
echo "installed. status: /usr/local/lib/unn-openbot/unn-update status"
