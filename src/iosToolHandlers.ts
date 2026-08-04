/**
 * Dispatch handlers for `ios_*` tools.
 *
 * Separate from `toolCalls.ts` to keep the iOS surface self-contained and to
 * avoid growing an already-large file. iOS tools do NOT consult the session
 * app allowlist — the simulator is a sandboxed guest OS, not a macOS app, so
 * the frontmost-app gate that guards macOS desktop actions is irrelevant.
 * The TCC accessibility/screen-recording checks DO still apply (Simulator.app
 * itself runs as the host user and we may want to drive its UI).
 *
 * All handlers throw `Error` with a user-friendly message on failure —
 * `dispatchAction` in `toolCalls.ts` catches and converts to a tool error.
 */

import {
  bootSimulator,
  captureIOSScreenshot,
  clearLocation,
  getBootedSimulator,
  getUIHierarchy,
  installApp,
  isIOSSimulatorAvailable,
  launchApp,
  listSimulators,
  longPress,
  pressButton,
  setLocation,
  shutdownSimulator,
  swipe,
  tap,
  terminateApp,
  typeText,
} from './backends/ios/index.js'
import type { IOSHardwareButton } from './backends/ios/index.js'

// ── Result envelope ────────────────────────────────────────────────────
// Kept structurally identical to `CuCallToolResult` in toolCalls.ts. We
// redeclare here (rather than import) so this module has zero dependency on
// the dispatcher that invokes it — the dispatcher just awaits and forwards.

export interface IOSScreenshotPayload {
  base64: string
  width: number
  height: number
  format: 'jpeg' | 'png'
}

export interface IOSHandlerResult {
  content: Array<{ type: 'text'; text: string } | {
    type: 'image'
    data: string
    mimeType: string
  }>
  isError?: boolean
}

function okText(text: string): IOSHandlerResult {
  return { content: [{ type: 'text', text }] }
}

function okJson(obj: unknown): IOSHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

function okImage(payload: IOSScreenshotPayload): IOSHandlerResult {
  return {
    content: [
      {
        type: 'image',
        data: payload.base64,
        mimeType: payload.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      },
      {
        type: 'text',
        text: JSON.stringify({
          width: payload.width,
          height: payload.height,
          format: payload.format,
        }),
      },
    ],
  }
}

// ── Arg validation (lightweight mirror of toolCalls.ts style) ──────────

type Args = Record<string, unknown>

function requireNumber(args: Args, key: string): number {
  const v = args[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`"${key}" must be a finite number.`)
  }
  return v
}

function requireString(args: Args, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`)
  }
  return v
}

function optionalString(args: Args, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Resolve the target simulator UDID. If `args.udid` is provided, use it.
 * Otherwise fall back to the currently booted simulator (error if none).
 */
function resolveUdid(args: Args): string {
  const explicit = optionalString(args, 'udid')
  if (explicit) return explicit
  const booted = getBootedSimulator()
  if (!booted) {
    throw new Error(
      'No simulator UDID provided and no simulator is currently booted. ' +
        'Call ios_list_simulators then ios_boot_simulator <udid>.',
    )
  }
  return booted.udid
}

// ── Handlers ───────────────────────────────────────────────────────────

async function handleListSimulators(): Promise<IOSHandlerResult> {
  const sims = listSimulators()
  return okJson({
    count: sims.length,
    simulators: sims,
  })
}

async function handleBootSimulator(args: Args): Promise<IOSHandlerResult> {
  const udid = optionalString(args, 'udid')
  const booted = await bootSimulator(udid)
  return okJson({ ok: true, simulator: booted })
}

async function handleShutdownSimulator(args: Args): Promise<IOSHandlerResult> {
  const udid = requireString(args, 'udid')
  await shutdownSimulator(udid)
  return okText(`Simulator ${udid} shut down.`)
}

async function handleGetDeviceInfo(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const all = listSimulators()
  const found = all.find(s => s.udid === udid)
  if (!found) {
    throw new Error(`Simulator ${udid} not found. Call ios_list_simulators.`)
  }
  // Append idb availability for the model to plan its interactions.
  return okJson({
    simulator: found,
    idbAvailable: (await import('./backends/ios/index.js')).isIdbAvailable(),
  })
}

async function handleScreenshot(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const result = await captureIOSScreenshot(udid)
  return okImage(result)
}

async function handleGetUIHierarchy(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const tree = await getUIHierarchy(udid)
  return okJson({ count: tree.length, elements: tree })
}

async function handleTap(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const x = requireNumber(args, 'x')
  const y = requireNumber(args, 'y')
  await tap(udid, x, y)
  return okText(`Tapped (${Math.round(x)}, ${Math.round(y)}).`)
}

async function handleLongPress(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const x = requireNumber(args, 'x')
  const y = requireNumber(args, 'y')
  const durationMs =
    typeof args.duration_ms === 'number' ? args.duration_ms : 1000
  await longPress(udid, x, y, durationMs)
  return okText(
    `Long-pressed (${Math.round(x)}, ${Math.round(y)}) for ${durationMs}ms.`,
  )
}

async function handleSwipe(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const x1 = requireNumber(args, 'x1')
  const y1 = requireNumber(args, 'y1')
  const x2 = requireNumber(args, 'x2')
  const y2 = requireNumber(args, 'y2')
  const durationMs =
    typeof args.duration_ms === 'number' ? args.duration_ms : 250
  await swipe(udid, x1, y1, x2, y2, durationMs)
  return okText(
    `Swiped (${Math.round(x1)}, ${Math.round(y1)}) → (${Math.round(x2)}, ${Math.round(y2)}).`,
  )
}

async function handleTypeText(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const text = requireString(args, 'text')
  await typeText(udid, text)
  return okText(`Typed ${text.length} characters.`)
}

const BUTTONS: ReadonlySet<string> = new Set([
  'home',
  'lock',
  'siri',
  'volume-up',
  'volume-down',
])

async function handlePressButton(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const button = requireString(args, 'button')
  if (!BUTTONS.has(button)) {
    throw new Error(
      `button must be one of: ${[...BUTTONS].join(', ')}. Got "${button}".`,
    )
  }
  await pressButton(udid, button as IOSHardwareButton)
  return okText(`Pressed ${button}.`)
}

async function handleLaunchApp(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const bundleId = requireString(args, 'bundle_id')
  const { pid } = await launchApp(udid, bundleId)
  return okJson({ ok: true, bundleId, pid })
}

async function handleTerminateApp(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const bundleId = requireString(args, 'bundle_id')
  await terminateApp(udid, bundleId)
  return okText(`Terminated ${bundleId}.`)
}

async function handleInstallApp(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const appPath = requireString(args, 'app_path')
  await installApp(udid, appPath)
  return okText(`Installed ${appPath} on ${udid}.`)
}

async function handleSetLocation(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  const lat = requireNumber(args, 'latitude')
  const lng = requireNumber(args, 'longitude')
  await setLocation(udid, lat, lng)
  return okText(`Location set to ${lat},${lng}.`)
}

async function handleClearLocation(args: Args): Promise<IOSHandlerResult> {
  const udid = resolveUdid(args)
  await clearLocation(udid)
  return okText('Location cleared.')
}

// ── Public dispatch ────────────────────────────────────────────────────

/**
 * Returns true if `name` is an `ios_*` tool handled by this module. The
 * caller (`toolCalls.ts`) checks this BEFORE its own dispatch — iOS tools
 * bypass the macOS desktop gates entirely.
 */
export function isIOSTool(name: string): boolean {
  return name.startsWith('ios_')
}

/**
 * Dispatch an iOS tool call. Throws if iOS Simulator is unavailable on this
 * host; the dispatcher converts that to a tool error.
 */
export async function dispatchIOSTool(
  name: string,
  args: unknown,
): Promise<IOSHandlerResult> {
  if (!isIOSSimulatorAvailable()) {
    throw new Error(
      'iOS Simulator not available on this machine. Requires: macOS, Xcode Command Line Tools, and at least one registered simulator.',
    )
  }
  const a = (typeof args === 'object' && args !== null ? args : {}) as Args

  switch (name) {
    case 'ios_list_simulators':
      return handleListSimulators()
    case 'ios_boot_simulator':
      return handleBootSimulator(a)
    case 'ios_shutdown_simulator':
      return handleShutdownSimulator(a)
    case 'ios_get_device_info':
      return handleGetDeviceInfo(a)
    case 'ios_screenshot':
      return handleScreenshot(a)
    case 'ios_get_ui_hierarchy':
      return handleGetUIHierarchy(a)
    case 'ios_tap':
      return handleTap(a)
    case 'ios_long_press':
      return handleLongPress(a)
    case 'ios_swipe':
      return handleSwipe(a)
    case 'ios_type_text':
      return handleTypeText(a)
    case 'ios_press_button':
      return handlePressButton(a)
    case 'ios_launch_app':
      return handleLaunchApp(a)
    case 'ios_terminate_app':
      return handleTerminateApp(a)
    case 'ios_install_app':
      return handleInstallApp(a)
    case 'ios_set_location':
      return handleSetLocation(a)
    case 'ios_clear_location':
      return handleClearLocation(a)
    default:
      throw new Error(`Unknown iOS tool: ${name}`)
  }
}
