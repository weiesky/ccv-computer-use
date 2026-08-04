/**
 * Host adapter for the standalone MCP server.
 *
 * `ComputerUseHostAdapter` is the seam the core tool-dispatch code uses to
 * talk to its host process. The desktop host implements it with Electron
 * primitives (nativeImage for crop, app store for prefs); this standalone
 * adapter wires the same surface to:
 *
 *   - a stderr logger (no telemetry pipeline),
 *   - TCC checks via osascript (macOS only),
 *   - the env-var kill switch (no app-preferences store),
 *   - `sharp` (libvips) for the JPEG decode + crop used by pixel validation,
 *   - a fixed set of sub-gates appropriate for a no-GUI process.
 *
 * Pixel validation is enabled (`pixelValidation: true`) and implemented via
 * `sharp.extract(...).raw().toBuffer()`. Any decode or crop failure resolves
 * to null, which the caller treats as `skipped` — validation failure must
 * never block the click.
 */

import sharp from 'sharp'

import type { ComputerExecutor } from '../executor.js'
import { isComputerUseEnabled } from '../server/killSwitch.js'
import {
  type ComputerUseHostAdapter,
  type CuSubGates,
  toLoggerDetail,
} from '../types.js'
import { createStderrLogger } from './logger.js'
import { checkTccState } from './tcc.js'

export interface AdapterOptions {
  /** Server name shown in logs and MCP `serverInfo`. Defaults to "ccv-computer-use". */
  serverName?: string
  /** Platform executor (darwin/win32/linux). Constructed by the CLI entry. */
  executor: ComputerExecutor
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export function createStandaloneAdapter(
  opts: AdapterOptions,
): ComputerUseHostAdapter {
  const serverName = opts.serverName ?? 'ccv-computer-use'
  const logger = createStderrLogger(serverName, opts.logLevel ?? 'info')

  return {
    serverName,
    logger,
    executor: opts.executor,

    async ensureOsPermissions() {
      const tcc = checkTccState()
      if (tcc.accessibility && tcc.screenRecording) {
        return { granted: true as const }
      }
      return { granted: false as const, ...tcc }
    },

    isDisabled() {
      return !isComputerUseEnabled()
    },

    getAutoUnhideEnabled() {
      // No GUI to unhide — we never hide windows in the first place.
      return false
    },

    getSubGates(): CuSubGates {
      return {
        // sharp is wired up — the 9×9 staleness guard is fully live.
        pixelValidation: true,
        // Multiline type-through-clipboard works fine with our pbcopy/powershell/xclip shim.
        clipboardPasteMultiline: true,
        // No compositor; the cursor is real, animating it adds latency with no benefit.
        mouseAnimation: false,
        // No window-hiding machinery in the standalone host.
        hideBeforeAction: false,
        // No display auto-resolution (single-display assumption in the standalone executor).
        autoTargetDisplay: false,
        // No clipboardGuard without an app-frontmost watcher.
        clipboardGuard: false,
      }
    },

    async cropRawPatch(jpegBase64, rect) {
      try {
        const jpeg = Buffer.from(jpegBase64, 'base64')
        const raw = await sharp(jpeg)
          .extract({
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          })
          .raw()
          .toBuffer()
        return raw
      } catch (err) {
        // Validation failure must never block the click — the caller treats
        // null as `skipped` and proceeds.
        logger.debug('[adapter] cropRawPatch failed', toLoggerDetail(err))
        return null
      }
    },
  }
}
