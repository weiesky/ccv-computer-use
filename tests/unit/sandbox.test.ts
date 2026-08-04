/**
 * Sandbox mode unit tests.
 *
 * Covers the four permission gates that `CCV_SANDBOX_MODE=1` elevates:
 * kill-switch, app tiering / policy deny, system-key blocklist, and grant
 * flags. Uses `vi.stubEnv` so the developer's shell can't leak sandbox mode
 * into tests (see tests/setup-env.ts).
 */

import { afterEach, describe, expect, test, vi } from 'vitest'

import { getDefaultTierForApp, isPolicyDenied } from '../../src/deniedApps.js'
import { isSystemKeyCombo } from '../../src/keyBlocklist.js'
import { isSandboxMode } from '../../src/sandbox.js'
import { isComputerUseEnabled } from '../../src/server/killSwitch.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isSandboxMode', () => {
  test('disabled by default', () => {
    delete process.env.CCV_SANDBOX_MODE
    expect(isSandboxMode()).toBe(false)
  })

  test('enabled by "1" or "true", not "0"/"false"', () => {
    vi.stubEnv('CCV_SANDBOX_MODE', '1')
    expect(isSandboxMode()).toBe(true)
    vi.stubEnv('CCV_SANDBOX_MODE', 'true')
    expect(isSandboxMode()).toBe(true)
    vi.stubEnv('CCV_SANDBOX_MODE', '0')
    expect(isSandboxMode()).toBe(false)
    vi.stubEnv('CCV_SANDBOX_MODE', 'false')
    expect(isSandboxMode()).toBe(false)
  })
})

describe('kill-switch bypass', () => {
  test('isComputerUseEnabled true in sandbox mode without the env gate', () => {
    delete process.env.ALLOW_ANT_COMPUTER_USE_MCP
    expect(isComputerUseEnabled()).toBe(false)
    vi.stubEnv('CCV_SANDBOX_MODE', '1')
    expect(isComputerUseEnabled()).toBe(true)
  })
})

describe('app tiering elevation', () => {
  test('browser / terminal / trading apps get tier "full" in sandbox', () => {
    vi.stubEnv('CCV_SANDBOX_MODE', '1')
    // Bundle-ID paths
    expect(getDefaultTierForApp('com.google.Chrome', 'Google Chrome')).toBe(
      'full',
    )
    expect(getDefaultTierForApp('com.apple.Terminal', 'Terminal')).toBe('full')
    expect(getDefaultTierForApp('com.binance.BinanceDesktop', 'Binance')).toBe(
      'full',
    )
    // Display-name fallback paths
    expect(getDefaultTierForApp(undefined, 'Google Chrome')).toBe('full')
    expect(getDefaultTierForApp(undefined, 'Terminal')).toBe('full')
    expect(getDefaultTierForApp(undefined, 'Robinhood')).toBe('full')
  })

  test('policy deny disabled in sandbox', () => {
    vi.stubEnv('CCV_SANDBOX_MODE', '1')
    expect(isPolicyDenied('com.spotify.client', 'Spotify')).toBe(false)
    expect(isPolicyDenied(undefined, 'netflix')).toBe(false)
  })
})

describe('system-key blocklist bypass', () => {
  test('isSystemKeyCombo false in sandbox for both platforms', () => {
    vi.stubEnv('CCV_SANDBOX_MODE', '1')
    expect(isSystemKeyCombo('meta+q', 'darwin')).toBe(false)
    expect(isSystemKeyCombo('ctrl+alt+delete', 'win32')).toBe(false)
  })
})

describe('sandboxNotice', () => {
  test('mentions the elevated gates and what is still enforced', async () => {
    const { sandboxNotice } = await import('../../src/sandbox.js')
    const text = sandboxNotice('test-server')
    expect(text).toContain('sandbox mode enabled')
    expect(text).toContain('app tiers = full')
    expect(text).toContain('system-key blocklist')
    expect(text).toContain('clipboard/systemKeyCombos flags granted')
    expect(text).toContain('cross-process lock')
    expect(text).toContain('TCC')
    expect(text).toContain('HTTP loopback binding')
  })
})
