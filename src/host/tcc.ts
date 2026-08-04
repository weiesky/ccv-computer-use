/**
 * macOS TCC (Transparency, Consent, and Control) permission check.
 *
 * The standalone server can't show the system prompt itself — that's owned
 * by the OS when the calling app first attempts the protected action. What
 * we CAN do is preflight, so `request_access` returns a structured "go to
 * System Settings > Privacy" error instead of failing opaquely on the first
 * screenshot.
 *
 * On non-macOS platforms TCC doesn't exist; we report both as granted.
 */

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

export interface TccState {
  accessibility: boolean
  screenRecording: boolean
}

export function checkTccState(): TccState {
  if (platform() !== 'darwin') {
    return { accessibility: true, screenRecording: true }
  }

  let accessibility = false
  let screenRecording = false

  try {
    const result = execFileSync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()',
      ],
      { encoding: 'utf-8' },
    ).trim()
    accessibility = result === 'true'
  } catch {
    // osascript missing or errored — treat as not granted.
  }

  try {
    // CGPreflightScreenCaptureAccess isn't bridged into JXA. Probe by
    // attempting to read the TCC state via `sqlite3` on the user TCC db —
    // when not granted, the row simply isn't there. We deliberately do NOT
    // prompt (that's what `screencapture` will do on first use anyway).
    const result = execFileSync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        'ObjC.import("CoreGraphics"); typeof $.CGPreflightScreenCaptureAccess === "function" ? $.CGPreflightScreenCaptureAccess() : "unknown"',
      ],
      { encoding: 'utf-8' },
    ).trim()
    // When the function is unavailable in the current JXA bridge, fall back
    // to "assume granted" so the standalone server can proceed; the first
    // `screencapture` invocation will fail with a clear OS error if not.
    screenRecording = result !== 'false'
  } catch {
    // Same — treat as granted; the actual capture will surface errors.
    screenRecording = true
  }

  return { accessibility, screenRecording }
}
