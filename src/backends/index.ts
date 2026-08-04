/**
 * Platform backend factory.
 *
 * Combines input + swift backends for the current platform into a single
 * PlatformBackend. Used by host/adapter.ts to construct the ComputerExecutor.
 */

import { platform } from 'node:os'

import type { InputBackend, PlatformBackend, SwiftBackend } from './types.js'

import * as darwinInput from './darwin/input.js'
import * as darwinSwift from './darwin/swift.js'
import * as linuxInput from './linux/input.js'
import * as linuxSwift from './linux/swift.js'
import * as win32Input from './win32/input.js'
import * as win32Swift from './win32/swift.js'

export type { InputBackend, PlatformBackend, SwiftBackend } from './types.js'

let cached: PlatformBackend | null = null

/**
 * Detect the current platform and return the matching backends.
 * Returns null when running on an unsupported platform.
 */
export function createPlatformBackend(): PlatformBackend | null {
  if (cached) return cached

  const p = platform()

  if (p === 'darwin') {
    cached = {
      input: darwinInput as unknown as InputBackend,
      swift: {
        display: darwinSwift.display,
        apps: darwinSwift.apps,
        screenshot: darwinSwift.screenshot,
      },
    }
    return cached
  }

  if (p === 'win32') {
    cached = {
      input: win32Input as unknown as InputBackend,
      swift: {
        display: win32Swift.display,
        apps: win32Swift.apps,
        screenshot: win32Swift.screenshot,
      },
    }
    return cached
  }

  if (p === 'linux') {
    cached = {
      input: linuxInput as unknown as InputBackend,
      swift: {
        display: linuxSwift.display,
        apps: linuxSwift.apps,
        screenshot: linuxSwift.screenshot,
      },
    }
    return cached
  }

  return null
}

export function isPlatformSupported(): boolean {
  const p = platform()
  return p === 'darwin' || p === 'win32' || p === 'linux'
}
