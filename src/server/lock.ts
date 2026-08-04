/**
 * Cross-process file lock for the standalone computer-use MCP server.
 *
 * Extracted from Claude Code 2.1.220 (semantic equivalent of the O_EXCL lock
 * used by the CLI host). At most one MCP server process may hold the lock at a
 * time; sessions that lose the race get a `blocked` result and surface the
 * holder's session ID to the model.
 *
 * The lock file lives at `os.tmpdir()/ccv-computer-use.lock` and is a JSON payload
 * `{sessionId, pid, acquiredAt}`. Heartbeat is mtime-touched every 5s so a
 * future "abandoned lock" sweeper can distinguish live locks from stale ones
 * even when the holder's PID has been recycled.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HEARTBEAT_INTERVAL_MS = 5_000

export type LockCheckResult =
  | { kind: 'free' }
  | { kind: 'held_by_self' }
  | { kind: 'blocked'; by: string }

export interface LockHandle {
  release(): Promise<void>
}

interface LockPayload {
  sessionId: string
  pid: number
  acquiredAt: number
}

function defaultLockPath(): string {
  return path.join(os.tmpdir(), 'ccv-computer-use.lock')
}

function isErrnoException(e: unknown, code: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as NodeJS.ErrnoException).code === code
  )
}

async function readLockPayload(lockPath: string): Promise<LockPayload | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LockPayload>
    if (
      typeof parsed.sessionId === 'string' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.acquiredAt === 'number'
    ) {
      return parsed as LockPayload
    }
    return null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0: existence check, no signal delivered. Throws ESRCH if dead,
    // EPERM if alive but owned by another user (still alive).
    process.kill(pid, 0)
    return true
  } catch (e) {
    if (isErrnoException(e, 'ESRCH')) return false
    return true
  }
}

/**
 * Inspect the lock without taking it.
 *
 *  - `free`         — no lock file, or the lock file is stale (dead holder PID)
 *                     and has been cleaned up.
 *  - `held_by_self` — the current process holds the lock.
 *  - `blocked(by)`  — another live process holds the lock.
 */
export async function checkCuLock(
  lockPath: string = defaultLockPath(),
): Promise<LockCheckResult> {
  const payload = await readLockPayload(lockPath)
  if (!payload) return { kind: 'free' }

  if (payload.pid === process.pid) {
    return { kind: 'held_by_self' }
  }

  if (!isProcessAlive(payload.pid)) {
    // Stale — remove so a subsequent `acquireCuLock` doesn't have to race.
    try {
      await fs.unlink(lockPath)
    } catch {
      // Already gone — fine.
    }
    return { kind: 'free' }
  }

  return { kind: 'blocked', by: payload.sessionId }
}

/**
 * Take the lock for `sessionId`. On success returns a `LockHandle` whose
 * `release()` clears the heartbeat and removes the file. On contention returns
 * `{blocked: holderSessionId}`.
 *
 * Stale recovery: if the file exists but the holder PID is dead, the file is
 * removed and the acquire is retried once.
 */
export async function acquireCuLock(
  sessionId: string,
  lockPath: string = defaultLockPath(),
): Promise<LockHandle | { blocked: string }> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })

  const payload: LockPayload = {
    sessionId,
    pid: process.pid,
    acquiredAt: Date.now(),
  }

  const attempt = async (): Promise<'ok' | 'exists'> => {
    try {
      await fs.writeFile(lockPath, JSON.stringify(payload), { flag: 'wx' })
      return 'ok'
    } catch (e) {
      if (isErrnoException(e, 'EEXIST')) return 'exists'
      throw e
    }
  }

  let result = await attempt()

  if (result === 'exists') {
    const existing = await readLockPayload(lockPath)
    if (existing && !isProcessAlive(existing.pid)) {
      process.stderr.write(
        `Recovering stale ccv-computer-use lock from session ${existing.sessionId} (PID ${existing.pid})\n`,
      )
      try {
        await fs.unlink(lockPath)
      } catch {
        // Raced with another process — treat as still-blocked.
      }
      result = await attempt()
    }
  }

  if (result === 'exists') {
    const holder = await readLockPayload(lockPath)
    return { blocked: holder?.sessionId ?? 'unknown' }
  }

  const heartbeat = setInterval(() => {
    const now = new Date()
    fs.utimes(lockPath, now, now).catch(() => {
      // Lock file deleted externally — nothing sensible to do.
    })
  }, HEARTBEAT_INTERVAL_MS)
  // Don't keep the process alive solely for the heartbeat.
  heartbeat.unref?.()

  let released = false
  return {
    async release() {
      if (released) return
      released = true
      clearInterval(heartbeat)
      try {
        await fs.unlink(lockPath)
        process.stderr.write('Released ccv-computer-use lock\n')
      } catch {
        // Already gone — fine.
      }
    },
  }
}
