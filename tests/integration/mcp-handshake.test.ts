/**
 * MCP handshake integration test.
 *
 * Spawns the CLI as a stdio MCP server, connects as a client, and verifies
 * the expected tools are listed.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', '..', 'dist', 'cli.js')

describe('mcp-handshake', () => {
  test('listTools returns expected computer-use tools', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
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

    const names = tools.map(t => t.name).sort()
    expect(names).toContain('request_access')
    expect(names).toContain('screenshot')
    expect(names).toContain('zoom')
    expect(names).toContain('left_click')
    expect(names).toContain('double_click')
    expect(names).toContain('triple_click')
    expect(names).toContain('right_click')
    expect(names).toContain('middle_click')
    expect(names).toContain('type')
    expect(names).toContain('key')
    expect(names).toContain('scroll')
    expect(names).toContain('left_click_drag')
    expect(names).toContain('mouse_move')
    expect(names).toContain('open_application')
    expect(names).toContain('switch_display')
    expect(names).toContain('list_granted_applications')
    expect(names).toContain('read_clipboard')
    expect(names).toContain('write_clipboard')
    expect(names).toContain('wait')
    expect(names).toContain('cursor_position')
    expect(names).toContain('hold_key')
    expect(names).toContain('left_mouse_down')
    expect(names).toContain('left_mouse_up')
    expect(names).toContain('computer_batch')

    await client.close()
  }, 60000)
})
