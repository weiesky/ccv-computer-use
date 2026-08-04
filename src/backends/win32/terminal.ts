/**
 * Open a terminal (Windows Terminal / PowerShell / cmd) and launch an agent
 * CLI inside it. After launch, binds to the new terminal window so subsequent
 * virtual-input tools target it.
 */

import { psAsync } from '../_shared/spawn.js'
import { bindToWindow } from './windowBinding.js'
import { listWindows } from './windowEnum.js'

export interface OpenTerminalOpts {
  agent: 'claude' | 'codex' | 'gemini' | 'custom'
  command?: string
  terminal?: 'wt' | 'powershell' | 'cmd'
  workingDirectory?: string
}

export interface OpenTerminalResult {
  hwnd: string
  title: string
  launched: boolean
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''").replace(/`/g, '``')
}

function resolveCommand(opts: OpenTerminalOpts): string | null {
  if (opts.agent === 'custom') return opts.command ?? null
  return opts.agent // 'claude' | 'codex' | 'gemini' — same string is the command
}

/**
 * Launch a terminal with the requested agent command, wait briefly for the
 * window to appear, then bind to it. Returns the new window info, or null if
 * no new window could be located within the timeout.
 */
export async function openTerminal(
  opts: OpenTerminalOpts,
): Promise<OpenTerminalResult | null> {
  const terminal = opts.terminal ?? 'wt'
  const command = resolveCommand(opts)
  const workdir = opts.workingDirectory?.trim() || process.cwd()

  // Snapshot existing windows so we can detect the new one.
  const before = new Set(listWindows().map(w => w.hwnd))

  // Build the Start-Process invocation for the requested terminal.
  let launchScript = ''
  const escapedWorkdir = psQuote(workdir)
  const escapedCommand = command ? psQuote(command) : null

  if (terminal === 'wt') {
    // Windows Terminal: wt.exe -d <dir> <shell> -NoExit -Command <cmd>
    // When no command: wt.exe -d <dir>
    if (escapedCommand) {
      launchScript = `
$argList = @('-d', '${escapedWorkdir}', 'powershell', '-NoExit', '-Command', '${escapedCommand}')
Start-Process 'wt.exe' -ArgumentList $argList
`
    } else {
      launchScript = `
$argList = @('-d', '${escapedWorkdir}')
Start-Process 'wt.exe' -ArgumentList $argList
`
    }
  } else if (terminal === 'powershell') {
    if (escapedCommand) {
      launchScript = `
Start-Process 'powershell.exe' -ArgumentList @('-NoExit', '-Command', "Set-Location -Path '${escapedWorkdir}'; ${escapedCommand}")
`
    } else {
      launchScript = `
Start-Process 'powershell.exe' -ArgumentList @('-NoExit', '-Command', "Set-Location -Path '${escapedWorkdir}'")
`
    }
  } else {
    // cmd
    if (escapedCommand) {
      launchScript = `
Start-Process 'cmd.exe' -ArgumentList @('/k', "cd /d \\"${escapedWorkdir}\\" && ${escapedCommand}")
`
    } else {
      launchScript = `
Start-Process 'cmd.exe' -ArgumentList @('/k', "cd /d \\"${escapedWorkdir}\\"")
`
    }
  }

  try {
    await psAsync(launchScript)
  } catch {
    return null
  }

  // Poll for a new window to appear (up to ~5s).
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
    const now = listWindows()
    const fresh = now.filter(
      w =>
        !before.has(w.hwnd) &&
        /powershell|cmd|windows terminal|wt|command prompt/i.test(w.title),
    )
    if (fresh.length > 0) {
      const win = fresh[0]!
      // Bind so subsequent virtual-input tools target it.
      await bindToWindow({ hwnd: win.hwnd })
      return {
        hwnd: win.hwnd,
        title: win.title,
        launched: command !== null,
      }
    }
  }

  return null
}
