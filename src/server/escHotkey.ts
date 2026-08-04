/**
 * Global ESC hotkey registration.
 *
 * The desktop host registers a system-wide ESC handler so the user can bail
 * out of a running batch of clicks even when the focused window belongs to
 * the controlled app. This module provides that via `node-global-key-listener`,
 * which uses low-level hooks (Windows), Event Taps (macOS), or X11 record
 * (Linux).
 *
 * Platform notes:
 *   - macOS: requires Accessibility permission granted to the host process
 *     (already covered by the TCC check the server runs at startup).
 *   - Windows: works without elevation for most keys, but may require admin
 *     to capture events sent to elevated windows. Runs in a low-level hook.
 *   - Linux: X11 only (Wayland has no equivalent global hook without
 *     compositor-specific portals).
 *
 * `registerEscapeHotkey` returns an unregister function. The listener
 * attaches lazily — if the underlying platform hook fails to start (e.g.
 * missing Accessibility permission), the promise rejects asynchronously and
 * the caller can decide to log-and-continue (ESC abort is a UX affordance,
 * not a hard safety gate — the kill-switch and lock are the gates).
 */

import { GlobalKeyboardListener } from 'node-global-key-listener'

export interface EscapeHotkeyOptions {
  /**
   * Called when the listener fails to start (e.g. permission denied).
   * Defaults to a stderr write. Set to `() => {}` to silence.
   */
  onError?: (err: unknown) => void
}

export function registerEscapeHotkey(
  callback: () => void,
  opts: EscapeHotkeyOptions = {},
): () => void {
  const onError =
    opts.onError ??
    ((err: unknown) => {
      process.stderr.write(
        `[ccv-computer-use] ESC hotkey unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    })

  const listener = new GlobalKeyboardListener()
  const handler = (e: { name?: string; state: string }) => {
    if (e.name === 'ESCAPE' && e.state === 'DOWN') {
      try {
        callback()
      } catch (err) {
        // Don't let a throwing callback kill the key listener process.
        onError(err)
      }
    }
  }

  // `addListener` starts the platform hook on first registration. It returns
  // a promise that rejects on permission failure — we surface that via onError
  // but still return the unregister handle so the caller can clean up.
  listener.addListener(handler).catch(onError)

  return () => {
    try {
      listener.removeListener(handler)
      listener.kill()
    } catch {
      // Best-effort cleanup — if the key server already died there's nothing
      // to remove.
    }
  }
}
