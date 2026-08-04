/**
 * Bound-window state for Windows UIA / virtual-input tools.
 *
 * Tracks the currently-bound HWND so that follow-up operations (virtual
 * keyboard/mouse, wheel, window management, UIA clicks) all target the same
 * window without the caller having to repeat the HWND each time.
 *
 * State is process-local and module-level — the MCP server is a singleton
 * per session, so a single global bound window matches how the desktop
 * bridge works upstream.
 */

import { psAsync } from '../_shared/spawn.js'
import { listWindows, type WindowInfo } from './windowEnum.js'
import { validateHwnd } from './shared.js'

export interface BoundWindow {
  hwnd: string
  title: string
  pid: number
}

let boundWindow: BoundWindow | null = null

/** Validate a title string for safe interpolation into a PowerShell single-quoted string. */
function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/** Get the current bound window, or null if none. */
export function getBoundWindow(): BoundWindow | null {
  return boundWindow
}

/** Clear the binding (idempotent). */
export function unbindFromWindow(): void {
  boundWindow = null
}

/**
 * Check whether the bound window is still alive. Clears state if not.
 * Uses PowerShell IsWindow to test the HWND.
 */
export async function validateBoundWindow(): Promise<boolean> {
  if (!boundWindow) return false
  const hwnd = validateHwnd(boundWindow.hwnd)
  try {
    const out = await psAsync(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinIsWindow {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@
[WinIsWindow]::IsWindow([IntPtr]::new(${hwnd}))
`)
    const alive = out.trim().toLowerCase() === 'true'
    if (!alive) boundWindow = null
    return alive
  } catch {
    return false
  }
}

/**
 * Bind to a window by hwnd / pid / title (in that precedence).
 * Returns the bound window info, or null if no window matched.
 *
 * Title matching is partial, case-insensitive.
 */
export async function bindToWindow(query: {
  hwnd?: string
  title?: string
  pid?: number
}): Promise<BoundWindow | null> {
  const windows = listWindows()

  let match: WindowInfo | undefined
  if (query.hwnd) {
    const targetHwnd = validateHwnd(query.hwnd)
    match = windows.find(w => w.hwnd === targetHwnd)
  }
  if (!match && typeof query.pid === 'number') {
    match = windows.find(w => w.pid === query.pid)
  }
  if (!match && query.title) {
    const needle = query.title.toLowerCase()
    match = windows.find(w => w.title.toLowerCase().includes(needle))
  }
  if (!match) return null

  boundWindow = { hwnd: match.hwnd, title: match.title, pid: match.pid }
  return boundWindow
}

/**
 * Get current binding status including live window rect.
 * Returns null if no window is bound.
 */
export async function getBindingStatus(): Promise<{
  bound: boolean
  hwnd?: string
  title?: string
  pid?: number
  rect?: { x: number; y: number; width: number; height: number }
} | null> {
  const bound = boundWindow
  if (!bound) return { bound: false }

  const hwnd = validateHwnd(bound.hwnd)
  try {
    const out = await psAsync(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@
$hwndPtr = [IntPtr]::new(${hwnd})
if (-not [WinRect]::IsWindow($hwndPtr)) { "dead"; exit }
$r = New-Object WinRect+RECT
[WinRect]::GetWindowRect($hwndPtr, [ref]$r) | Out-Null
"$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
`)
    const trimmed = out.trim()
    if (trimmed === 'dead') {
      boundWindow = null
      return { bound: false }
    }
    const parts = trimmed.split(',').map(Number)
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
      return { bound: true, hwnd: bound.hwnd, title: bound.title, pid: bound.pid }
    }
    const [left, top, right, bottom] = parts as [number, number, number, number]
    return {
      bound: true,
      hwnd: bound.hwnd,
      title: bound.title,
      pid: bound.pid,
      rect: {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      },
    }
  } catch {
    return { bound: true, hwnd: bound.hwnd, title: bound.title, pid: bound.pid }
  }
}

/**
 * Activate the bound window: bring to foreground + optional click to focus.
 * Returns true on success, false if no window bound.
 */
export async function activateBoundWindow(
  clickX?: number,
  clickY?: number,
): Promise<boolean> {
  if (!boundWindow) return false
  const hwnd = validateHwnd(boundWindow.hwnd)

  const clickPart =
    typeof clickX === 'number' && typeof clickY === 'number'
      ? `
  $lParam = [IntPtr]((${clickY} -band 0xFFFF) -shl 16 -bor (${clickX} -band 0xFFFF))
  [WinActivate]::PostMessage($hwndPtr, 0x0201, [IntPtr]1, $lParam) | Out-Null
  Start-Sleep -Milliseconds 30
  [WinActivate]::PostMessage($hwndPtr, 0x0202, [IntPtr]::Zero, $lParam) | Out-Null
`
      : ''

  try {
    await psAsync(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinActivate {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
'@
$hwndPtr = [IntPtr]::new(${hwnd})
if (-not [WinActivate]::IsWindow($hwndPtr)) { "dead"; exit }
[WinActivate]::ShowWindow($hwndPtr, 9) | Out-Null
[WinActivate]::BringWindowToTop($hwndPtr) | Out-Null
[WinActivate]::SetForegroundWindow($hwndPtr) | Out-Null
${clickPart}
"ok"
`)
    return true
  } catch {
    return false
  }
}

export const __internal = { psQuote }
