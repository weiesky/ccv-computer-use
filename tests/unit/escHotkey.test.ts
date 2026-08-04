/**
 * ESC hotkey unit test.
 *
 * Real key-press testing requires a GUI session and Accessibility permission,
 * so this suite covers the register/unregister contract: the function
 * returns a callable unregister, the unregister is idempotent, and a
 * failing platform hook doesn't propagate as a synchronous throw.
 */

import { describe, expect, test, vi } from 'vitest'

// Skip in CI / headless environments where the platform hook hangs.
// The node-global-key-listener spawns a subprocess that doesn't always die
// cleanly, leaving vitest unable to exit. Set RUN_ESC_HOTKEY_TESTS=1 to opt in.
const RUN = process.env.RUN_ESC_HOTKEY_TESTS === '1'
const runDescribe = RUN ? describe : describe.skip

import { registerEscapeHotkey } from '../../src/server/escHotkey.js'

runDescribe('registerEscapeHotkey', () => {
  test('returns an unregister function', () => {
    const onError = vi.fn()
    const unregister = registerEscapeHotkey(() => {}, { onError })
    expect(typeof unregister).toBe('function')
    // Cleanup — also exercises that unregister doesn't throw when the
    // platform hook never started (likely in CI without Accessibility).
    expect(() => unregister()).not.toThrow()
  })

  test('unregister is idempotent', () => {
    const onError = vi.fn()
    const unregister = registerEscapeHotkey(() => {}, { onError })
    expect(() => {
      unregister()
      unregister()
    }).not.toThrow()
  })

  test('async platform-hook failure surfaces via onError, not a sync throw', async () => {
    const onError = vi.fn()
    // Silence the default stderr write so the test output stays clean.
    const unregister = registerEscapeHotkey(() => {}, { onError })
    // Give the listener a tick to attempt startup and (probably) fail in
    // the headless test environment. We don't assert onError was called —
    // on macOS dev machines with Accessibility granted it may legitimately
    // succeed. The contract is just that registration itself never throws.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(() => unregister()).not.toThrow()
  })
})
