# Changelog

## 0.2.0

### Minor Changes

- 5a700ac: Add sandbox mode (`CCV_SANDBOX_MODE=1`): an explicit operator opt-in for sandboxed/containerized environments that elevates all permission gates — app tiers become full, the system-key blocklist is disabled, clipboard/systemKeyCombos grant flags are granted implicitly, the kill-switch and the cross-process lock are bypassed. OS-level permissions (TCC), the `request_access` first step, stale-screenshot pixel validation, and HTTP loopback binding remain enforced. See README "Sandbox mode" for details.

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and releases are versioned with [Changesets](https://github.com/changesets/changesets).

## [Unreleased]

- **Sandbox mode** (`CCV_SANDBOX_MODE=1`): elevates every permission gate for
  sandboxed/containerized environments — app tiers → full, system-key
  blocklist disabled, clipboard/systemKeyCombos flags granted implicitly,
  kill-switch + cross-process lock bypassed. TCC, `request_access`,
  pixel-validation, and HTTP loopback binding still enforced.
- `--version` and MCP `serverInfo` now read from `package.json` (no longer a
  hardcoded upstream version).

## [0.1.0] - 2026-08-04

Initial public release.

- 54 MCP tools across macOS / Windows / Linux (X11) and iOS Simulator
- screenshot + zoom + multi-display, mouse/keyboard/clipboard control
- application management (installed / running / frontmost) with app tiering
- `computer_batch` for batched action sequences
- teach mode (`request_teach_access` / `teach_step` / `teach_batch`), headless auto-advance
- cross-process file lock, macOS TCC permission detection
- system key blocklist, app tiering, kill-switch (`ALLOW_ANT_COMPUTER_USE_MCP=1`)
- pixel validation (sharp/libvips 9×9 patch) against stale screenshots
- stdio + Streamable HTTP transports (localhost-only, Origin-checked)
- Windows UIA tools (pure PowerShell + C#, no Python bridge)
- iOS Simulator tools (`xcrun simctl` + optional idb)
- global ESC abort hotkey (`node-global-key-listener`)
