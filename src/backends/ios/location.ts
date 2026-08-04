/**
 * iOS Simulator location spoofing via `xcrun simctl location`.
 *
 * Pure simctl — no idb needed. Locations persist until cleared.
 */

import { runSync } from '../_shared/spawn.js'

export async function setLocation(
  udid: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error(`latitude must be in [-90, 90], got ${latitude}`)
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`longitude must be in [-180, 180], got ${longitude}`)
  }
  runSync(['xcrun', 'simctl', 'location', udid, 'set', `${latitude},${longitude}`])
}

export async function clearLocation(udid: string): Promise<void> {
  runSync(['xcrun', 'simctl', 'location', udid, 'clear'])
}
