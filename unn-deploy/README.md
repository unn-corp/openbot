# UNN OpenBot auto-update

Keeps the UNN self-hosted OpenBot server on the newest upstream release **with** `unn.patch`
(no channel assignment cap; admins and owners can change workflows from chats and channels).

How it works on the VM (`arcwright-personal`):

- `openbot-update.timer` (hourly) runs `unn-update stage`: the upstream `openbot-hosted-update stage`
  downloads and verifies the release, then `unn-update` rebuilds the patched `app.asar` from the
  upstream tag + `unn.patch` (as the `unnbuild` user) and swaps it into the staged release. The staged
  release is unappliable (`staged.ready` removed) until the patched asar is in place.
- Safety gates abort the build (and mark the version failed) unless the rebuilt bundle equals the
  official one except for `out/main/index.js`, the unpacked file set and archive entry count match,
  and the patch marker is present.
- `unn-update-install.timer` (08:30 UTC) and the in-app **Update** button run
  `unn-update request`: stop OpenBot, snapshot data + app (`/var/lib/unn-update/rollback`), apply,
  start, wait for `OpenBot <version>` + `(online)`. On failure it restores the snapshot and marks the
  version failed. On success the snapshot is deleted.

Controls (on the VM):

    unn-update status                      # last lines of /var/lib/unn-update/status.log
    touch /var/lib/unn-update/hold         # pause staging and installs
    sed -i '/^0.66.0$/d' /var/lib/unn-update/failed   # retry a version after fixing unn.patch

If `unn.patch` stops applying to a new upstream release, the server stays on the old version (the
Update button then fails). Rebase the patch on the new tag, replace `unn.patch`, run `install.sh`,
and clear the version from `failed`.

Install / reinstall: copy this directory to the VM and run `sudo ./install.sh`.
`unn-update selftest` rebuilds the installed version and compares it with the running `app.asar`.
