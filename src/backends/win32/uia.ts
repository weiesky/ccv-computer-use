/**
 * UI Automation (UIA) element access for Windows.
 *
 * Uses PowerShell + `Add-Type -AssemblyName UIAutomationClient` to find and
 * interact with elements by accessible name / role / automationId, scoped to
 * the currently bound window when one is set (falls back to root desktop).
 *
 * No Python bridge — pure .NET Framework UIA via PowerShell.
 */

import { psAsync } from '../_shared/spawn.js'
import { getBoundWindow } from './windowBinding.js'
import { validateHwnd } from './shared.js'

export interface ElementQuery {
  name?: string
  role?: string
  automationId?: string
}

/** Map our friendly role names to UIA ControlType IDs (numeric). */
const ROLE_TO_CONTROL_TYPE_ID: Record<string, number> = {
  button: 50000,
  calendar: 50001,
  checkbox: 50002,
  combobox: 50003,
  edit: 50004,
  hyperlink: 50005,
  link: 50005,
  image: 50006,
  listitem: 50007,
  list: 50008,
  menu: 50009,
  menubar: 50010,
  menuitem: 50011,
  progressbar: 50012,
  radiobutton: 50013,
  scrollbar: 50014,
  slider: 50015,
  spinner: 50016,
  statusbar: 50017,
  tab: 50018,
  tabitem: 50019,
  text: 50020,
  toolbar: 50021,
  tooltip: 50022,
  tree: 50023,
  treeitem: 50024,
  custom: 50025,
  group: 50026,
  thumb: 50027,
  datagrid: 50028,
  dataitem: 50029,
  document: 50030,
  splitbutton: 50031,
  window: 50032,
  pane: 50033,
  header: 50034,
  headeritem: 50035,
  table: 50036,
  titlebar: 50037,
  separator: 50038,
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''").replace(/`/g, '``')
}

function buildConditions(query: ElementQuery): string[] {
  const conds: string[] = []
  if (query.name) {
    // Substring match for name — we use a custom filter via Where-Object on the result set.
    // UIA PropertyCondition is exact-match; we accept that and also do post-filter below.
    conds.push(`$namePattern = '${psQuote(query.name)}'`)
  }
  if (query.automationId) {
    conds.push(
      `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${psQuote(query.automationId)}')`,
    )
  }
  if (query.role) {
    const id = ROLE_TO_CONTROL_TYPE_ID[query.role.toLowerCase()]
    if (id !== undefined) {
      conds.push(
        `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::LookUpById(${id}))`,
      )
    }
  }
  return conds
}

function buildFindScript(query: ElementQuery, extraAction: string): string {
  const bound = getBoundWindow()
  const rootExpr = bound
    ? `
$hwndPtr = [IntPtr]::new(${validateHwnd(bound.hwnd)})
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwndPtr)
if ($root -eq $null) { "error:no_window"; exit }
`
    : `$root = [System.Windows.Automation.AutomationElement]::RootElement`

  // Build condition tree. Strategy: AND together all specified conditions,
  // use TrueCondition when nothing else is given (then post-filter by name).
  const conds: string[] = []
  if (query.automationId) {
    conds.push(
      `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${psQuote(query.automationId)}')`,
    )
  }
  if (query.role) {
    const id = ROLE_TO_CONTROL_TYPE_ID[query.role.toLowerCase()]
    if (id !== undefined) {
      conds.push(
        `New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::LookUpById(${id}))`,
      )
    }
  }

  // For name: UIA exact match is too strict for substring semantics.
  // Use FindAll with role/automationId conditions, then Where-Object by name.
  // When only name is given, we search broadly with TrueCondition.
  let findClause: string
  if (query.name && !query.automationId && !query.role) {
    findClause = `
$condition = [System.Windows.Automation.Condition]::TrueCondition
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$nameLower = '${psQuote(query.name)}'.ToLower()
$element = $null
foreach ($el in $elements) {
  try { if ($el.Current.Name -and $el.Current.Name.ToLower().Contains($nameLower)) { $element = $el; break } } catch {}
}
`
  } else if (query.name) {
    const condExpr =
      conds.length === 0
        ? '[System.Windows.Automation.Condition]::TrueCondition'
        : conds.length === 1
          ? conds[0]
          : `New-Object System.Windows.Automation.AndCondition(${conds.join(', ')})`
    findClause = `
$condition = ${condExpr}
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$nameLower = '${psQuote(query.name)}'.ToLower()
$element = $null
foreach ($el in $elements) {
  try { if ($el.Current.Name -and $el.Current.Name.ToLower().Contains($nameLower)) { $element = $el; break } } catch {}
}
`
  } else {
    const condExpr =
      conds.length === 0
        ? '[System.Windows.Automation.Condition]::TrueCondition'
        : conds.length === 1
          ? conds[0]
          : `New-Object System.Windows.Automation.AndCondition(${conds.join(', ')})`
    findClause = `
$condition = ${condExpr}
$element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
`
  }

  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
${rootExpr}
${findClause}
if ($element -eq $null) { "error:not_found"; exit }
${extraAction}
`
}

/**
 * Click a UIA element by name/role/automationId.
 * Tries InvokePattern first; falls back to BoundingRectangle center click.
 * Returns true on success, false on failure.
 */
export async function clickElement(query: ElementQuery): Promise<boolean> {
  if (!query.name && !query.role && !query.automationId) return false

  const action = `
$clicked = $false
try {
  $invokePattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  if ($invokePattern -ne $null) {
    $invokePattern.Invoke()
    $clicked = $true
  }
} catch {}
if (-not $clicked) {
  try {
    $togglePattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($togglePattern -ne $null) {
      $togglePattern.Toggle()
      $clicked = $true
    }
  } catch {}
}
if (-not $clicked) {
  try {
    $selItemPattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($selItemPattern -ne $null) {
      $selItemPattern.Select()
      $clicked = $true
    }
  } catch {}
}
if (-not $clicked) {
  # Fallback: bounding-rect center click via SetCursorPos + mouse_event
  try {
    $rect = $element.Current.BoundingRectangle
    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UiaClicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
      $cx = [int]($rect.X + $rect.Width / 2)
      $cy = [int]($rect.Y + $rect.Height / 2)
      [UiaClicker]::SetCursorPos($cx, $cy) | Out-Null
      Start-Sleep -Milliseconds 30
      [UiaClicker]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 30
      [UiaClicker]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      $clicked = $true
    }
  } catch {}
}
if ($clicked) { "ok" } else { "error:no_pattern" }
`

  try {
    const script = buildFindScript(query, action)
    const out = await psAsync(script)
    return out.trim() === 'ok'
  } catch {
    return false
  }
}

/**
 * Type text into a UIA element using ValuePattern.SetValue.
 * Falls back to SetFocus + SendKeys-style via SendMessage when ValuePattern
 * is not supported. Returns true on success.
 */
export async function typeIntoElement(
  query: ElementQuery,
  text: string,
): Promise<boolean> {
  if (!text) return false

  const action = `
$done = $false
try {
  $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($valuePattern -ne $null) {
    $valuePattern.SetValue('${psQuote(text)}')
    $done = $true
  }
} catch {}
if (-not $done) {
  # Fallback: focus the element, then send text via SendInput-style PostMessage WM_CHAR
  try {
    $element.SetFocus()
    Start-Sleep -Milliseconds 50
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UiaTyper {
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
    $focusHwnd = [UiaTyper]::GetFocus()
    if ($focusHwnd -ne [IntPtr]::Zero) {
      foreach ($ch in '${psQuote(text)}'.ToCharArray()) {
        [UiaTyper]::PostMessage($focusHwnd, 0x0102, [IntPtr][int][char]$ch, [IntPtr]::Zero) | Out-Null
      }
      $done = $true
    }
  } catch {}
}
if ($done) { "ok" } else { "error:no_pattern" }
`

  try {
    const script = buildFindScript(query, action)
    const out = await psAsync(script)
    return out.trim() === 'ok'
  } catch {
    return false
  }
}

export const __internal = { buildConditions, ROLE_TO_CONTROL_TYPE_ID }
