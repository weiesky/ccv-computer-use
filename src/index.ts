/**
 * ccv-computer-use — standalone Computer-Use MCP server.
 *
 * Public API surface:
 *   - Tool schemas + handlers (re-exported from ccv-computer-use core)
 *   - ComputerExecutor interface + default factory
 *   - HostAdapter (standalone, no-GUI) factory
 *   - SessionContext (in-memory) factory
 *   - Lock + kill-switch primitives
 *   - CLI entry (`./cli.js`)
 */

// ── Core types ────────────────────────────────────────────────────────
export type {
  AppGrant,
  ComputerUseHostAdapter,
  ComputerUseOverrides,
  ComputerUseSessionContext,
  CoordinateMode,
  CuAppPermTier,
  CuGrantFlags,
  CuPermissionRequest,
  CuPermissionResponse,
  CuSubGates,
  CuTeachPermissionRequest,
  Logger,
  ResolvedAppRequest,
  ScreenshotDims,
  TeachStepRequest,
  TeachStepResult,
} from './types.js'
export { DEFAULT_GRANT_FLAGS } from './types.js'

export type {
  ComputerExecutor,
  ComputerExecutorCapabilities,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
} from './executor.js'

// ── MCP server ────────────────────────────────────────────────────────
export { bindSessionContext, createComputerUseMcpServer } from './mcpServer.js'
export { buildComputerUseTools } from './tools.js'
export { defersLockAcquire, handleToolCall } from './toolCalls.js'
export type {
  CuCallTelemetry,
  CuCallToolResult,
  CuErrorKind,
} from './toolCalls.js'

// ── Policy + filtering ────────────────────────────────────────────────
export {
  SENTINEL_BUNDLE_IDS,
  getSentinelCategory,
} from './sentinelApps.js'
export type { SentinelCategory } from './sentinelApps.js'
export {
  categoryToTier,
  getDefaultTierForApp,
  getDeniedCategory,
  getDeniedCategoryByDisplayName,
  getDeniedCategoryForApp,
  isPolicyDenied,
} from './deniedApps.js'
export type { DeniedCategory } from './deniedApps.js'
export { isSystemKeyCombo, normalizeKeySequence } from './keyBlocklist.js'
export { isSandboxMode, sandboxNotice } from './sandbox.js'

// ── Image utilities ───────────────────────────────────────────────────
export { API_RESIZE_PARAMS, targetImageSize } from './imageResize.js'
export type { ResizeParams } from './imageResize.js'
export {
  comparePixelAtLocation,
  validateClickTarget,
} from './pixelCompare.js'
export type { CropRawPatchFn, PixelCompareResult } from './pixelCompare.js'

// ── Sub-gates ─────────────────────────────────────────────────────────
export { ALL_SUB_GATES_OFF, ALL_SUB_GATES_ON } from './subGates.js'

// ── Standalone host factories ─────────────────────────────────────────
export { createStandaloneAdapter } from './host/adapter.js'
export type { AdapterOptions } from './host/adapter.js'
export {
  createDefaultExecutor,
  createExecutorFromBackend,
} from './host/executorFactory.js'
export { createStderrLogger } from './host/logger.js'
export { checkTccState } from './host/tcc.js'
export type { TccState } from './host/tcc.js'
export { readClipboard, writeClipboard } from './host/clipboard.js'

// ── Backend factory ───────────────────────────────────────────────────
export {
  createPlatformBackend,
  isPlatformSupported,
} from './backends/index.js'
export type {
  InputBackend,
  PlatformBackend,
  SwiftBackend,
} from './backends/index.js'

// ── Server primitives ─────────────────────────────────────────────────
export { isComputerUseEnabled } from './server/killSwitch.js'
export {
  acquireCuLock,
  checkCuLock,
} from './server/lock.js'
export type { LockCheckResult, LockHandle } from './server/lock.js'
export { createInMemorySessionContext } from './server/sessionContext.js'
export type {
  InMemorySessionContext,
  SessionContextOptions,
} from './server/sessionContext.js'
export { startStdioServer } from './server/stdio.js'
export { startHttpServer } from './server/http.js'
export type { HttpServerOptions } from './server/http.js'
export { registerEscapeHotkey } from './server/escHotkey.js'
export type { EscapeHotkeyOptions } from './server/escHotkey.js'

// ── System prompt snippet (for hosts to inject) ───────────────────────
export const SYSTEM_PROMPT_SNIPPET = `You have a computer-use MCP available (tools named \`mcp__ccv-computer-use__*\`). It lets you take screenshots of the user's desktop and control it with mouse clicks, keyboard input, and scrolling. Before any computer-use tool call, you MUST first call \`mcp__ccv-computer-use__request_access\` to obtain permission from the user.`
