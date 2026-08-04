/**
 * HTTP transport integration test.
 *
 * Boots the in-process server on a loopback port, connects via the MCP
 * Streamable HTTP client, and verifies listTools works end-to-end. Also
 * covers the Origin allow-list (DNS-rebinding defense) and 404 for
 * non-MCP paths.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, test } from 'vitest'

// Must be set before importing the adapter modules (kill-switch is read
// lazily but consistently).
process.env.ALLOW_ANT_COMPUTER_USE_MCP = '1'

import { createComputerUseMcpServer } from '../../src/mcpServer.js'
import { createStandaloneAdapter } from '../../src/host/adapter.js'
import { startHttpServer } from '../../src/server/http.js'
import { createInMemorySessionContext } from '../../src/server/sessionContext.js'
import { randomUUID } from 'node:crypto'

// Executor stub — startHttpServer doesn't touch the executor for listTools,
// but createStandaloneAdapter requires one. We forward every call to a
// rejection so an accidental hit surfaces loudly in the test log.
const stubExecutor = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('executor stub: not implemented in http.test.ts')
    },
  },
  // The ComputerExecutor interface has many methods; we don't need to
  // satisfy it at type-check time for this test.
) as never

describe('http transport', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) {
      await close()
      close = undefined
    }
  })

  async function startServer(port: number) {
    const adapter = createStandaloneAdapter({
      serverName: 'ccv-computer-use-test',
      executor: stubExecutor,
    })
    const sessionContext = createInMemorySessionContext({
      sessionId: randomUUID(),
      lockPath: '/dev/null/ccv-computer-use.test.lock.skip',
    })
    const server = createComputerUseMcpServer(adapter, 'pixels', sessionContext)
    close = await startHttpServer(server, { port, host: '127.0.0.1', path: '/mcp' })
  }

  test('listTools returns expected computer-use tools over HTTP', async () => {
    // Use a high, hopefully-uncontended port. Tests run sequentially within
    // the file (vitest default) so collisions are unlikely.
    const port = 13456
    await startServer(port)

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    )
    const client = new Client(
      { name: 'http-test-client', version: '0.1.0' },
      { capabilities: {} },
    )

    await client.connect(transport)
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name)

    expect(names).toContain('request_access')
    expect(names).toContain('screenshot')
    expect(names).toContain('left_click')
    expect(names).toContain('type')
    expect(names).toContain('computer_batch')

    await client.close()
  }, 30000)

  test('rejects cross-origin requests (DNS-rebinding defense)', async () => {
    const port = 13457
    await startServer(port)

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })

    expect(res.status).toBe(403)
  }, 30000)

  test('returns 404 for non-MCP paths', async () => {
    const port = 13458
    await startServer(port)

    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
  }, 30000)
})
