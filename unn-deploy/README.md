# UNN OpenBot auto-update

Keeps the UNN self-hosted OpenBot server on the newest upstream release **with** `unn.patch`
(no channel assignment cap; admins and owners can change workflows from chats and channels).

How it works on the VM (`arcwright-personal`):

- `openbot-update.timer` (hourly) runs `unn-update stage`: the upstream `openbot-hosted-update stage`
  downloads and verifies the release, then `unn-update` rebuilds the patched `app.asar` from the
  upstream tag + `unn.patch` (as the `unnbuild` user) and swaps it into the staged release. The staged
  release is unappliable (`staged.ready` removed) until the patched asar is in place.
- Safety gates abort the build (and mark the version failed) unless the unpatched build reproduces the official compiled output, the patched build succeeds,
  the unpacked file set matches, and the patch marker is present.
- `unn-update-install.timer` (08:30 UTC) and the in-app **Update** button run
  `unn-update request`: stop OpenBot, snapshot app state + app (`/var/lib/unn-update/rollback`; agent working copies and caches are
  excluded, see `SNAP_EXCLUDES`, so it is a few GB and takes about a minute), apply,
  start, wait for `OpenBot <version>` + `(online)`. On failure it restores the snapshot and marks the
  version failed. On success the snapshot is deleted.

Controls (on the VM):

    unn-update status                      # last lines of /var/lib/unn-update/status.log
    touch /var/lib/unn-update/hold         # pause staging and installs
    sed -i '/^0.66.0$/d' /var/lib/unn-update/failed   # retry a version after fixing unn.patch

If `unn.patch` stops applying, the server stays on the old version and the T3 webhook requests
a repair. The agent rebases the patch, checks it, installs a healthy release, and syncs the client.
If the agent cannot fix the failure, the old release stays in place and the thread reports the
blocker. For manual recovery, rebase the patch on the new tag, install it, and clear only the fixed
version from `failed`.

Install / reinstall: copy this directory to the VM and run `sudo ./install.sh`.
`unn-update selftest` rebuilds the installed version and compares it with the running `app.asar`.

## Matching Linux desktop client

The server remains the release source. It checks upstream hourly, builds with `unn.patch`, and
installs a successful build at 08:30 UTC or through the app's Update action. A patch conflict or
failed build leaves the server on its previous version. A failed patched build calls a T3 webhook that resumes the bound OpenBot thread to repair the
patch, run checks, install a healthy server build, and sync the desktop. Changes to `unn.patch`
must still be installed on the guest.

The desktop checks the **installed** server every 15 minutes through the existing SSH key for
`devotek@mothership.unnportal.io:26051`. It copies the complete runtime, including the patched
renderer (mentions picker), instead of using a stock AppImage. No GitHub token is required.
SSH host verification remains enabled. An unavailable host or locked SSH key leaves the client
in place and makes the user service fail visibly in its journal.

Guest setup: run `install.sh`, or install `unn-client-export` as mode 0755 at
`/usr/local/lib/unn-openbot/unn-client-export`. On Mothership, copy this directory and run
`install-client-export-host.sh` as root. This adds a fixed export command and a sudoers rule for
exactly its `info` and `archive` arguments. It cannot select another path or command. The guest
helper holds the server update lock, requires an active service and the patch marker, and exports
only `/opt/OpenBot/app`. It does not export account settings, chats, working copies, or keyrings.

On Devotek-PC, run `bash unn-deploy/install-client.sh` as the desktop user. It installs the first
runtime before it changes the menu entry, then enables the user timer. Files live under
`/mnt/Storage/Applications/OpenBot-UNN`. The updater checks the version and `app.asar` SHA-256,
then atomically switches `current`. A failed transfer cannot replace the active version. An
automatic downgrade is blocked. Old managed runtimes are removed when they are not in use.
Downloads use a temporary directory on the same Storage filesystem and are removed on normal exit.

The updater does not stop an open desktop app. Quit it and start **OpenBot** from the menu to
use the new version. On a Wayland desktop the launcher defaults to XWayland, which restored
remote computer video and browser images on Devotek-PC. An explicit `--ozone-platform` argument
overrides this default. This also avoids a detached Wayland fallback relaunch being stopped
with its original systemd service. This extracted runtime has no `APPIMAGE` environment variable, so OpenBot
disables its stock in-app desktop updater. Use the external timer for desktop updates; server
Update actions still use the existing patched server updater.

Desktop controls:

```sh
systemctl --user start unn-client-update.service
systemctl --user list-timers unn-client-update.timer
journalctl --user -u unn-client-update.service -n 30 --no-pager
touch /mnt/Storage/Applications/OpenBot-UNN/hold  # pause desktop sync
rm /mnt/Storage/Applications/OpenBot-UNN/hold     # resume desktop sync
timeout 70 xvfb-run -a python3 scripts/unn-client-smoke.py
```

The smoke check uses a new profile and a virtual display, waits for a renderer IPC call, stops
only its own process, and writes `.openbot-build/unn-client-smoke.json`. It does not test a
signed-in connection or mentions behavior. Remove the desktop timer with
`systemctl --user disable --now unn-client-update.timer`. Remove the host sudoers rule at
`/etc/sudoers.d/unn-openbot-client-export` to revoke the export permission.

## Automatic repair and provider updates

The deployed patch targets upstream 0.71.0. Source is on `deploy/v0.71.0-unn` in
`unn-corp/openbot`. It retains UNN workflow permissions, channel assignments, and user mentions.
It also enables automatic updates on every hourly check for enabled provider CLIs managed by
OpenBot. Custom CLI paths and system installations keep their existing behavior. Running provider
processes keep their current version until they start again.

`unn-notify-failure` calls the T3 task **Repair OpenBot fork update conflicts**. The task is bound
to the existing OpenBot thread and can resume it after it is settled. Keep T3 and T3 Connect
available. Offline delivery and agent repair are not guarantees of a successful update. A failed
safety check leaves the previous server release in place.

The callback URL is a bearer secret. It is stored in `.openbot/repair-webhook.curl` locally and at
`/usr/local/lib/unn-openbot/repair-webhook.curl` in the guest, with mode 0600. It is not committed.
The task and URL can be managed in T3 Settings. Copy the config separately from `install.sh`.
The notifier sends only the event name, release version, and patch SHA-256. It records successful
submissions in `/var/lib/unn-update/webhook-delivered` and retries failed submissions on the next
stage check. T3 also deduplicates by version and patch digest. Request values are untrusted data;
the repair prompt requires a check of the actual server state before edits.

During a repair, `/var/lib/unn-update/repair-active` suppresses notifications. Remove it after the
repair. If a repair turn stops before cleanup, check that no repair is active before you remove
this file. Each repair records its version and patch digest in `repair-attempted`, so a failed repair does
not trigger itself repeatedly. After a manual patch fix, install
the patch and clear only the fixed version from `failed` before retrying.

Verification: the guest-to-relay connection probe used a filtered event. Notifier checks covered
suppression, retry, deduplication, and version validation. Resume after settlement was checked in
T3 source; a live run from a settled thread was not tested.

### Verified installation, 2026-11-15

OpenBot 0.71.0 passed the server build gates and was verified signed in and online at 11:22:31 UTC.
The initial attempt exposed a saved-session decryption failure after keyring restart. The session
was converted, while the old keyring could still decrypt it, to OpenBot's existing Linux file-key
format: AES-256-GCM with the `obk1` header. The key is
`/var/lib/openbot/.config/OpenBot/secret-storage.key`, owned by the service user with mode 0600.
No plaintext credential was written to disk or printed. Keep this key with the server's user data
in backups. Both the previous and current release support this format.

The conversion was checked on an isolated copy before the live file. The live retry passed the
online health gate and removed its rollback snapshot. The native file-key restart check passed;
its optional keyring cases were skipped locally because the keyring tools are absent. Separate
checks in the guest verified keyring decryption with the existing session and a copied keyring.
The notifier checks covered duplicate submissions, repair suppression, delivery retry and version
validation. A filtered request from the guest reached the T3 relay. A live settled-thread wake was
not tested; its dispatch and unsettled-state behavior were checked in T3 source.
