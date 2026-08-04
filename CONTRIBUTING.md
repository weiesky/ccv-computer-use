# Contributing to ccv-computer-use

Thanks for your interest in contributing! This project is a standalone, portable
Computer-Use MCP server. Because it can control a user's mouse, keyboard, and
clipboard, security review matters more than in most projects — please keep the
security model (kill-switch, app tiers, key blocklist) in mind when proposing
changes.

## Setup

```bash
git clone https://github.com/weiesky/ccv-computer-use.git
cd ccv-computer-use
npm ci
```

Node.js 22+ is required (see `.nvmrc`).

## Development

```bash
npm run dev      # run the CLI from source (tsx)
npm run build    # compile TypeScript to dist/
npm run typecheck
npm test         # vitest (unit + integration)
```

- Unit tests: `tests/unit/` — pure logic, no OS access.
- Integration tests: `tests/integration/` — spin up real MCP stdio/HTTP servers.
  They run headlessly; teach-mode tests use auto-advance so no GUI is needed.
- Some tests are platform-gated (e.g. the global ESC hotkey listener). They are
  skipped on unsupported platforms rather than removed.

## Submitting changes

1. Create a branch, make your change.
2. Run `npm run build && npm run typecheck && npm test` locally — all must pass.
3. Add a changeset describing the change:
   ```bash
   npm run changeset
   ```
   Choose `patch` for bug fixes, `minor` for features, `major` for breaking
   changes. The CI release workflow will turn it into a "Version Packages" PR.
4. Open a PR against `main`.

## Security

If your change touches permissions, app tiering, the kill-switch, or anything
that could let an agent control a machine unexpectedly, describe the security
implications explicitly in the PR description. See `SECURITY.md` for how to
report vulnerabilities.

## Debugging

Use the official MCP Inspector against the stdio server:

```bash
ALLOW_ANT_COMPUTER_USE_MCP=1 npx @modelcontextprotocol/inspector \
  npx ccv-computer-use
```

## License

By contributing, you agree that your contributions are licensed under the
Apache-2.0 license of this project. See `LICENSE`.
