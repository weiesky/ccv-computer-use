/**
 * Cross-platform clipboard access via OS-native CLI tools.
 *
 * The desktop host uses Electron's `clipboard` module; the standalone server
 * has no Electron, so we shell out:
 *   - macOS:  pbcopy / pbpaste
 *   - Windows: powershell Get-Clipboard / Set-Clipboard
 *   - Linux:  xclip
 *
 * All calls are synchronous because the underlying CLIs are tiny and the
 * executor surface that uses these is async but doesn't require parallelism
 * on the clipboard path. Callers wrap in `async` methods.
 */

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

export function readClipboard(): string {
  const p = platform()
  if (p === 'darwin') {
    return execFileSync('pbpaste', [], { encoding: 'utf-8' })
  }
  if (p === 'win32') {
    return execFileSync(
      'powershell',
      ['-NoProfile', '-Command', 'Get-Clipboard'],
      { encoding: 'utf-8' },
    ).trimEnd()
  }
  if (p === 'linux') {
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], {
      encoding: 'utf-8',
    })
  }
  throw new Error(`Unsupported platform: ${p}`)
}

export function writeClipboard(text: string): void {
  const p = platform()
  if (p === 'darwin') {
    execFileSync('pbcopy', [], { input: text })
    return
  }
  if (p === 'win32') {
    // Here-string keeps newlines intact; single-quoted to avoid PS interpolation.
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Set-Clipboard -Value @'\n${text}\n'@`],
      { input: text },
    )
    return
  }
  if (p === 'linux') {
    execFileSync('xclip', ['-selection', 'clipboard'], { input: text })
    return
  }
  throw new Error(`Unsupported platform: ${p}`)
}
