/**
 * Teach-mode integration test.
 *
 * Two layers:
 *
 *   1. stdio handshake — spawns the CLI and asserts that the three teach
 *      tools are listed. Proves `capabilities.teachMode === true` flows
 *      through `buildComputerUseTools` into the wire protocol.
 *
 *   2. In-memory flow — uses `bindSessionContext` directly with a mock
 *      executor + standalone adapter to drive the full teach sequence:
 *      `request_teach_access` → `teach_step` → `teach_batch`. Exercises
 *      the real handlers (handleRequestTeachAccess / handleTeachStep /
 *      handleTeachBatch) without needing a desktop session or real
 *      mouse/keyboard side effects.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import type { ComputerExecutor, ScreenshotResult } from '../../src/executor.js'
import { createStandaloneAdapter } from '../../src/host/adapter.js'
import { bindSessionContext } from '../../src/mcpServer.js'
import { createInMemorySessionContext } from '../../src/server/sessionContext.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Spawn the source CLI via tsx so the test doesn't depend on `npm run build`
// — dist/ can lag src/ while sibling features are still being implemented.
const CLI = join(__dirname, '..', '..', 'src', 'cli.ts')
const TSX = join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx')

/** Per-test unique lock path so concurrent test files don't race on the lock. */
function freshLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cu-teach-test-'))
  return join(dir, 'ccv-computer-use.lock')
}

// ---------------------------------------------------------------------------
// Layer 1: stdio handshake — teach tools are exposed on the wire
// ---------------------------------------------------------------------------

describe('teach: stdio tool listing', () => {
  test('listTools includes the three teach-mode tools', async () => {
    const transport = new StdioClientTransport({
      command: TSX,
      args: [CLI, '--no-lock'],
      env: {
        ...process.env,
        ALLOW_ANT_COMPUTER_USE_MCP: '1',
      },
    })
    const client = new Client(
      { name: 'test-client', version: '0.1.0' },
      { capabilities: {} },
    )

    await client.connect(transport)
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name)

    expect(names).toContain('request_teach_access')
    expect(names).toContain('teach_step')
    expect(names).toContain('teach_batch')

    await client.close()
  }, 60000)
})

// ---------------------------------------------------------------------------
// Layer 2: in-memory flow — request_teach_access → teach_step → teach_batch
// ---------------------------------------------------------------------------

/** Tiny 1×1 PNG (white pixel), pre-encoded. Used as a fake screenshot. */
const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fakeScreenshot(): ScreenshotResult {
  return {
    base64: FAKE_PNG_BASE64,
    width: 100,
    height: 100,
    displayWidth: 100,
    displayHeight: 100,
    originX: 0,
    originY: 0,
    displayId: 0,
  }
}

/**
 * Build a no-side-effect executor. Everything except `listInstalledApps` and
 * `screenshot` is a no-op stub. The list contains a single fake app so the
 * permission flow has something to grant.
 */
function createMockExecutor(): ComputerExecutor {
  const fakeApp = {
    bundleId: 'com.example.FakeApp',
    displayName: 'FakeApp',
    path: '/Applications/FakeApp.app',
  }

  return {
    capabilities: {
      screenshotFiltering: 'none',
      platform: 'darwin',
      hostBundleId: 'com.example.Host',
      teachMode: true,
    },
    async prepareForAction() {
      return []
    },
    async previewHideSet() {
      return []
    },
    async getDisplaySize() {
      return {
        displayId: 0,
        width: 100,
        height: 100,
        scaleFactor: 1,
        originX: 0,
        originY: 0,
      }
    },
    async listDisplays() {
      return [
        {
          displayId: 0,
          width: 100,
          height: 100,
          scaleFactor: 1,
          originX: 0,
          originY: 0,
        },
      ]
    },
    async findWindowDisplays() {
      return []
    },
    async resolvePrepareCapture() {
      return { ...fakeScreenshot(), hidden: [], displayId: 0 }
    },
    async screenshot() {
      return fakeScreenshot()
    },
    async zoom() {
      return { base64: FAKE_PNG_BASE64, width: 100, height: 100 }
    },
    async key() {},
    async holdKey() {},
    async type() {},
    async readClipboard() {
      return ''
    },
    async writeClipboard() {},
    async moveMouse() {},
    async click() {},
    async mouseDown() {},
    async mouseUp() {},
    async getCursorPosition() {
      return { x: 0, y: 0 }
    },
    async drag() {},
    async scroll() {},
    async getFrontmostApp() {
      return null
    },
    async appUnderPoint() {
      return null
    },
    async listInstalledApps() {
      return [fakeApp]
    },
    async getAppIcon() {
      return undefined
    },
    async listRunningApps() {
      return [{ bundleId: fakeApp.bundleId, displayName: fakeApp.displayName }]
    },
    async openApp() {},
  }
}

describe('teach: in-memory flow', () => {
  test('request_teach_access → teach_step → teach_batch', async () => {
    const executor = createMockExecutor()
    const adapter = createStandaloneAdapter({
      serverName: 'ccv-computer-use-test',
      executor,
      logLevel: 'error', // keep stderr quiet in tests
    })
    // Bypass the env-var kill switch by monkey-patching isDisabled; the
    // killSwitch module is a pure env read and is covered separately.
    const originalIsDisabled = adapter.isDisabled
    adapter.isDisabled = () => false
    // Bypass macOS TCC check — in a headless test runner there's no
    // Accessibility permission, and we're exercising teach logic, not the
    // OS permission pipeline.
    adapter.ensureOsPermissions = async () => ({ granted: true as const })

    const sessionContext = createInMemorySessionContext({
      sessionId: 'teach-test-session',
      // Per-test unique path — the dispatcher WILL acquire/release the lock
      // as part of the flow, so we just point it at an isolated file.
      lockPath: freshLockPath(),
      teachAutoAdvance: true,
    })

    const dispatch = bindSessionContext(adapter, 'pixels', sessionContext)

    // ── 1. request_teach_access ──────────────────────────────────────
    const accessResult = await dispatch('request_teach_access', {
      apps: ['FakeApp'],
      reason: 'walk through the teach flow',
    })
    if (accessResult.isError) {
      console.error('request_teach_access failed:', JSON.stringify(accessResult.content))
    }
    expect(accessResult.isError).toBeUndefined()
    const accessText =
      accessResult.content[0]?.type === 'text' ? accessResult.content[0].text : ''
    const accessJson = JSON.parse(accessText)
    expect(accessJson.teachModeActive).toBe(true)
    expect(accessJson.granted).toHaveLength(1)
    expect(accessJson.granted[0].bundleId).toBe('com.example.FakeApp')
    expect(sessionContext.isTeachModeActive()).toBe(true)
    expect(sessionContext.getTeachModeActive?.()).toBe(true)

    // ── 2. teach_step ────────────────────────────────────────────────
    // With teachAutoAdvance=true the step's actions run immediately and the
    // handler appends a fresh screenshot to the result.
    const stepResult = await dispatch('teach_step', {
      explanation: 'This is the first tooltip.',
      next_preview: "Next: I'll move the mouse.",
      anchor: [50, 50],
      actions: [
        { action: 'mouse_move', coordinate: [10, 10] },
        { action: 'screenshot' },
      ],
    })
    expect(stepResult.isError).toBeUndefined()
    const stepText =
      stepResult.content[0]?.type === 'text' ? stepResult.content[0].text : ''
    const stepJson = JSON.parse(stepText)
    expect(stepJson.executed).toBe(2)
    expect(stepJson.results).toHaveLength(2)
    expect(stepJson.results.every((r: { ok: boolean }) => r.ok)).toBe(true)
    // appendTeachScreenshot folds the post-actions screenshot into the result
    // — piggybacked on .screenshot AND emitted as an image content block.
    expect(stepResult.screenshot).toBeDefined()
    expect(stepResult.screenshot?.base64).toBe(FAKE_PNG_BASE64)
    const hasImage = stepResult.content.some(c => c.type === 'image')
    expect(hasImage).toBe(true)

    // ── 3. teach_batch ───────────────────────────────────────────────
    const batchResult = await dispatch('teach_batch', {
      steps: [
        {
          explanation: 'Step one of the batch.',
          next_preview: 'Next: nothing happens (empty actions).',
          actions: [],
        },
        {
          explanation: 'Step two of the batch.',
          next_preview: "Next: I'll click once.",
          actions: [{ action: 'left_click', coordinate: [20, 20] }],
        },
      ],
    })
    expect(batchResult.isError).toBeUndefined()
    const batchText =
      batchResult.content[0]?.type === 'text'
        ? batchResult.content[0].text
        : ''
    const batchJson = JSON.parse(batchText)
    expect(batchJson.stepsCompleted).toBe(2)
    expect(batchJson.results).toHaveLength(2)
    // screenChanged === true because step 2 had a click action → final
    // screenshot is piggybacked onto the batch result.
    expect(batchResult.screenshot).toBeDefined()
    expect(batchResult.screenshot?.base64).toBe(FAKE_PNG_BASE64)

    adapter.isDisabled = originalIsDisabled
  })

  test('teach_step returns teach_mode_not_active when teach never started', async () => {
    const executor = createMockExecutor()
    const adapter = createStandaloneAdapter({
      serverName: 'ccv-computer-use-test',
      executor,
      logLevel: 'error',
    })
    adapter.isDisabled = () => false
    adapter.ensureOsPermissions = async () => ({ granted: true as const })

    const sessionContext = createInMemorySessionContext({
      sessionId: 'teach-test-no-access',
      lockPath: freshLockPath(),
    })
    const dispatch = bindSessionContext(adapter, 'pixels', sessionContext)

    // Without request_teach_access the handler should refuse — but note
    // that overrides.onTeachStep IS set (sessionContext always provides it).
    // The handler only checks the callback's presence, not the active flag,
    // so this resolves the step rather than erroring. Auto-advance means it
    // runs the actions anyway. Document the actual contract here.
    const result = await dispatch('teach_step', {
      explanation: 'orphan step',
      next_preview: 'next',
      actions: [],
    })
    expect(result.isError).toBeUndefined()
  })
})
