/**
 * Window management operations on the bound window via Win32 API.
 *
 * Implements the actions exposed by the `window_management` MCP tool:
 * minimize / maximize / restore / close / focus / move_offscreen / move_resize
 * plus a getWindowRect helper. All target the bound HWND.
 */

import { psAsync } from '../_shared/spawn.js'
import { getBoundWindow } from './windowBinding.js'
import { validateHwnd } from './shared.js'

export type WindowManagementAction =
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'focus'
  | 'move_offscreen'
  | 'move_resize'

const SW_MINIMIZE = 6
const SW_MAXIMIZE = 3
const SW_RESTORE = 9
const WM_CLOSE = 0x0010

export interface ManageWindowOpts {
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Apply a window-management action to the bound window.
 * Returns true on success, false if no window is bound or the call failed.
 */
export async function manageWindow(
  action: string,
  opts: ManageWindowOpts = {},
): Promise<boolean> {
  const bound = getBoundWindow()
  if (!bound) return false
  const hwnd = validateHwnd(bound.hwnd)

  let body = ''
  switch (action as WindowManagementAction) {
    case 'minimize':
      body = `[WinMgmt]::ShowWindow($hwndPtr, ${SW_MINIMIZE}) | Out-Null`
      break
    case 'maximize':
      body = `[WinMgmt]::ShowWindow($hwndPtr, ${SW_MAXIMIZE}) | Out-Null`
      break
    case 'restore':
      body = `[WinMgmt]::ShowWindow($hwndPtr, ${SW_RESTORE}) | Out-Null`
      break
    case 'close':
      body = `[WinMgmt]::SendMessage($hwndPtr, ${WM_CLOSE}, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`
      break
    case 'focus':
      body = `
[WinMgmt]::ShowWindow($hwndPtr, ${SW_RESTORE}) | Out-Null
[WinMgmt]::BringWindowToTop($hwndPtr) | Out-Null
[WinMgmt]::SetForegroundWindow($hwndPtr) | Out-Null
`
      break
    case 'move_offscreen':
      body = `
# SWP_NOSIZE | SWP_NOZORDER
[WinMgmt]::SetWindowPos($hwndPtr, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x0001 -bor 0x0004) | Out-Null
`
      break
    case 'move_resize': {
      const x = opts.x ?? 0
      const y = opts.y ?? 0
      const w = opts.width ?? 0
      const h = opts.height ?? 0
      if (w > 0 && h > 0) {
        // SWP_NOZORDER only — apply position + size.
        body = `[WinMgmt]::SetWindowPos($hwndPtr, [IntPtr]::Zero, ${x}, ${y}, ${w}, ${h}, 0x0004) | Out-Null`
      } else {
        // SWP_NOSIZE | SWP_NOZORDER — position only.
        body = `[WinMgmt]::SetWindowPos($hwndPtr, [IntPtr]::Zero, ${x}, ${y}, 0, 0, 0x0001 -bor 0x0004) | Out-Null`
      }
      break
    }
    default:
      return false
  }

  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinMgmt {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
$hwndPtr = [IntPtr]::new(${hwnd})
${body}
"ok"
`
  try {
    await psAsync(script)
    return true
  } catch {
    return false
  }
}

/**
 * Get the current window rect of the bound window, or null if unbound.
 */
export async function getWindowRect(): Promise<{
  x: number
  y: number
  width: number
  height: number
} | null> {
  const bound = getBoundWindow()
  if (!bound) return null
  const hwnd = validateHwnd(bound.hwnd)

  try {
    const out = await psAsync(`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinRect2 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
'@
$r = New-Object WinRect2+RECT
[WinRect2]::GetWindowRect([IntPtr]::new(${hwnd}), [ref]$r) | Out-Null
"$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
`)
    const parts = out.trim().split(',').map(Number)
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return null
    const [left, top, right, bottom] = parts as [number, number, number, number]
    return { x: left, y: top, width: right - left, height: bottom - top }
  } catch {
    return null
  }
}
