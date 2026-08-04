/**
 * Stdio transport bootstrap for the standalone computer-use MCP server.
 *
 * The MCP client (Claude Code, Cursor, etc.) spawns this process and speaks
 * JSON-RPC over stdin/stdout. All logging must go to stderr — anything on
 * stdout is parsed as protocol frames.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

export async function startStdioServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[ccv-computer-use] stdio server started\n')
}
