/**
 * In-memory implementation of `ComputerUseSessionContext` for the standalone
 * MCP server.
 *
 * The desktop host backs this with a real session store, an approval dialog,
 * and a renderer; the standalone host has none of those, so this module keeps
 * everything in process memory and auto-approves permission requests (subject
 * to the sentinel-app blocklist, unless overridden).
 *
 * Lock hooks bridge to the cross-process O_EXCL file lock in `./lock.js`.
 */

import type {
  AppGrant,
  ComputerUseSessionContext,
  CuGrantFlags,
  CuPermissionRequest,
  CuPermissionResponse,
  ScreenshotDims,
  TeachStepRequest,
  TeachStepResult,
} from '../types.js'
import { DEFAULT_GRANT_FLAGS } from '../types.js'
import {
  type LockHandle,
  acquireCuLock as acquireFileLock,
  checkCuLock as checkFileLock,
} from './lock.js'

export interface SessionContextOptions {
  sessionId: string
  /** Override the default `os.tmpdir()/ccv-computer-use.lock` path (testing). */
  lockPath?: string
  /**
   * Decide whether an app grant is auto-approved. Defaults to "approve
   * everything that isn't a shell/filesystem sentinel app". Return `true`
   * to grant, `false` to deny.
   */
  autoApprove?: (bundleId: string, displayName: string) => boolean
  /**
   * When `true`, `onTeachStep` returns `{action: 'next'}` immediately
   * (headless / auto-advance). When `false`, the teach-step request blocks
   * until someone calls `resumeTeachStep(...)` on the context — useful for
   * tests that drive the tour externally. Defaults to `true` because there
   * is no GUI overlay in this host.
   */
  teachAutoAdvance?: boolean
}

export interface InMemorySessionContext extends ComputerUseSessionContext {
  _internal: {
    lockHandle: LockHandle | null
    /**
     * Abort controller flipped by `_internal.abort()` (e.g. ESC hotkey).
     * Long-running tool loops (computer_batch, type) read `isAborted()` on
     * the same context to short-circuit between actions.
     */
    abortController: AbortController
    /** Fire the user-abort signal. Idempotent. */
    abort(): void
    /** Reset the abort signal so a fresh batch can run. Called by the host between turns. */
    resetAbort(): void
  }
  /** Toggle teach-step auto-advance at runtime (CLI flag `--teach-auto-advance`). */
  setTeachAutoAdvance(enabled: boolean): void
  /** Read the current teach-mode active flag (testing / observability). */
  isTeachModeActive(): boolean
  /**
   * External resume hook for `teachAutoAdvance: false`. Resolves the pending
   * `onTeachStep` promise with the given result. No-op when nothing pending.
   */
  resumeTeachStep(result: TeachStepResult): void
}

export function createInMemorySessionContext(
  opts: SessionContextOptions,
): InMemorySessionContext {
  const allowedApps = new Map<string, AppGrant>()
  let grantFlags: CuGrantFlags = { ...DEFAULT_GRANT_FLAGS }
  let selectedDisplayId: number | undefined
  let lastScreenshotDims: ScreenshotDims | undefined
  // Teach mode state. Without a GUI overlay there is no Next button, so
  // the default is "auto-advance": every onTeachStep call resolves with
  // `{action: 'next'}` immediately, and the actions queued inside the step
  // run without any user pacing. Setting `teachAutoAdvance: false` blocks
  // each step on `resumeTeachStep(...)` so tests / external drivers can
  // pace the tour themselves.
  let teachModeActive = false
  let teachAutoAdvance = opts.teachAutoAdvance ?? true
  let pendingTeachStep:
    | {
        resolve: (r: TeachStepResult) => void
        request: TeachStepRequest
      }
    | undefined

  const autoApprove =
    opts.autoApprove ??
    ((_bundleId: string, _displayName: string) => {
      // Default policy: approve everything. Sentinel filtering happens
      // upstream in `request_access` (the tool surfaces the warning to the
      // model); this in-memory host doesn't have a UI to gate on, so we
      // trust the model's judgement.
      return true
    })

  const ctx: InMemorySessionContext = {
    _internal: {
      lockHandle: null,
      abortController: new AbortController(),
      abort() {
        ctx._internal.abortController.abort()
      },
      resetAbort() {
        if (ctx._internal.abortController.signal.aborted) {
          ctx._internal.abortController = new AbortController()
        }
      },
    },

    // ── Read state ───────────────────────────────────────────────────
    getAllowedApps: () => [...allowedApps.values()],
    getGrantFlags: () => ({ ...grantFlags }),
    getUserDeniedBundleIds: () => [],
    getSelectedDisplayId: () => selectedDisplayId,
    getTeachModeActive: () => teachModeActive,
    getLastScreenshotDims: () => lastScreenshotDims,
    isAborted: () => ctx._internal.abortController.signal.aborted,

    // ── Write-back callbacks ─────────────────────────────────────────
    async onPermissionRequest(
      req: CuPermissionRequest,
      _signal: AbortSignal,
    ): Promise<CuPermissionResponse> {
      const granted: AppGrant[] = []
      const denied: Array<{
        bundleId: string
        reason: 'user_denied' | 'not_installed'
      }> = []

      for (const app of req.apps) {
        if (!app.resolved) {
          if (app.alreadyGranted) continue
          // Unresolved apps can't be granted — they'd fail later anyway.
          continue
        }
        const bundleId = app.resolved.bundleId
        const displayName = app.resolved.displayName
        if (app.alreadyGranted) {
          granted.push({
            bundleId,
            displayName,
            grantedAt: Date.now(),
            tier: app.proposedTier,
          })
          continue
        }
        if (autoApprove(bundleId, displayName)) {
          granted.push({
            bundleId,
            displayName,
            grantedAt: Date.now(),
            tier: app.proposedTier,
          })
        } else {
          denied.push({ bundleId, reason: 'user_denied' })
        }
      }

      return {
        granted,
        denied,
        flags: { ...DEFAULT_GRANT_FLAGS, ...req.requestedFlags },
        userConsented: true,
      }
    },

    onAllowedAppsChanged(apps, flags) {
      allowedApps.clear()
      for (const a of apps) allowedApps.set(a.bundleId, a)
      grantFlags = { ...flags }
    },

    onResolvedDisplayUpdated(displayId) {
      selectedDisplayId = displayId
    },

    onScreenshotCaptured(dims) {
      lastScreenshotDims = dims
    },

    // ── Teach mode ───────────────────────────────────────────────────
    //
    // Headless variant of the desktop teach overlay. There is no tooltip
    // window and no Next button — the callbacks here just track state in
    // memory and (by default) auto-advance each step so the actions inside
    // `teach_step.actions` run immediately.
    //
    // Tiers: teach mode grants stay at their `proposedTier` from
    // `buildAccessRequest` — same as regular `request_access`. The teach
    // schema simply doesn't expose clipboard / systemKeyCombos grant flags,
    // so only read/click/full tiers flow through; no tier elevation happens
    // here.

    async onTeachPermissionRequest(req) {
      const granted: AppGrant[] = []
      const denied: Array<{
        bundleId: string
        reason: 'user_denied' | 'not_installed'
      }> = []

      for (const app of req.apps) {
        if (!app.resolved) {
          if (app.alreadyGranted) continue
          continue
        }
        const bundleId = app.resolved.bundleId
        const displayName = app.resolved.displayName
        if (app.alreadyGranted) {
          granted.push({
            bundleId,
            displayName,
            grantedAt: Date.now(),
            tier: app.proposedTier,
          })
          continue
        }
        if (autoApprove(bundleId, displayName)) {
          granted.push({
            bundleId,
            displayName,
            grantedAt: Date.now(),
            tier: app.proposedTier,
          })
        } else {
          denied.push({ bundleId, reason: 'user_denied' })
        }
      }

      return {
        granted,
        denied,
        // Teach mode does not surface grant flags — preserve the defaults.
        flags: { ...DEFAULT_GRANT_FLAGS },
        // Standalone host has no dialog; treat the auto-approval as consent.
        userConsented: true,
      }
    },

    onTeachModeActivated() {
      teachModeActive = true
    },

    async onTeachStep(request) {
      if (teachAutoAdvance) {
        // No overlay to click Next — just record that the step ran and move on.
        return { action: 'next' }
      }
      // Manual pacing: park until resumeTeachStep(...) is called externally.
      return new Promise<TeachStepResult>(resolve => {
        pendingTeachStep = { resolve, request }
      })
    },

    onTeachWorking() {
      // No spinner UI in the standalone host. Kept as a hook for parity with
      // `ComputerUseSessionContext`.
    },

    // ── Teach-mode control surface (not part of ComputerUseSessionContext) ──
    setTeachAutoAdvance(enabled: boolean) {
      teachAutoAdvance = enabled
      // If a step is parked awaiting a manual resume and auto-advance is
      // re-enabled, flush it so the model isn't stuck forever.
      if (enabled && pendingTeachStep) {
        const pending = pendingTeachStep
        pendingTeachStep = undefined
        pending.resolve({ action: 'next' })
      }
    },

    isTeachModeActive() {
      return teachModeActive
    },

    resumeTeachStep(result) {
      const pending = pendingTeachStep
      pendingTeachStep = undefined
      pending?.resolve(result)
    },

    // ── Lock (async, file-backed) ────────────────────────────────────
    async checkCuLock() {
      const result = await checkFileLock(opts.lockPath)
      if (result.kind === 'free') return { holder: undefined, isSelf: false }
      if (result.kind === 'held_by_self') {
        return { holder: opts.sessionId, isSelf: true }
      }
      return { holder: result.by, isSelf: false }
    },

    async acquireCuLock() {
      const result = await acquireFileLock(opts.sessionId, opts.lockPath)
      if ('blocked' in result) {
        throw new Error(`computer-use lock held by ${result.blocked}`)
      }
      ctx._internal.lockHandle = result
    },

    formatLockHeldMessage(holder) {
      return (
        `Another computer-use session (${holder.slice(0, 8)}…) is currently ` +
        'using the computer. Wait for that session to finish, or find a ' +
        'non-computer-use approach.'
      )
    },
  }

  return ctx
}
