import { describe, expect, test } from 'vitest'

import {
  isSystemKeyCombo,
  normalizeKeySequence,
} from '../../src/keyBlocklist.js'

describe('keyBlocklist', () => {
  test('blocks cmd+q on darwin', () => {
    expect(isSystemKeyCombo('cmd+q', 'darwin')).toBe(true)
    expect(isSystemKeyCombo('command+q', 'darwin')).toBe(true)
    expect(isSystemKeyCombo('meta+q', 'darwin')).toBe(true)
  })

  test('blocks cmd+tab on darwin', () => {
    expect(isSystemKeyCombo('cmd+tab', 'darwin')).toBe(true)
  })

  test('blocks ctrl+alt+delete on win32', () => {
    expect(isSystemKeyCombo('ctrl+alt+delete', 'win32')).toBe(true)
    expect(isSystemKeyCombo('control+alt+delete', 'win32')).toBe(true)
  })

  test('blocks alt+f4 on win32', () => {
    expect(isSystemKeyCombo('alt+f4', 'win32')).toBe(true)
  })

  test('allows normal combos', () => {
    expect(isSystemKeyCombo('cmd+a', 'darwin')).toBe(false)
    expect(isSystemKeyCombo('ctrl+c', 'win32')).toBe(false)
    expect(isSystemKeyCombo('cmd+shift+a', 'darwin')).toBe(false)
  })

  test('normalizes aliases', () => {
    expect(normalizeKeySequence('command+q')).toBe('meta+q')
    expect(normalizeKeySequence('cmd+q')).toBe('meta+q')
    expect(normalizeKeySequence('win+l')).toBe('meta+l')
  })
})
