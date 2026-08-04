/**
 * Sandbox-mode integration test.
 *
 * Spawns the CLI with ONLY `CCV_SANDBOX_MODE=1` (no kill-switch env var) and
 * verifies the server starts and lists the full tool set — proving the
 * kill-switch bypass works end-to-end through the CLI.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', '..', 'dist', 'cli.js')

describe('sandbox mode', () => {
  test('server starts with CCV_SANDBOX_MODE=1 and no kill-switch, lists tools', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [CLI, '--no-lock'],
      env: {
        ...process.env,
        CCV_SANDBOX_MODE: '1',
        // Intentionally NOT setting ALLOW_ANT_COMPUTER_USE_MCP — sandbox
        // mode must bypass the kill-switch.
        ALLOW_ANT_COMPUTER_USE_MCP: '',
      },
    })
    const client = new Client(
      { name: 'sandbox-test-client', version: '0.1.0' },
      { capabilities: {} },
    )

    await client.connect(transport)
    const { tools } = await client.listTools()

    const names = tools.map(t => t.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('request_access')
    expect(names).toContain('screenshot')
    expect(names).toContain('type')

    await client.close()
  }, 30000)
})
