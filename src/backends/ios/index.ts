/**
 * iOS Simulator backend for computer-use.
 *
 * Exposes detection + building blocks for the `ios_*` MCP tools. The tool
 * schemas themselves live in `tools.ts` (`buildIOSTools`); dispatch handlers
 * live in `toolCalls.ts`. This module is pure low-level — no MCP types.
 */

export {
  getBootedSimulator,
  isIdbAvailable,
  isIOSSimulatorAvailable,
  listSimulators,
  bootSimulator,
  shutdownSimulator,
} from './simulator.js'
export type { IOSSimulator, IOSSimulatorState } from './simulator.js'

export { captureIOSScreenshot } from './screenshot.js'
export type { IOSScreenshotResult } from './screenshot.js'

export {
  getUIHierarchy,
  longPress,
  openUrl,
  pressButton,
  swipe,
  tap,
  typeText,
} from './interactions.js'
export type { IOSHardwareButton, UIElement } from './interactions.js'

export {
  installApp,
  launchApp,
  listApps,
  terminateApp,
  uninstallApp,
} from './apps.js'

export { clearLocation, setLocation } from './location.js'
