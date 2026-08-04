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
`ALLOW_ANT_COMPUTER_USE_MCP=1` is explicitly set. Defense in depth:

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
- Never remove the kill-switch gate.
