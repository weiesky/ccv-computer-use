/**
 * iOS Simulator touch/keyboard interactions.
 *
 * Two paths:
 *
 *   1. **idb (preferred)** — Facebook's `idb_companion` + `idb` Python client.
 *      Provides direct event injection into the simulator without depending on
 *      Simulator.app window position or macOS accessibility. Required for
 *      `getUIHierarchy` (no simctl equivalent).
 *
 *   2. **simctl + AppleScript fallback** — `xcrun simctl` covers most non-touch
 *      operations (biometric, location, app lifecycle). For tap/swipe/type we
 *      do NOT have a pure-simctl fallback today; if idb is missing, those
 *      tools surface a clear "install idb" error.
 *
 * Why no AppleScript tap fallback: clicking the Simulator.app window requires
 * mapping logical device coords → window coords (status bar, bezel, scaling,
 * resizing). It's brittle across macOS/Xcode versions and confuses the model
 * with coordinate drift. We'd rather return a hard error that points at idb.
 */

import { runAsync, runSync } from '../_shared/spawn.js'
import { isIdbAvailable } from './simulator.js'

export interface UIElement {
  /** Element type, e.g. "Button", "TextField", "StaticText". */
  type: string
  /** Accessibility identifier (developer-set). */
  identifier?: string
  /** Visible label / text. */
  label?: string
  /** Frame in device logical points. */
  frame: { x: number; y: number; width: number; height: number }
  /** Whether the element reports as enabled. */
  enabled?: boolean
  /** Whether the element is currently visible. */
  visible?: boolean
  /** Child elements (tree structure). */
  children?: UIElement[]
}

const IDB_INSTALL_HINT =
  'idb not available. Install: brew install idb-companion && pipx install fb-idb. ' +
  'Then start a companion: idb_companion --udid <simulator-udid>'

function requireIdb(): void {
  if (!isIdbAvailable()) {
    throw new Error(IDB_INSTALL_HINT)
  }
}

/**
 * Tap at logical device coordinates. idb exposes `--udid` for explicit
 * targeting; without it, idb uses the only booted simulator (errors if
 * multiple). We always pass `--udid` for determinism.
 */
export async function tap(udid: string, x: number, y: number): Promise<void> {
  requireIdb()
  await runAsync([
    'idb',
    'ui',
    'tap',
    '--udid',
    udid,
    String(Math.round(x)),
    String(Math.round(y)),
  ])
}

/**
 * Long-press at logical device coordinates.
 * `durationMs` is converted to seconds for idb.
 */
export async function longPress(
  udid: string,
  x: number,
  y: number,
  durationMs: number,
): Promise<void> {
  requireIdb()
  await runAsync([
    'idb',
    'ui',
    'tap',
    '--udid',
    udid,
    '--duration',
    (durationMs / 1000).toFixed(2),
    String(Math.round(x)),
    String(Math.round(y)),
  ])
}

/**
 * Swipe from (x1, y1) to (x2, y2) over `durationMs` milliseconds.
 * idb's `ui swipe` takes start/end + delta/duration.
 */
export async function swipe(
  udid: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
): Promise<void> {
  requireIdb()
  const args = [
    'idb',
    'ui',
    'swipe',
    '--udid',
    udid,
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
  ]
  if (durationMs > 0) {
    args.push('--duration', (durationMs / 1000).toFixed(2))
  }
  await runAsync(args)
}

/**
 * Type text into the focused field on the simulator. Calls idb's text input
 * (which uses the simulator's HID keyboard channel). Special characters are
 * passed through verbatim — idb handles encoding.
 */
export async function typeText(udid: string, text: string): Promise<void> {
  requireIdb()
  await runAsync(['idb', 'ui', 'text', '--udid', udid, text])
}

/**
 * Press a hardware button. idb exposes `ui button` with a small fixed set.
 *
 * `home` / `lock` / `siri` map 1:1. Volume buttons use idb's `HID` event
 * stream — idb 1.x exposes them via `idb ui button` too on newer releases;
 * older releases require `idb hid` (raw event). We use `ui button` and let
 * idb reject if it doesn't know the name.
 */
export type IOSHardwareButton =
  | 'home'
  | 'lock'
  | 'siri'
  | 'volume-up'
  | 'volume-down'

const BUTTON_IDB_NAME: Record<IOSHardwareButton, string> = {
  home: 'HOME',
  lock: 'LOCK',
  siri: 'SIRI',
  'volume-up': 'VOLUME_UP',
  'volume-down': 'VOLUME_DOWN',
}

export async function pressButton(
  udid: string,
  button: IOSHardwareButton,
): Promise<void> {
  requireIdb()
  const idbName = BUTTON_IDB_NAME[button]
  if (!idbName) throw new Error(`Unknown button: ${button}`)
  await runAsync(['idb', 'ui', 'button', '--udid', udid, idbName])
}

/**
 * Fetch the UI element tree. idb returns one JSON object per line; each
 * describes an AX element with frame, label, type, children, etc.
 *
 * Returns the parsed tree (typically a single root with children). Returns
 * an empty array if the device is unreachable or idb fails — callers should
 * prefer a hard error here, so we throw on idb failure rather than swallow.
 */
export async function getUIHierarchy(udid: string): Promise<UIElement[]> {
  requireIdb()
  const raw = await runAsync([
    'idb',
    'ui',
    'describe-all',
    '--udid',
    udid,
    '--json',
  ])
  // idb prints one JSON doc per line. Each line is a top-level AX element.
  const out: UIElement[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const el = normalizeElement(parsed)
      if (el) out.push(el)
    } catch {
      // Skip malformed lines (idb may interleave log noise on stderr/stdout).
    }
  }
  return out
}

function normalizeElement(
  raw: Record<string, unknown>,
): UIElement | null {
  // idb uses `AXFrame` / `frame` interchangeably across versions. Take either.
  const frameRaw = (raw.AXFrame ?? raw.frame) as
    | { x?: number; y?: number; width?: number; height?: number }
    | undefined
  const frame = {
    x: Number(frameRaw?.x ?? 0),
    y: Number(frameRaw?.y ?? 0),
    width: Number(frameRaw?.width ?? 0),
    height: Number(frameRaw?.height ?? 0),
  }
  const type = String(raw.type ?? raw.AXType ?? 'Unknown')
  const childrenRaw = (raw.children ?? []) as Array<Record<string, unknown>>
  const children: UIElement[] = []
  for (const c of childrenRaw) {
    const el = normalizeElement(c)
    if (el) children.push(el)
  }
  return {
    type,
    identifier:
      typeof raw.identifier === 'string'
        ? raw.identifier
        : typeof raw.AXIdentifier === 'string'
          ? raw.AXIdentifier
          : undefined,
    label:
      typeof raw.label === 'string'
        ? raw.label
        : typeof raw.AXLabel === 'string'
          ? raw.AXLabel
          : undefined,
    frame,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
    visible: typeof raw.visible === 'boolean' ? raw.visible : undefined,
    children: children.length > 0 ? children : undefined,
  }
}

/**
 * Open a URL on the simulator (e.g. deep link, https://). Pure simctl —
 * no idb needed.
 */
export async function openUrl(udid: string, url: string): Promise<void> {
  runSync(['xcrun', 'simctl', 'openurl', udid, url])
}
