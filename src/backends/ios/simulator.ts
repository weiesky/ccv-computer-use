/**
 * iOS Simulator detection and basic management via `xcrun simctl`.
 *
 * macOS-only. Availability requires:
 *   1. `process.platform === 'darwin'`
 *   2. `xcrun` present (Xcode Command Line Tools installed)
 *   3. At least one iOS Simulator device registered (any state, any runtime)
 *
 * All simctl invocations route through `_shared/spawn.ts`. We parse JSON
 * output (`simctl list -j`) — never the human-readable table, which is
 * unstable across Xcode versions.
 */

import { platform } from 'node:os'

import { commandExists, runSync } from '../_shared/spawn.js'

export type IOSSimulatorState =
  | 'Booted'
  | 'Booting'
  | 'Shutting Down'
  | 'Shutdown'

export interface IOSSimulator {
  udid: string
  name: string
  state: IOSSimulatorState
  /** Device type identifier, e.g. "iPhone 15 Pro" or "iPad Pro (12.9-inch) (6th generation)" */
  deviceType: string
  /** Runtime identifier, e.g. "iOS 17.5" or "com.apple.CoreSimulator.SimRuntime.iOS-17-5" */
  runtime: string
  /** True if `simctl list devices available` reports the device as usable. */
  isAvailable: boolean
}

interface SimctlDeviceEntry {
  udid?: string
  name?: string
  state?: string
  isAvailable?: boolean
  deviceTypeIdentifier?: string
  availabilityError?: string
}

interface SimctlListDevicesOutput {
  devices?: Record<string, SimctlDeviceEntry[]>
}

interface SimctlDeviceTypeEntry {
  identifier?: string
  name?: string
}

interface SimctlListDeviceTypesOutput {
  devicetypes?: SimctlDeviceTypeEntry[]
}

interface SimctlRuntimeEntry {
  identifier?: string
  name?: string
  version?: string
  isAvailable?: boolean
}

interface SimctlListRuntimesOutput {
  runtimes?: SimctlRuntimeEntry[]
}

// Cached lookup tables. Rebuilt lazily per call; simctl is fast enough
// (<50ms) that we don't need module-level caching across invocations.
function listDeviceTypes(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const raw = runSync(['xcrun', 'simctl', 'list', 'devicetypes', '-j'])
    const parsed = JSON.parse(raw) as SimctlListDeviceTypesOutput
    for (const t of parsed.devicetypes ?? []) {
      if (t.identifier && t.name) map.set(t.identifier, t.name)
    }
  } catch {
    // Fall through — return whatever we got (possibly empty). Callers
    // tolerate missing device-type names by falling back to the identifier.
  }
  return map
}

function listRuntimes(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const raw = runSync(['xcrun', 'simctl', 'list', 'runtimes', '-j'])
    const parsed = JSON.parse(raw) as SimctlListRuntimesOutput
    for (const r of parsed.runtimes ?? []) {
      if (!r.identifier) continue
      const label = r.version
        ? `iOS ${r.version.replace(/^([0-9.]+).*$/, '$1')}`
        : (r.name ?? r.identifier)
      map.set(r.identifier, label)
    }
  } catch {
    // Tolerate missing runtimes — fallback to raw identifier below.
  }
  return map
}

/** Convert a runtime key from `list devices -j` (e.g. "com.apple.CoreSimulator.SimRuntime.iOS-17-5")
 *  to a friendlier "iOS 17.5" label using the runtime lookup table. */
function runtimeLabel(
  runtimeKey: string,
  runtimeMap: Map<string, string>,
): string {
  const hit = runtimeMap.get(runtimeKey)
  if (hit) return hit
  // Fallback: parse the dotted suffix from the identifier.
  const m = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/.exec(
    runtimeKey,
  )
  if (m) {
    return `iOS ${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`
  }
  return runtimeKey
}

/**
 * Enumerate all registered simulators across all runtimes.
 * Throws if simctl fails — callers that want tolerance should call
 * `isIOSSimulatorAvailable()` first.
 */
export function listSimulators(): IOSSimulator[] {
  const raw = runSync(['xcrun', 'simctl', 'list', 'devices', '-j'])
  const parsed = JSON.parse(raw) as SimctlListDevicesOutput
  const typeMap = listDeviceTypes()
  const rtMap = listRuntimes()

  const out: IOSSimulator[] = []
  for (const [runtimeKey, devices] of Object.entries(parsed.devices ?? {})) {
    const rtLabel = runtimeLabel(runtimeKey, rtMap)
    for (const d of devices) {
      if (!d.udid || !d.name) continue
      out.push({
        udid: d.udid,
        name: d.name,
        state: (d.state as IOSSimulatorState) ?? 'Shutdown',
        deviceType: d.deviceTypeIdentifier
          ? (typeMap.get(d.deviceTypeIdentifier) ?? d.deviceTypeIdentifier)
          : 'Unknown',
        runtime: rtLabel,
        isAvailable: d.isAvailable === true,
      })
    }
  }
  return out
}

/** Find the first Booted simulator. Most automation targets the booted device. */
export function getBootedSimulator(): IOSSimulator | null {
  try {
    const all = listSimulators()
    return all.find(s => s.state === 'Booted' && s.isAvailable) ?? null
  } catch {
    return null
  }
}

/**
 * Boot a simulator. If `udid` is omitted, pick the first available iPhone.
 * Returns the booted simulator's record (refreshed after boot).
 */
export async function bootSimulator(udid?: string): Promise<IOSSimulator> {
  let targetUdid = udid
  if (!targetUdid) {
    const all = listSimulators()
    const iphone = all.find(
      s => s.isAvailable && s.deviceType.includes('iPhone'),
    )
    const fallback = all.find(s => s.isAvailable)
    const chosen = iphone ?? fallback
    if (!chosen) {
      throw new Error('No available iOS Simulator found. Create one in Xcode → Devices & Simulators.')
    }
    targetUdid = chosen.udid
  }

  // `simctl boot` is idempotent — calling it on an already-booted device
  // succeeds silently. Boot then open Simulator.app so the user sees it.
  try {
    runSync(['xcrun', 'simctl', 'boot', targetUdid])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // "Unable to boot device in current state: Booted" is fine; anything else is real.
    if (!/Booted/.test(msg)) throw err
  }

  // Open Simulator.app so the user can see the booted device. `open -a` is
  // idempotent (focuses if already running) and asynchronous.
  try {
    runSync(['open', '-a', 'Simulator'])
  } catch {
    // Non-fatal — simulator still boots, just no UI.
  }

  // Poll state until Booted or timeout (~10s).
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const all = listSimulators()
    const found = all.find(s => s.udid === targetUdid)
    if (found && found.state === 'Booted') return found
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Simulator ${targetUdid} did not reach Booted state within 10s.`)
}

export async function shutdownSimulator(udid: string): Promise<void> {
  runSync(['xcrun', 'simctl', 'shutdown', udid])
}

/**
 * Detect iOS Simulator support on this machine.
 *
 * Returns true only when:
 *   1. Host is macOS.
 *   2. `xcrun` is on PATH (Xcode CLT installed).
 *   3. `simctl list devices` succeeds AND reports at least one available device.
 *
 * This is checked once per server boot — see `buildComputerUseTools`. We do
 * NOT cache the result here; the caller owns the lifecycle.
 */
export function isIOSSimulatorAvailable(): boolean {
  if (platform() !== 'darwin') return false
  if (!commandExists('xcrun')) return false
  try {
    const sims = listSimulators()
    return sims.some(s => s.isAvailable)
  } catch {
    return false
  }
}

/** Detect Facebook's idb companion (optional dependency for richer interactions). */
export function isIdbAvailable(): boolean {
  return commandExists('idb')
}
