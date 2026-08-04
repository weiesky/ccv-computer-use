# Security Policy

**ccv-computer-use gives an AI agent direct control over a machine: screenshots,
mouse, keyboard, clipboard, and application launching.** The security model of
this project matters as much as its functionality.

## Supported versions

Only the latest published version on npm is actively supported.

## Reporting a vulnerability

- **Private disclosure (preferred):** open a GitHub [Security Advisory](https://github.com/weiesky/ccv-computer-use/security/advisories/new)
  (private vulnerability report). Please do **not** file public issues for
  security vulnerabilities.
- Include: affected version, platform, a minimal reproduction, and the impact.

We aim to acknowledge reports within 5 business days and to ship a fix (with
advisory) as soon as a reasonable patch is ready.

## Security design

The server refuses to start unless the kill-switch environment variable
`ALLOW_ANT_COMPUTER_USE_MCP=1` is explicitly set (or sandbox mode
`CCV_SANDBOX_MODE=1` is set). Defense in depth:

- **Kill-switch gate** — server exits if the env var is not set.
- **Sandbox mode** (`CCV_SANDBOX_MODE=1`) — an explicit, auditable downgrade
  for sandboxed/containerized environments that elevates ALL permission gates:
  app tiers → full, system-key blocklist disabled, clipboard/systemKeyCombos
  flags granted implicitly, cross-process lock skipped. It does NOT bypass
  macOS TCC permissions, the `request_access` first step, stale-screenshot
  pixel validation, or HTTP loopback binding. Because it is set via an
  environment variable, **any local process can enable it** — treat it as an
  operator decision with full responsibility.

- **Kill-switch gate** — server exits if the env var is not set.
- **Cross-process file lock** — prevents multiple sessions from controlling the
  machine concurrently (`os.tmpdir()/ccv-computer-use.lock`).
- **App tiering** — browsers/trading apps are read-only, terminals/IDEs are
  click-only, everything else is full control.
- **System key blocklist** — system-level combinations (`Cmd+Q`,
  `Ctrl+Alt+Delete`, …) are blocked.
- **Audit logging** — every `request_access` call is logged to stderr.
- **HTTP transport hardening** — binds to localhost only and validates the
  `Origin` header against DNS rebinding attacks.
- **`--coordinate-mode normalized_0_100`** — decouples the coordinates the model
  sees from physical resolution.

## Deployment recommendations

- Run inside a container or VM with restricted network access.
- Do not run on shared workstations.
- Monitor stderr logs.
- Never remove the kill-switch gate. Sandbox mode (`CCV_SANDBOX_MODE=1`) is
  its only intended exception and is an explicit, documented downgrade.
