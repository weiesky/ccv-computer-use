/**
 * Sandbox mode — an explicit, auditable escape hatch for running the
 * computer-use MCP server inside a sandboxed / containerized environment
 * where the full freedom of operation is desired.
 *
 * When `CCV_SANDBOX_MODE=1` (or `true`) is set:
 *   - The kill-switch (`ALLOW_ANT_COMPUTER_USE_MCP`) is bypassed.
 *   - All app tiering is elevated to `"full"` — browsers, terminals, trading
 *     apps are fully controllable (no read/click restriction).
 *   - Policy-level auto-deny (streaming/ebook/music apps) is disabled.
 *   - The system-key blocklist is disabled.
 *   - Clipboard / system-key-combo grant flags are all granted implicitly.
 *   - The cross-process file lock is skipped (concurrent sessions allowed —
 *     operator's responsibility).
 *
 * Sandbox mode does NOT bypass (by design):
 *   - OS-level permissions (macOS TCC Accessibility / Screen Recording).
 *   - The `request_access` first-step requirement.
 *   - Stale-screenshot pixel validation (a correctness guard, not a gate).
 *   - The HTTP `--http-host` loopback-only binding check and Origin check.
 *
 * ZERO-IMPORT CONTRACT: this file must never import anything (not even
 * `types.ts`). `deniedApps.ts` imports it, and that file is consumed by a
 * renderer via a package.json subpath export — pulling in any dependency
 * (especially `@modelcontextprotocol/sdk`) would break that module
 * resolution. It reads `process.env` only.
 */

export function isSandboxMode(): boolean {
  return (
    process.env.CCV_SANDBOX_MODE === '1' ||
    process.env.CCV_SANDBOX_MODE === 'true'
  )
}

export function sandboxNotice(serverName: string): string {
  return (
    `[${serverName}] sandbox mode enabled (CCV_SANDBOX_MODE): all ` +
    'permission gates elevated — app tiers = full, system-key blocklist ' +
    'disabled, clipboard/systemKeyCombos flags granted, cross-process lock ' +
    'skipped. OS-level permissions (TCC) and HTTP loopback binding are still ' +
    'enforced. Concurrent control from multiple sessions is now the operator\'s ' +
    'responsibility.'
  )
}
