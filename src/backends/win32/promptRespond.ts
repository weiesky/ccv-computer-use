/**
 * Handle interactive CLI/terminal prompts (Yes/No, selection menus,
 * confirmations) by sending virtual keyboard input to the bound window.
 *
 * This is a convenience wrapper around virtualKeyboard that codifies the
 * common prompt-response flows the model uses in `prompt_respond`.
 */

import { virtualKeyboard } from './virtualInput.js'
import { getBoundWindow } from './windowBinding.js'

export interface RespondToPromptOpts {
  responseType: 'yes' | 'no' | 'enter' | 'escape' | 'select' | 'type'
  arrowDirection?: 'up' | 'down'
  arrowCount?: number
  text?: string
}

export async function respondToPrompt(
  opts: RespondToPromptOpts,
): Promise<boolean> {
  if (!getBoundWindow()) return false

  const { responseType } = opts
  const arrowCount = Math.max(0, Math.min(50, opts.arrowCount ?? 1))
  const arrowDir = opts.arrowDirection === 'up' ? 'up' : 'down'

  switch (responseType) {
    case 'yes':
      return virtualKeyboard({ action: 'type', text: 'y\r' })
    case 'no':
      return virtualKeyboard({ action: 'type', text: 'n\r' })
    case 'enter':
      return virtualKeyboard({ action: 'press', text: 'enter' }).then(ok =>
        ok ? virtualKeyboard({ action: 'release', text: 'enter' }) : false,
      )
    case 'escape':
      return virtualKeyboard({ action: 'press', text: 'escape' }).then(ok =>
        ok ? virtualKeyboard({ action: 'release', text: 'escape' }) : false,
      )
    case 'select': {
      // Send N arrow presses then Enter.
      for (let i = 0; i < arrowCount; i++) {
        const okDown = await virtualKeyboard({ action: 'press', text: arrowDir })
        if (!okDown) return false
        const okUp = await virtualKeyboard({ action: 'release', text: arrowDir })
        if (!okUp) return false
        await new Promise(r => setTimeout(r, 80))
      }
      const okPress = await virtualKeyboard({ action: 'press', text: 'enter' })
      if (!okPress) return false
      return virtualKeyboard({ action: 'release', text: 'enter' })
    }
    case 'type': {
      if (!opts.text) return false
      return virtualKeyboard({ action: 'type', text: `${opts.text}\r` })
    }
    default:
      return false
  }
}
