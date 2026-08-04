/**
 * ComputerExecutor factory.
 *
 * Bridges the low-level PlatformBackend (input + swift APIs) to the
 * ComputerExecutor interface expected by toolCalls.ts.
 */

import { platform } from 'node:os'

import type { PlatformBackend } from '../backends/index.js'
import { createPlatformBackend } from '../backends/index.js'
import { isIOSSimulatorAvailable } from '../backends/ios/index.js'
import { clickElement, typeIntoElement } from '../backends/win32/uia.js'
import {
  activateBoundWindow,
  bindToWindow as win32BindToWindow,
  getBindingStatus,
  getBoundWindow,
  unbindFromWindow as win32UnbindFromWindow,
} from '../backends/win32/windowBinding.js'
import { listWindows } from '../backends/win32/windowEnum.js'
import {
  getWindowRect as win32GetWindowRect,
  manageWindow as win32ManageWindow,
} from '../backends/win32/windowManagement.js'
import {
  mouseWheel as win32MouseWheel,
  virtualKeyboard as win32VirtualKeyboard,
  virtualMouse as win32VirtualMouse,
} from '../backends/win32/virtualInput.js'
import { openTerminal as win32OpenTerminal } from '../backends/win32/terminal.js'
import { respondToPrompt as win32RespondToPrompt } from '../backends/win32/promptRespond.js'
import { statusIndicator as win32StatusIndicator } from '../backends/win32/statusIndicator.js'
import type {
  ComputerExecutor,
  ComputerExecutorCapabilities,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
} from '../executor.js'
import { readClipboard, writeClipboard } from './clipboard.js'

const HOST_BUNDLE_IDS: Record<string, string> = {
  darwin: 'com.apple.Terminal',
  win32: 'cmd.exe',
  linux: 'xterm',
}

function hostBundleId(): string {
  const p = platform()
  return HOST_BUNDLE_IDS[p] ?? 'unknown'
}

function capabilities(): ComputerExecutorCapabilities {
  const p = platform()
  return {
    screenshotFiltering: 'none', // No compositor-level filtering in standalone mode
    platform: p === 'darwin' ? 'darwin' : 'win32',
    hostBundleId: hostBundleId(),
    // Expose teach tools. Without a GUI overlay the session context
    // auto-advances each step (no Next-click wait), which is exactly the
    // headless behavior.
    teachMode: true,
    // Probe once at executor construction — simctl list is fast (<50ms).
    // On non-darwin or without Xcode this returns false and the ios_* tools
    // are simply omitted from the MCP tool list.
    iosSimulatorAvailable: isIOSSimulatorAvailable(),
  }
}

export function createExecutorFromBackend(
  backend: PlatformBackend,
): ComputerExecutor {
  const { input, swift } = backend

  const baseExecutor: ComputerExecutor = {
    capabilities: capabilities(),

    async prepareForAction(_allowlistBundleIds, _displayId) {
      // No compositor-level hide in standalone mode.
      // Hide is the host app's job (via Swift/Electron); here we no-op.
      return []
    },

    async previewHideSet(_allowlistBundleIds, _displayId) {
      return []
    },

    async getDisplaySize(displayId) {
      const g = swift.display.getSize(displayId)
      return {
        displayId: g.displayId,
        width: g.width,
        height: g.height,
        scaleFactor: g.scaleFactor,
        originX: 0,
        originY: 0,
        label: g.label,
        isPrimary: g.isPrimary,
      } satisfies DisplayGeometry
    },

    async listDisplays() {
      return swift.display.listAll().map(g => ({
        displayId: g.displayId,
        width: g.width,
        height: g.height,
        scaleFactor: g.scaleFactor,
        originX: 0,
        originY: 0,
        label: g.label,
        isPrimary: g.isPrimary,
      }))
    },

    async findWindowDisplays(bundleIds) {
      return swift.apps.findWindowDisplays(bundleIds)
    },

    async resolvePrepareCapture(opts) {
      const targetW = 1568
      const targetH = 1568
      const result = await swift.screenshot.captureExcluding(
        opts.allowedBundleIds,
        80,
        targetW,
        targetH,
        opts.preferredDisplayId,
      )
      const displayGeom = swift.display.getSize(opts.preferredDisplayId)
      return {
        base64: result.base64,
        width: result.width,
        height: result.height,
        displayWidth: displayGeom.width,
        displayHeight: displayGeom.height,
        originX: 0,
        originY: 0,
        displayId: result.displayId ?? opts.preferredDisplayId ?? 0,
        hidden: result.hidden ?? [],
        captureError: result.captureError,
      } satisfies ResolvePrepareCaptureResult
    },

    async screenshot(opts) {
      const targetW = 1568
      const targetH = 1568
      const result = await swift.screenshot.captureExcluding(
        opts.allowedBundleIds,
        80,
        targetW,
        targetH,
        opts.displayId,
      )
      const displayGeom = swift.display.getSize(opts.displayId)
      return {
        base64: result.base64,
        width: result.width,
        height: result.height,
        displayWidth: displayGeom.width,
        displayHeight: displayGeom.height,
        originX: 0,
        originY: 0,
        displayId: opts.displayId,
      } satisfies ScreenshotResult
    },

    async zoom(regionLogical, allowedBundleIds, displayId) {
      const scaleFactor = swift.display.getSize(displayId).scaleFactor
      const x = Math.round(regionLogical.x * scaleFactor)
      const y = Math.round(regionLogical.y * scaleFactor)
      const w = Math.round(regionLogical.w * scaleFactor)
      const h = Math.round(regionLogical.h * scaleFactor)
      return swift.screenshot.captureRegion(
        allowedBundleIds,
        x,
        y,
        w,
        h,
        w,
        h,
        90,
        displayId,
      )
    },

    async key(keySequence, repeat = 1) {
      const parts = keySequence.split('+').map(s => s.trim())
      for (let i = 0; i < repeat; i++) {
        await input.keys(parts)
      }
    },

    async holdKey(keyNames, durationMs) {
      const parts = keyNames.flatMap(n => n.split('+').map(s => s.trim()))
      // Press all modifiers down
      for (const p of parts) {
        await input.key(p, 'press')
      }
      await new Promise(r => setTimeout(r, durationMs))
      // Release in reverse order
      for (const p of [...parts].reverse()) {
        await input.key(p, 'release')
      }
    },

    async type(text, _opts) {
      await input.typeText(text)
    },

    async readClipboard() {
      return readClipboard()
    },

    async writeClipboard(text) {
      writeClipboard(text)
    },

    async moveMouse(x, y) {
      await input.moveMouse(x, y, false)
    },

    async click(x, y, button, count, modifiers) {
      if (modifiers && modifiers.length > 0) {
        for (const m of modifiers) {
          await input.key(m, 'press')
        }
      }
      await input.moveMouse(x, y, false)
      await input.mouseButton(button, 'click', count)
      if (modifiers && modifiers.length > 0) {
        for (const m of [...modifiers].reverse()) {
          await input.key(m, 'release')
        }
      }
    },

    async mouseDown() {
      await input.mouseButton('left', 'press')
    },

    async mouseUp() {
      await input.mouseButton('left', 'release')
    },

    async getCursorPosition() {
      return input.mouseLocation()
    },

    async drag(from, to) {
      if (from) {
        await input.moveMouse(from.x, from.y, false)
      }
      await input.mouseButton('left', 'press')
      await input.moveMouse(to.x, to.y, true)
      await input.mouseButton('left', 'release')
    },

    async scroll(x, y, dx, dy) {
      await input.moveMouse(x, y, false)
      if (dy !== 0) {
        await input.mouseScroll(dy, 'vertical')
      }
      if (dx !== 0) {
        await input.mouseScroll(dx, 'horizontal')
      }
    },

    async getFrontmostApp(): Promise<FrontmostApp | null> {
      const info = input.getFrontmostAppInfo()
      if (!info) return null
      return { bundleId: info.bundleId, displayName: info.appName }
    },

    async appUnderPoint(x, y) {
      return swift.apps.appUnderPoint(x, y)
    },

    async listInstalledApps(): Promise<InstalledApp[]> {
      return swift.apps.listInstalled()
    },

    async getAppIcon(path) {
      return swift.apps.iconDataUrl(path) ?? undefined
    },

    async listRunningApps(): Promise<RunningApp[]> {
      return swift.apps.listRunning()
    },

    async openApp(bundleId) {
      await swift.apps.open(bundleId)
    },
  }

  // On Windows, expose the optional UIA / bound-window / virtual-input methods.
  // The dispatch layer in toolCalls.ts checks for these — tools are gated by
  // method presence, so we only attach them on win32.
  if (platform() === 'win32') {
    baseExecutor.manageWindow = async (action, opts) =>
      win32ManageWindow(action, opts ?? {})
    baseExecutor.getWindowRect = async () => win32GetWindowRect()

    baseExecutor.openTerminal = async opts => win32OpenTerminal(opts)
    baseExecutor.bindToWindow = async query => win32BindToWindow(query)
    baseExecutor.unbindFromWindow = async () => {
      win32UnbindFromWindow()
    }
    baseExecutor.hasBoundWindow = async () => getBoundWindow() !== null
    baseExecutor.getBindingStatus = async () => getBindingStatus()
    baseExecutor.listVisibleWindows = async () => listWindows()

    baseExecutor.statusIndicator = async (action, message) =>
      win32StatusIndicator(action, message)
    baseExecutor.virtualKeyboard = async opts => win32VirtualKeyboard(opts)
    baseExecutor.virtualMouse = async opts => win32VirtualMouse(opts)
    baseExecutor.mouseWheel = async (x, y, delta, horizontal) =>
      win32MouseWheel(x, y, delta, horizontal)
    baseExecutor.activateWindow = async (clickX, clickY) =>
      activateBoundWindow(clickX, clickY)
    baseExecutor.respondToPrompt = async opts => win32RespondToPrompt(opts)

    baseExecutor.clickElement = async query => clickElement(query)
    baseExecutor.typeIntoElement = async (query, text) =>
      typeIntoElement(query, text)
  }

  return baseExecutor
}

export function createDefaultExecutor(): ComputerExecutor {
  const backend = createPlatformBackend()
  if (!backend) {
    throw new Error(
      `Unsupported platform: ${platform()}. Only darwin, win32, linux are supported.`,
    )
  }
  return createExecutorFromBackend(backend)
}
