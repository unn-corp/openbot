### Added

- Add a scheduled Linux desktop updater that copies the installed server's patched runtime over SSH. The next desktop launch uses the matching version and fork changes. Failed downloads leave the installed client in place.
- Request automatic fork repair through a T3 webhook when a patched build fails. Keep the previous server release when a build or online health check fails.
- Update enabled, managed provider CLIs on every hourly check. Respect custom CLI paths and wait for active provider work.
