import { execFileSync, spawn } from 'node:child_process'

export function runSync(cmd: string[]): string {
  const [exe, ...args] = cmd
  return execFileSync(exe!, args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

export async function runAsync(cmd: string[]): Promise<string> {
  const [exe, ...args] = cmd
  return new Promise((resolve, reject) => {
    const p = spawn(exe!, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.setEncoding('utf-8')
    p.stdout.on('data', c => (out += c))
    p.on('close', () => resolve(out.trim()))
    p.on('error', reject)
  })
}

export function psSync(script: string): string {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim()
}

export async function psAsync(script: string): Promise<string> {
  return runAsync(['powershell', '-NoProfile', '-NonInteractive', '-Command', script])
}

export function commandExists(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
