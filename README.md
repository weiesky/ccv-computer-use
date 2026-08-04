# cc-computer-use

Standalone, portable **Computer-Use MCP server** extracted from Claude Code 2.1.220. Cross-platform screenshot, mouse, keyboard, clipboard, and application management via the [Model Context Protocol](https://modelcontextprotocol.io/).

**为什么有这个包**：Claude Code 的 computer-use MCP 是 Anthropic 内部功能，不对第三方 API 开放。本包把完整实现提取为独立 npm 包，任何 MCP 兼容的 Agent 都能集成。

## 功能

- **30 个 MCP 工具**（含 teach 模式 3 个：无 GUI overlay，auto-advance 每一步）
- **三平台支持**：macOS / Windows / Linux (X11)
- **截图** + zoom + 多 display
- **完整鼠标**：move / click (left/right/middle/double/triple) / drag / scroll / up / down
- **完整键盘**：type / key / hold_key / 组合键 / 系统键黑名单
- **剪贴板**：read / write
- **应用管理**：list installed / list running / open / frontmost detection
- **computer_batch**：单次 RPC 执行动作序列
- **Teach 模式**：`request_teach_access` / `teach_step` / `teach_batch`，无 overlay 时自动推进
- **应用分级**：browser/trading → read-only, terminal/IDE → click-only, 其他 → full
- **跨进程文件锁**：`cc-computer-use.lock` 防止多 session 并发控制
- **macOS TCC 检测**：Accessibility + Screen Recording 权限状态
- **kill-switch**：`ALLOW_ANT_COMPUTER_USE_MCP` 环境变量门控
- **Pixel validation**：9×9 patch 防陈旧截图点击（sharp/libvips 解码 JPEG）

## 安装

```bash
npm install cc-computer-use
# 或者从本地目录
npm install /path/to/cc-computer-use
```

### 平台依赖

| 平台 | 系统依赖 | 权限 |
|---|---|---|
| **macOS** | 仅系统自带 (`osascript`, `screencapture`) | Accessibility + Screen Recording 授权给运行进程 |
| **Windows** | PowerShell 5+ (默认有) | 无 |
| **Linux** | `apt install xdotool scrot wmctrl x11-utils xclip` | X11 session（Wayland 不支持） |

> **libvips**：`sharp` 在 `npm install` 时会自动下载对应平台的预编译 libvips 二进制（`@img/sharp-*`），无需系统级安装。仅在冷门架构（如 Alpine/musl、riscv64）需要手工编译 — 详见 [sharp 安装文档](https://sharp.pixelplumbing.com/install)。

## 使用

### 作为 stdio MCP server（最常见）

```bash
ALLOW_ANT_COMPUTER_USE_MCP=1 npx cc-computer-use
```

### 集成到 Claude Code

```bash
claude mcp add cc-computer-use --transport stdio -- \
  env ALLOW_ANT_COMPUTER_USE_MCP=1 npx cc-computer-use
```

然后让模型调用 `mcp__cc-computer-use__request_access`、`mcp__cc-computer-use__screenshot`、`mcp__cc-computer-use__left_click` 等工具。

### 集成到其他 Agent

```typescript
import {
  createComputerUseMcpServer,
  createStandaloneAdapter,
  createDefaultExecutor,
  createInMemorySessionContext,
  startStdioServer,
} from 'cc-computer-use'
import { randomUUID } from 'node:crypto'

const executor = createDefaultExecutor()
const adapter = createStandaloneAdapter({ serverName: 'cc-computer-use', executor })
const sessionContext = createInMemorySessionContext({ sessionId: randomUUID() })
const server = createComputerUseMcpServer(adapter, 'pixels', sessionContext)

await startStdioServer(server)
```

## 工具列表（30 个）

| 类别 | 工具 |
|---|---|
| **权限** | `request_access`, `list_granted_applications` |
| **Teach 模式** | `request_teach_access`, `teach_step`, `teach_batch` |
| **屏幕** | `screenshot`, `zoom`, `switch_display` |
| **鼠标** | `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll` |
| **键盘** | `type`, `key`, `hold_key` |
| **剪贴板** | `read_clipboard`, `write_clipboard` |
| **应用** | `open_application` |
| **批处理** | `computer_batch` |
| **其他** | `wait` |

完整工具 schema 见 `src/tools.ts`。

### Teach 模式（无 GUI overlay）

独立包没有 desktop 主进程的 tooltip overlay 窗口。当模型调用 `request_teach_access` 时：
1. 应用按 proposedTier 授权（同 `request_access`，但无 clipboard / systemKeyCombos flags）
2. 内存中 `teachModeActive = true`，主进程无窗口可隐藏，无 UI 副作用
3. 每次 `teach_step` 立即返回 `{action: 'next'}`，执行 `actions[]` 并返回最新 screenshot（与 desktop overlay 上用户点 Next 的语义一致，只是没有等待）
4. 适合 headless 自动化测试与无 GUI 的容器环境

通过 `--teach-auto-advance=false`（或编程 API `sessionContext.setTeachAutoAdvance(false)` + `resumeTeachStep(...)`）可以让每个 step 阻塞，由调用方手动推进。

## 系统 Prompt 集成

在你的 Agent 系统提示中加入：

```
You have a computer-use MCP available (tools named `mcp__cc-computer-use__*`).
It lets you take screenshots of the user's desktop and control it with mouse
clicks, keyboard input, and scrolling. Before any computer-use tool call,
you MUST first call `mcp__cc-computer-use__request_access` to obtain permission
from the user.
```

或者 import 常量：

```typescript
import { SYSTEM_PROMPT_SNIPPET } from 'cc-computer-use'
```

## 安全

**这个 MCP 给模型完整的鼠标和键盘控制权**。默认行为：

- 必须显式设置 `ALLOW_ANT_COMPUTER_USE_MCP=1` 才启动
- 跨进程文件锁防止多个 session 并发控制
- 系统级组合键（`cmd+q`、`ctrl+alt+delete` 等）默认被阻止
- 浏览器/交易软件/终端在应用分级中默认低权限（read 或 click-only）
- 模型每次调用 `request_access` 都会在 stderr 留下审计日志

**生产环境部署时**：

- 在容器或 VM 中运行，限制网络访问
- 不要在共享工作站上运行
- 监控 stderr 日志
- 考虑通过 `--coordinate-mode normalized_0_100` 让模型看到的坐标与物理分辨率解耦

## CLI 选项

```
cc-computer-use [options]

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
  --log-level <level>              silly | debug | info | warn | error.
```

## 编程 API

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
} from 'cc-computer-use'
```

完整类型导出见 `src/index.ts`。

## Phase 2 (Roadmap)

以下功能在 Claude Code 2.1.220 中存在但本包首版未实现：

- **Teach 模式** (`request_teach_access`, `teach_step`, `teach_batch`)：✅ 已实现（无 GUI overlay；每步自动推进）
- **Windows UIA 工具** (`click_element`, `bind_window`, `open_terminal` 等 11 个）：✅ 已实现（纯 PowerShell + C# Add-Type，无 Python bridge 依赖）
- **iOS Simulator**（16 个 `ios_*` 工具）：✅ 已实现（`xcrun simctl` + 可选 `idb`，参考 whitesmith/ios-simulator-mcp）
- **Pixel validation**：✅ 已实现（用 `sharp` 替代 Electron `nativeImage`，9×9 raw RGB patch 字节相等判定）
- **ESC 中断热键**：✅ 已实现（`node-global-key-listener`）
- **HTTP transport**：✅ 已实现（Streamable HTTP，含 Origin 验证 + localhost-only bind）
- **Compositor-level 应用隐藏**：❌ 需要 Swift/Electron 配合，独立包难以实现

## 与原版的差异

| 功能 | Claude Code 2.1.220 | 本包 |
|---|---|---|
| 27 个核心工具 | ✅ | ✅ |
| 应用分级 | ✅ | ✅ |
| 跨进程锁 | ✅ | ✅ |
| TCC 检查 | ✅ (Electron) | ✅ (JXA) |
| Teach 模式 | ✅ | ✅ (无 overlay；auto-advance) |
| Windows UIA (11 工具) | ✅ (Python bridge) | ✅ (纯 PowerShell + C#) |
| iOS Simulator | ✅ (Desktop only) | ✅ (xcrun simctl + idb) |
| Compositor 隐藏 | ✅ | ❌ |
| Pixel validation | ✅ (Electron nativeImage) | ✅ (sharp/libvips) |
| ESC 中断热键 | ✅ | ✅ (node-global-key-listener) |
| stdio transport | ✅ | ✅ |
| HTTP transport | ❌ | ✅ (Streamable HTTP) |

## License

Apache-2.0

## Credits

Extracted from [Claude Code](https://github.com/anthropics/claude-code) 2.1.220 by Anthropic. Original implementation is Anthropic's proprietary code; this extraction is for research/portability purposes.
