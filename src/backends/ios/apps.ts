/**
 * iOS Simulator app lifecycle via `xcrun simctl`.
 *
 * All operations are pure simctl — no idb dependency. Errors from simctl
 * (unknown bundle id, app not installed) propagate as thrown errors with
 * simctl's stderr attached.
 */

import { runSync } from '../_shared/spawn.js'

/** Launch an app by bundle id. Returns the PID printed by simctl. */
export async function launchApp(
  udid: string,
  bundleId: string,
): Promise<{ pid: number | null }> {
  const out = runSync(['xcrun', 'simctl', 'launch', udid, bundleId])
  // Output format: "com.example.app: 12345"
  const m = /:\s*(\d+)\s*$/.exec(out)
  return { pid: m ? Number(m[1]) : null }
}

/** Terminate a running app by bundle id. Errors if the app isn't running. */
export async function terminateApp(
  udid: string,
  bundleId: string,
): Promise<void> {
  runSync(['xcrun', 'simctl', 'terminate', udid, bundleId])
}

/** Install a `.app` bundle (path on host filesystem). */
export async function installApp(udid: string, appPath: string): Promise<void> {
  runSync(['xcrun', 'simctl', 'install', udid, appPath])
}

/** Uninstall an app by bundle id. */
export async function uninstallApp(
  udid: string,
  bundleId: string,
): Promise<void> {
  runSync(['xcrun', 'simctl', 'uninstall', udid, bundleId])
}

/**
 * List apps installed on the simulator.
 *
 * Returns a map of bundleId → display name. This uses `simctl listapps`,
 * which emits plist — we shell out to `plutil` to convert to JSON. Available
 * on macOS by default.
 */
export async function listApps(
  udid: string,
): Promise<Array<{ bundleId: string; displayName: string }>> {
  // Pipe: simctl listapps → plutil -convert json -o - -
  const plist = runSync(['xcrun', 'simctl', 'listapps', udid])
  // listapps output is plain text (NSKeyedArchive binary plist dump). The
  // `plutil -convert json` path requires a real plist file. Simpler: parse
  // the text output, which lists "<bundleId> = <CFBundleDisplayName>" pairs.
  const out: Array<{ bundleId: string; displayName: string }> = []
  for (const line of plist.split('\n')) {
    const m = /^\s*"([^"]+)"\s*=\s*(.+?)\s*;?\s*$/.exec(line)
    if (!m) continue
    const bundleId = m[1]!
    // Strip wrapping quotes/braces from the value side.
    let name = m[2]!.replace(/^[{"]|[}"]$/g, '').trim()
    // If the value side is itself a dict ("{ CFBundleName = Foo; }"), pull
    // CFBundleDisplayName / CFBundleName out of it.
    const inner = /CFBundle(?:Display)?Name\s*=\s*"?([^";]+)"?/.exec(name)
    if (inner) name = inner[1]!
    out.push({ bundleId, displayName: name || bundleId })
  }
  return out
}
