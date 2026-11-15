#!/usr/bin/env bash
# Run as root on Mothership after the guest export helper is installed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/unn-client-export-host" /usr/local/sbin/unn-openbot-client-export
temporary=$(mktemp /etc/sudoers.d/.unn-openbot-client-export.XXXXXX)
trap 'rm -f "$temporary"' EXIT
printf '%s\n' 'devotek ALL=(root) NOPASSWD: /usr/local/sbin/unn-openbot-client-export info, /usr/local/sbin/unn-openbot-client-export archive' >"$temporary"
chmod 0440 "$temporary"
visudo -cf "$temporary"
mv "$temporary" /etc/sudoers.d/unn-openbot-client-export
