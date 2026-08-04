/**
 * ccv-computer-use CLI entry point.
 *
 * Starts the computer-use MCP server on either stdio (default) or Streamable
 * HTTP.
 *
 * Usage:
 *   ccv-computer-use                              # stdio MCP server (requires ALLOW_ANT_COMPUTER_USE_MCP=1)
 *   ccv-computer-use --http 3456                  # Streamable HTTP on 127.0.0.1:3456/mcp
 *   ccv-computer-use --esc-hotkey                 # stdio + global ESC abort hotkey
 *   ccv-computer-use --help
 *   ccv-computer-use --version
 *   ccv-computer-use --coordinate-mode pixels     # or normalized_0_100
 *   ccv-computer-use --no-lock                    # skip cross-process file lock (testing only)
 *   ccv-computer-use --teach-auto-advance         # auto-advance every teach_step (headless default)
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

import { createComputerUseMcpServer } from './mcpServer.js'
import { createStandaloneAdapter } from './host/adapter.js'
import { createDefaultExecutor } from './host/executorFactory.js'
import { createStderrLogger } from './host/logger.js'
import { registerEscapeHotkey } from './server/escHotkey.js'
import { startHttpServer } from './server/http.js'
import { isComputerUseEnabled } from './server/killSwitch.js'
import { isSandboxMode, sandboxNotice } from './sandbox.js'
import { createInMemorySessionContext } from './server/sessionContext.js'
import { startStdioServer } from './server/stdio.js'
import type { CoordinateMode } from './types.js'

// Read the version from package.json so `--version` stays in sync with
// releases (changesets bumps package.json, not this file).
const { version: VERSION } = createRequire(import.meta.url)('../package.json') as { version: string }

const HELP = `
ccv-computer-use — standalone Computer-Use MCP server

USAGE
  ccv-computer-use [options]

REQUIRED ENVIRONMENT
  ALLOW_ANT_COMPUTER_USE_MCP=1     Must be set to enable the server.
                                   This is a safety gate: the MCP gives full
                                   mouse/keyboard control of this machine.
  CCV_SANDBOX_MODE=1               ALTERNATIVE: enables the server AND elevates
                                   all permission gates (app tiers = full,
                                   system-key blocklist disabled, clipboard/
                                   systemKeyCombos flags granted, lock skipped).
                                   For sandboxed/containerized environments
                                   only. OS permissions (TCC) and HTTP
                                   loopback binding are still enforced.

OPTIONS
  --help, -h                       Show this help.
  --version, -v                    Print version and exit.
  --coordinate-mode <mode>         'pixels' (default) or 'normalized_0_100'.
  --no-lock                        Skip the cross-process computer-use lock.
                                   Only use for testing; concurrent computer
                                   control from multiple processes can put the
                                   machine into an inconsistent state.
  --teach-auto-advance             Teach mode: skip the Next-click wait between
                                   steps and execute each teach_step's actions
                                   immediately. This is the default in the
                                   standalone host (no GUI overlay); the flag
                                   exists to make the behavior explicit and to
                                   support headless test runners.
  --log-level <level>              silly | debug | info | warn | error.
                                   Default: info. Logs go to stderr.

TRANSPORT
  Default transport is stdio (the MCP client spawns this process directly).
  The flags below switch to Streamable HTTP. Stdio and HTTP are mutually
  exclusive.

  --http <port>                    Start an HTTP server on the given port
                                   instead of stdio.
  --http-host <host>               Bind address for --http. Default 127.0.0.1.
                                   Refuses non-loopback addresses — computer-
                                   use over a LAN exposes mouse/keyboard
                                   control to the network.
  --http-path <path>               URL path for the MCP endpoint.
                                   Default /mcp.

USER-INTERRUPT
  --esc-hotkey                     Register a system-wide ESC listener that
                                   aborts the in-flight computer_batch / type
                                   loop. Requires Accessibility permission
                                   on macOS (already needed for computer
                                   use), X11 on Linux. If the platform hook
                                   fails to start, the server logs and
                                   continues without it.

EXAMPLES
  # Start stdio server (most MCP clients spawn it directly)
  ALLOW_ANT_COMPUTER_USE_MCP=1 ccv-computer-use

  # Start HTTP server on localhost:3456
  ALLOW_ANT_COMPUTER_USE_MCP=1 ccv-computer-use --http 3456

  # Stdio + ESC abort hotkey
  ALLOW_ANT_COMPUTER_USE_MCP=1 ccv-computer-use --esc-hotkey

  # Register with Claude Code
  claude mcp add ccv-computer-use --transport stdio -- \\
    env ALLOW_ANT_COMPUTER_USE_MCP=1 ccv-computer-use

PLATFORMS
  macOS   — requires Accessibility + Screen Recording permissions granted
            to the terminal app (or node binary) in System Settings.
  Windows — PowerShell 5+ required. No additional permissions.
  Linux   — requires xdotool, scrot, wmctrl, xrandr (apt install xdotool scrot wmctrl x11-utils).
            X11 only; Wayland is not supported.

MORE
  https://github.com/anthropics/claude-code (original source)
`.trim()

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      'coordinate-mode': { type: 'string', default: 'pixels' },
      'no-lock': { type: 'boolean', default: false },
      'teach-auto-advance': { type: 'boolean', default: true },
      'log-level': { type: 'string', default: 'info' },
      http: { type: 'string' },
      'http-host': { type: 'string' },
      'http-path': { type: 'string' },
      'esc-hotkey': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    process.stdout.write(`${HELP}\n`)
    process.exit(0)
  }

  if (values.version) {
    process.stdout.write(`${VERSION}\n`)
    process.exit(0)
  }

  const logger = createStderrLogger(
    'ccv-computer-use',
    (values['log-level'] ?? 'info') as 'silly' | 'debug' | 'info' | 'warn' | 'error',
  )

  // ── Kill switch ──────────────────────────────────────────────────────
  // Sandbox mode bypasses the kill-switch (see sandbox.ts). Note: this is an
  // explicit operator opt-in for containerized/sandboxed environments; the
  // loopback-only HTTP bind check below is NOT bypassed.
  if (!isComputerUseEnabled()) {
    process.stderr.write(
      '[ccv-computer-use] ALLOW_ANT_COMPUTER_USE_MCP is not set.\n' +
        'This MCP gives full mouse/keyboard control of the machine and must be\n' +
        'explicitly enabled. Set ALLOW_ANT_COMPUTER_USE_MCP=1 (or run in\n' +
        'sandbox mode with CCV_SANDBOX_MODE=1) to proceed.\n',
    )
    process.exit(1)
  }

  // ── Sandbox mode notice ─────────────────────────────────────────────
  if (isSandboxMode()) {
    process.stderr.write(sandboxNotice('ccv-computer-use') + '\n')
  }

  // ── Coordinate mode ──────────────────────────────────────────────────
  const coordModeRaw = values['coordinate-mode'] ?? 'pixels'
  if (coordModeRaw !== 'pixels' && coordModeRaw !== 'normalized_0_100') {
    process.stderr.write(
      `[ccv-computer-use] invalid --coordinate-mode "${coordModeRaw}" (expected "pixels" or "normalized_0_100")\n`,
    )
    process.exit(1)
  }
  const coordinateMode: CoordinateMode = coordModeRaw

  // ── Transport selection ──────────────────────────────────────────────
  const httpPortRaw = values.http
  let httpPort: number | undefined
  if (httpPortRaw !== undefined) {
    const parsed = Number.parseInt(httpPortRaw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      process.stderr.write(
        `[ccv-computer-use] invalid --http port "${httpPortRaw}" (expected 1-65535)\n`,
      )
      process.exit(1)
    }
    httpPort = parsed
  }

  // Refuse obviously-unsafe bind addresses. Loopback aliases (127.0.0.2,
  // ::1) are allowed; anything else is almost always a mistake — computer-
  // use over a LAN exposes mouse/keyboard control to the network.
  const httpHost = values['http-host'] ?? '127.0.0.1'
  if (
    httpPort !== undefined &&
    httpHost !== '127.0.0.1' &&
    httpHost !== 'localhost' &&
    httpHost !== '::1' &&
    httpHost !== '[::1]' &&
    !httpHost.startsWith('127.')
  ) {
    process.stderr.write(
      `[ccv-computer-use] refusing to bind --http-host "${httpHost}". ` +
        'computer-use must listen on localhost; binding a public interface ' +
        'exposes mouse/keyboard control to the network.\n',
    )
    process.exit(1)
  }
  const httpPath = values['http-path'] ?? '/mcp'

  // ── Build server ─────────────────────────────────────────────────────
  const executor = createDefaultExecutor()
  const adapter = createStandaloneAdapter({
    serverName: 'ccv-computer-use',
    executor,
    logLevel: values['log-level'] as 'debug' | 'info' | 'warn' | 'error' | undefined,
  })

  const sessionId = randomUUID()
  const sessionContext = createInMemorySessionContext({
    sessionId,
    lockPath: values['no-lock'] ? '/dev/null/ccv-computer-use.lock.skip' : undefined,
    // No GUI overlay: teach_step blocks indefinitely without auto-advance,
    // so the CLI ships with auto-advance ON by default. The flag is still
    // exposed so a future GUI host (or a test harness) can flip it off
    // explicitly via `--no-teach-auto-advance` if needed.
    teachAutoAdvance: values['teach-auto-advance'] ?? true,
  })

  const server = createComputerUseMcpServer(
    adapter,
    coordinateMode,
    sessionContext,
  )

  // ── ESC hotkey ───────────────────────────────────────────────────────
  let unregisterEsc: (() => void) | undefined
  if (values['esc-hotkey']) {
    unregisterEsc = registerEscapeHotkey(() => {
      logger.info('ESC pressed — aborting in-flight computer-use action')
      sessionContext._internal.abort()
    })
  }

  // ── Signal handling ──────────────────────────────────────────────────
  let closeHttp: (() => Promise<void>) | undefined
  const cleanup = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`)
    try {
      unregisterEsc?.()
    } catch {}
    try {
      await closeHttp?.()
    } catch {}
    try {
      await sessionContext._internal.lockHandle?.release()
    } catch {}
    process.exit(0)
  }
  process.on('SIGINT', () => void cleanup('SIGINT'))
  process.on('SIGTERM', () => void cleanup('SIGTERM'))
  if (httpPort === undefined) {
    // stdin EOF is the stdio client's "I'm done" signal. In HTTP mode stdin
    // is irrelevant (the server is typically daemonized or run in the
    // foreground of a terminal), so don't hook it.
    process.stdin.on('end', () => void cleanup('stdin end'))
  }

  // ── Start ────────────────────────────────────────────────────────────
  if (httpPort !== undefined) {
    logger.info(
      `starting HTTP server (session=${sessionId.slice(0, 8)}, coordMode=${coordinateMode}, platform=${process.platform}, host=${httpHost}, port=${httpPort}, path=${httpPath})`,
    )
    closeHttp = await startHttpServer(server, {
      port: httpPort,
      host: httpHost,
      path: httpPath,
      onError: err =>
        logger.error(
          `http transport: ${err instanceof Error ? err.message : String(err)}`,
        ),
    })
  } else {
    logger.info(
      `starting stdio server (session=${sessionId.slice(0, 8)}, coordMode=${coordinateMode}, platform=${process.platform})`,
    )
    await startStdioServer(server)
  }
}

main().catch(err => {
  process.stderr.write(
    `[ccv-computer-use] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  )
  process.exit(1)
})
