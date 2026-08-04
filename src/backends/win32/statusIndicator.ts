/**
 * Status-indicator overlay for the bound window.
 *
 * The upstream implementation in Claude Code 2.1.220 shows a small floating
 * label via a Python bridge. For the standalone package we keep a minimal
 * in-process model: the indicator state (visible + message) is tracked in
 * memory and surfaced via `status_indicator(action='status')`. We do NOT
 * create a real WinForms window from the MCP server — that would require a
 * persistent PowerShell host process and is not portable.
 *
 * Auto-show-on-action is left to the host adapter; this module just stores
 * the latest show/hide state and message.
 */

export interface StatusIndicatorState {
  active: boolean
  message?: string
}

let state: StatusIndicatorState = { active: false }

export function statusIndicator(
  action: 'show' | 'hide' | 'status',
  message?: string,
): StatusIndicatorState {
  if (action === 'show') {
    state = { active: true, message }
    return { ...state }
  }
  if (action === 'hide') {
    state = { active: false }
    return { ...state }
  }
  return { ...state }
}
