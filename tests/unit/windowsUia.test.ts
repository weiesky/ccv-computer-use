import { describe, expect, test } from 'vitest'

import { __internal as uiaInternal } from '../../src/backends/win32/uia.js'
import { __internal as virtInternal } from '../../src/backends/win32/virtualInput.js'
import { statusIndicator } from '../../src/backends/win32/statusIndicator.js'
import {
  getBoundWindow,
  unbindFromWindow,
} from '../../src/backends/win32/windowBinding.js'

describe('windowsUia.roleToControlTypeId', () => {
  test('maps common friendly role names to UIA ControlType ids', () => {
    const table = uiaInternal.ROLE_TO_CONTROL_TYPE_ID
    expect(table.button).toBe(50000)
    expect(table.edit).toBe(50004)
    expect(table.link).toBe(50005)
    expect(table.hyperlink).toBe(50005)
    expect(table.menuitem).toBe(50011)
    expect(table.window).toBe(50032)
    expect(table.document).toBe(50030)
  })

  test('buildConditions emits PropertyCondition for automationId', () => {
    const conds = uiaInternal.buildConditions({ automationId: 'btnSave' })
    expect(conds.length).toBe(1)
    expect(conds[0]).toContain('AutomationIdProperty')
    expect(conds[0]).toContain('btnSave')
  })

  test('buildConditions emits ControlType condition for known role', () => {
    const conds = uiaInternal.buildConditions({ role: 'button' })
    expect(conds.length).toBe(1)
    expect(conds[0]).toContain('ControlTypeProperty')
    expect(conds[0]).toContain('LookUpById(50000)')
  })

  test('buildConditions emits name pattern marker for name queries', () => {
    const conds = uiaInternal.buildConditions({ name: 'Save' })
    expect(conds.length).toBe(1)
    expect(conds[0]).toContain("namePattern = 'Save'")
  })

  test('buildConditions escapes single quotes in name', () => {
    const conds = uiaInternal.buildConditions({ name: "It's" })
    expect(conds[0]).toContain("It''s")
  })

  test('buildConditions skips unknown role silently', () => {
    const conds = uiaInternal.buildConditions({ role: 'not_a_real_role' })
    expect(conds.length).toBe(0)
  })
})

describe('virtualInput.resolveVk', () => {
  test('maps single letters to VK codes', () => {
    expect(virtInternal.resolveVk('a')).toBe(0x41)
    expect(virtInternal.resolveVk('Z')).toBe(0x5a)
    expect(virtInternal.resolveVk('5')).toBe(0x35)
  })

  test('maps named keys via VK_MAP', () => {
    expect(virtInternal.resolveVk('enter')).toBe(0x0d)
    expect(virtInternal.resolveVk('escape')).toBe(0x1b)
    expect(virtInternal.resolveVk('ctrl')).toBe(0x11)
    expect(virtInternal.resolveVk('shift')).toBe(0x10)
    expect(virtInternal.resolveVk('f5')).toBe(0x74)
    expect(virtInternal.resolveVk('space')).toBe(0x20)
  })

  test('returns null for unknown keys', () => {
    expect(virtInternal.resolveVk('notakey')).toBeNull()
    expect(virtInternal.resolveVk('!')).toBeNull()
  })
})

describe('virtualInput.makeLParamMouse', () => {
  test('packs x/y into LPARAM', () => {
    const packed = virtInternal.makeLParamMouse(100, 200)
    expect(packed).toContain('100')
    expect(packed).toContain('200')
    expect(packed).toContain('-shl 16')
  })
})

describe('statusIndicator (in-process model)', () => {
  test('show activates with message', () => {
    const r = statusIndicator('show', 'Working…')
    expect(r.active).toBe(true)
    expect(r.message).toBe('Working…')
  })

  test('status returns current state', () => {
    statusIndicator('show', 'Hello')
    const r = statusIndicator('status')
    expect(r.active).toBe(true)
    expect(r.message).toBe('Hello')
  })

  test('hide clears state', () => {
    statusIndicator('show', 'X')
    const r = statusIndicator('hide')
    expect(r.active).toBe(false)
    const after = statusIndicator('status')
    expect(after.active).toBe(false)
  })
})

describe('windowBinding (unbound defaults)', () => {
  test('getBoundWindow starts null', () => {
    unbindFromWindow()
    expect(getBoundWindow()).toBeNull()
  })

  test('unbindFromWindow is idempotent', () => {
    unbindFromWindow()
    unbindFromWindow()
    expect(getBoundWindow()).toBeNull()
  })
})
