#!/usr/bin/env bash
# Run as the desktop user after the guest and host export helpers are installed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=/mnt/Storage/Applications/OpenBot-UNN
install -d -m 0700 "$root" "$root/bin"
install -m 0755 "$here/unn-client" "$here/unn-client-update" "$root/bin/"
install -d "$HOME/.config/systemd/user" "$HOME/.local/share/applications"
install -m 0644 "$here/systemd/unn-client-update.service" "$here/systemd/unn-client-update.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
# Install the runtime before changing the menu entry.
systemctl --user start unn-client-update.service
cat >"$HOME/.local/share/applications/openbot.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=OpenBot
Comment=OpenBot with UNN changes, updated with the server.
Exec=/mnt/Storage/Applications/OpenBot-UNN/bin/unn-client %U
Icon=openbot
Terminal=false
Categories=Development;
StartupWMClass=openbot
MimeType=x-scheme-handler/openbot;
EOF
systemctl --user enable --now unn-client-update.timer
