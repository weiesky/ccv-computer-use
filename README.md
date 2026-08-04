# ccv-computer-use

[![License](https://img.shields.io/github/license/weiesky/ccv-computer-use)](LICENSE)
[![npm version](https://img.shields.io/npm/v/ccv-computer-use)](https://www.npmjs.com/package/ccv-computer-use)
[![npm downloads](https://img.shields.io/npm/dm/ccv-computer-use)](https://www.npmjs.com/package/ccv-computer-use)
[![CI](https://github.com/weiesky/ccv-computer-use/actions/workflows/ci.yml/badge.svg)](https://github.com/weiesky/ccv-computer-use/actions/workflows/ci.yml)

**Standalone, portable Computer-Use MCP server** — cross-platform screenshot,
mouse, keyboard, clipboard, and application management via the
[Model Context Protocol](https://modelcontextprotocol.io/).

> **Why this package exists:** Claude Code's built-in `computer-use` MCP server
> is an internal Anthropic feature and is not exposed to third-party clients.
> This package extracts a complete, self-contained implementation so that any
> MCP-compatible agent can integrate desktop control. It is an independent
> distribution, **not** an official Anthropic product.

## Features

- **54 MCP tools** (including 3 teach-mode tools that work headless, auto-advancing each step)
- **Three-platform support**: macOS / Windows / Linux (X11)
- **Screenshots** + zoom + multi-display
- **Full mouse control**: move / click (left/right/middle/double/triple) / drag / scroll / up / down
- **Full keyboard control**: type / key / hold_key / chords / system-key blocklist
- **Clipboard**: read / write
- **App management**: list installed / list running / open / frontmost detection
- **`computer_batch`**: run an action sequence in a single RPC call
- **Teach mode**: `request_teach_access` / `teach_step` / `teach_batch` — auto-advances when no GUI overlay is present
- **App tiering**: browser/trading → read-only, terminal/IDE → click-only, everything else → full
- **Cross-process file lock**: `ccv-computer-use.lock` prevents concurrent control from multiple sessions
- **macOS TCC detection**: Accessibility + Screen Recording permission status
- **Kill-switch**: gated behind the `ALLOW_ANT_COMPUTER_USE_MCP` environment variable
- **Pixel validation**: 9×9 patch comparison (sharp/libvips JPEG decode) prevents stale-screenshot clicks
- **HTTP transport**: Streamable HTTP on localhost with Origin validation (DNS-rebinding protection)

## Installation

```bash
npm install -g ccv-computer-use     # global, exposes the `ccv-computer-use` binary
npm install ccv-computer-use        # or as a dependency of your project
```

> Requires **Node.js 18+**. On first install, `sharp` downloads its prebuilt
> libvips binary for your platform automatically — no system-level install
> needed. Only exotic architectures (Alpine/musl, riscv64) require manual
> compilation — see the [sharp install docs](https://sharp.pixelplumbing.com/install).

### Platform dependencies

| Platform | System dependencies | Permissions |
|---|---|---|
| **macOS** | Built-in only (`osascript`, `screencapture`) | Accessibility + Screen Recording granted to the running process |
| **Windows** | PowerShell 5+ (ships by default) | None |
| **Linux** | `apt install xdotool scrot wmctrl x11-utils xclip` | X11 session (Wayland not supported) |

## Quick start

### 1. Run the stdio MCP server

```bash
ALLOW_ANT_COMPUTER_USE_MCP=1 npx ccv-computer-use
```

The server refuses to start unless the kill-switch environment variable is set.

### 2. Claude Code

```bash
claude mcp add ccv-computer-use --transport stdio -- \
  env ALLOW_ANT_COMPUTER_USE_MCP=1 npx ccv-computer-use
```

Then ask the model to call `mcp__ccv-computer-use__request_access`,
`mcp__ccv-computer-use__screenshot`, `mcp__ccv-computer-use__left_click`, etc.

### 3. Claude Desktop

Edit `claude_desktop_config.json`:

**macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ccv-computer-use": {
      "command": "env",
      "args": ["ALLOW_ANT_COMPUTER_USE_MCP=1", "npx", "ccv-computer-use"]
    }
  }
}
```

**Windows** — `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ccv-computer-use": {
      "command": "cmd",
      "args": ["/c", "set", "ALLOW_ANT_COMPUTER_USE_MCP=1&&", "npx", "ccv-computer-use"]
    }
  }
}
```

> On Windows, `npx` must be wrapped in `cmd /c` to resolve correctly.

### 4. Other MCP clients

Any client that supports stdio MCP servers can run
`env ALLOW_ANT_COMPUTER_USE_MCP=1 npx ccv-computer-use`. For a programmatic
integration, see [Programming API](#programming-api).

## HTTP transport (Streamable HTTP)

The server can run as an HTTP endpoint instead of stdio (useful for remote
agents, containers, or clients without stdio support):

```bash
ALLOW_ANT_COMPUTER_USE_MCP=1 npx ccv-computer-use --http 3456
```

- Binds to `127.0.0.1` only; binding to a non-loopback host is refused.
- Validates the `Origin` header to protect against DNS-rebinding attacks.
- Serve path defaults to `/mcp`; customize with `--http-path`.

## CLI options

```
ccv-computer-use [options]

REQUIRED ENVIRONMENT
  ALLOW_ANT_COMPUTER_USE_MCP=1     Must be set to enable the server.

OPTIONS
  --help, -h                       Show help.
  --version, -v                    Print version.
  --coordinate-mode <mode>         'pixels' (default) or 'normalized_0_100'.
  --no-lock                        Skip the cross-process lock (testing only).
  --teach-auto-advance             Teach mode: skip the Next-click wait between
                                   steps and run each teach_step's actions
                                   immediately. Default in standalone host
                                   (no GUI overlay).
  --esc-hotkey                     Enable a global ESC hotkey to abort input.
  --http <port>                    Serve Streamable HTTP on 127.0.0.1:<port>.
  --http-host <host>               Host to bind (must be loopback, default 127.0.0.1).
  --http-path <path>               HTTP path (default /mcp).
  --log-level <level>              silly | debug | info | warn | error.
```

## Tools (54)

### Core tools — all platforms (28)

| Category | Tools |
|---|---|
| **Permission** | `request_access`, `list_granted_applications` |
| **Teach mode** | `request_teach_access`, `teach_step`, `teach_batch` |
| **Screen** | `screenshot`, `zoom`, `switch_display` |
| **Mouse** | `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `mouse_wheel`, `cursor_position`, `scroll` |
| **Keyboard** | `type`, `key`, `hold_key` |
| **Clipboard** | `read_clipboard`, `write_clipboard` |
| **Apps** | `open_application` |
| **Batch** | `computer_batch` |
| **Misc** | `wait` |

### Windows UIA tools (10)

`activate_window`, `bind_window`, `click_element`, `open_terminal`,
`prompt_respond`, `status_indicator`, `type_into_element`, `virtual_keyboard`,
`virtual_mouse`, `window_management`

These are implemented in pure PowerShell + C# (`Add-Type`) — no Python bridge
dependency.

### iOS Simulator tools (16)

`ios_boot_simulator`, `ios_shutdown_simulator`, `ios_list_simulators`,
`ios_get_device_info`, `ios_install_app`, `ios_launch_app`, `ios_terminate_app`,
`ios_screenshot`, `ios_tap`, `ios_long_press`, `ios_swipe`, `ios_type_text`,
`ios_press_button`, `ios_set_location`, `ios_clear_location`,
`ios_get_ui_hierarchy`

Requires `xcrun simctl` (Xcode) and optionally `idb` for gestures and UI
hierarchy introspection. Tool schemas live in `src/tools.ts` and
`src/iosToolHandlers.ts`.

### Teach mode (headless, no GUI overlay)

This package has no desktop main process, so there is no tooltip overlay
window. When the model calls `request_teach_access`:

1. The app is granted per its proposed tier (same as `request_access`, without
   clipboard / system-key-combo flags).
2. `teachModeActive = true` in memory; no window to hide, no UI side effects.
3. Each `teach_step` immediately returns `{action: 'next'}`, executes the
   `actions[]`, and returns the latest screenshot — semantically identical to
   clicking Next on the desktop overlay, just without the wait.
4. Great for headless automation and GUI-less container environments.

Pass `--teach-auto-advance=false` (or use the API:
`sessionContext.setTeachAutoAdvance(false)` + `resumeTeachStep(...)`) to make
each step block until the caller advances it manually.

## System prompt integration

Add to your agent's system prompt:

```
You have a computer-use MCP available (tools named `mcp__ccv-computer-use__*`).
It lets you take screenshots of the user's desktop and control it with mouse
clicks, keyboard input, and scrolling. Before any computer-use tool call,
you MUST first call `mcp__ccv-computer-use__request_access` to obtain permission
from the user.
```

Or import the constant:

```typescript
import { SYSTEM_PROMPT_SNIPPET } from 'ccv-computer-use'
```

## Programming API

```typescript
import {
  // MCP server
  createComputerUseMcpServer,
  bindSessionContext,
  buildComputerUseTools,
  handleToolCall,
  // Host adapter (standalone)
  createStandaloneAdapter,
  createDefaultExecutor,
  createInMemorySessionContext,
  startStdioServer,
  // Backend (low-level)
  createPlatformBackend,
  // Policy
  getDeniedCategoryForApp,
  isSystemKeyCombo,
  SENTINEL_BUNDLE_IDS,
  // Lock
  acquireCuLock,
  checkCuLock,
  // Constants
  DEFAULT_GRANT_FLAGS,
  SYSTEM_PROMPT_SNIPPET,
  API_RESIZE_PARAMS,
} from 'ccv-computer-use'
```

Full type exports live in `src/index.ts`.

## Security

**This MCP server gives the model full control of the mouse and keyboard.**
Default behavior:

- Refuses to start unless `ALLOW_ANT_COMPUTER_USE_MCP=1` is explicitly set.
- Cross-process file lock prevents concurrent control from multiple sessions.
- System-level key combinations (`Cmd+Q`, `Ctrl+Alt+Delete`, …) are blocked by default.
- Browser/trading software/terminals default to low privilege tiers (read or click-only).
- Every `request_access` call leaves an audit log on stderr.

**When deploying in production:**

- Run inside a container or VM with restricted network access.
- Do not run on shared workstations.
- Monitor stderr logs.
- Consider `--coordinate-mode normalized_0_100` to decouple model-visible
  coordinates from physical resolution.

See [SECURITY.md](SECURITY.md) for the full security model and vulnerability
reporting process.

## Comparison with the original implementation

| Feature | Claude Code 2.1.220 | This package |
|---|---|---|
| 27 core tools | ✅ | ✅ |
| App tiering | ✅ | ✅ |
| Cross-process lock | ✅ | ✅ |
| TCC check | ✅ (Electron) | ✅ (JXA) |
| Teach mode | ✅ | ✅ (no overlay; auto-advance) |
| Windows UIA (10 tools) | ✅ (Python bridge) | ✅ (pure PowerShell + C#) |
| iOS Simulator | ✅ (Desktop only) | ✅ (`xcrun simctl` + idb) |
| Compositor window hiding | ✅ | ❌ (needs Swift/Electron main process) |
| Pixel validation | ✅ (Electron nativeImage) | ✅ (sharp/libvips) |
| ESC abort hotkey | ✅ | ✅ (node-global-key-listener) |
| stdio transport | ✅ | ✅ |
| HTTP transport | ❌ | ✅ (Streamable HTTP) |

## Development

```bash
npm ci
npm run build       # tsc -> dist/
npm run typecheck
npm test            # vitest (unit + integration)
npm run dev         # run CLI from source (tsx)
```

Repository layout:

```
src/                  TypeScript source
  backends/           Platform implementations (darwin / win32 / linux / ios)
  host/               Standalone host adapter, executor factory, TCC detection
  server/             stdio + HTTP transports, lock, kill-switch, session
tests/                vitest unit + integration tests
bin/                  npm binary entry (loads dist/cli.js)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and how to
debug with the MCP Inspector.

## FAQ / Troubleshooting

**Q: The server exits immediately when I run it.**
A: The kill-switch `ALLOW_ANT_COMPUTER_USE_MCP=1` must be set explicitly.

**Q: Linux shows a black / empty screenshot.**
A: You need an X11 session (`DISPLAY` set); Wayland is not supported. Verify
`xdotool`, `scrot`, `wmctrl`, `xclip` are installed.

**Q: macOS shows a permission error when clicking.**
A: Grant Accessibility + Screen Recording to the process running the server
(System Settings → Privacy & Security). macOS TCC detection is built in —
the server reports your permission status.

**Q: `npm install` tries to compile sharp / libvips.**
A: Prebuilt binaries should cover macOS/Windows/Linux on common architectures.
On Alpine/musl you need `--libc=musl` recompilation — see
[sharp's install docs](https://sharp.pixelplumbing.com/install).

**Q: The model clicks at wrong coordinates.**
A: The model may be using stale screenshots. `pixel validation` rejects
screenshots that changed since capture; also try
`--coordinate-mode normalized_0_100`.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Credits

This project was extracted and re-implemented from
[Claude Code](https://github.com/anthropics/claude-code) 2.1.220 (Anthropic) for
research and portability. The original implementation remains Anthropic's
proprietary code; this package is an independent, self-contained distribution
and is **not affiliated with or endorsed by Anthropic**. All trademarks belong
to their respective owners.
