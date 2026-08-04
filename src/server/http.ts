/**
 * Streamable HTTP transport bootstrap for the standalone computer-use MCP
 * server.
 *
 * Listens on a localhost port and speaks MCP over HTTP (single endpoint,
 * JSON-RPC + optional SSE for streaming). Binds 127.0.0.1 by default —
 * computer-use is a same-machine protocol; exposing it on a public interface
 * would let any remote client drive the host's mouse and keyboard.
 *
 * Origin validation: the spec requires MCP servers to validate the `Origin`
 * header on incoming requests to prevent DNS-rebinding attacks from web
 * pages. We accept requests with no Origin (CLI clients don't set one) or
 * with an Origin whose host is localhost/127.0.0.1/[::1].
 */

import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export interface HttpServerOptions {
  /** Port to listen on (required). */
  port: number
  /** Bind address. Defaults to `127.0.0.1`. DO NOT pass `0.0.0.0` for a
   *  computer-use server — that exposes mouse/keyboard control to the LAN. */
  host?: string
  /** URL path for the MCP endpoint. Defaults to `/mcp`. */
  path?: string
  /** Optional callback for request-level error logging. */
  onError?: (err: unknown, req: IncomingMessage) => void
}

const DEFAULT_PATH = '/mcp'
const DEFAULT_HOST = '127.0.0.1'

/** Allow-list for Origin hosts. Anything else gets a 403. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // CLI clients (curl, MCP SDK) typically don't set Origin
  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

/**
 * Start an HTTP MCP server.
 *
 * Returns an async close function. The caller is responsible for invoking it
 * on shutdown (e.g. SIGINT) so the port is released.
 */
export async function startHttpServer(
  server: Server,
  opts: HttpServerOptions,
): Promise<() => Promise<void>> {
  const host = opts.host ?? DEFAULT_HOST
  const path = opts.path ?? DEFAULT_PATH
  const onError =
    opts.onError ??
    ((err: unknown) => {
      process.stderr.write(
        `[ccv-computer-use] http transport error: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    })

  // One transport per process. The MCP Streamable HTTP spec supports
  // multi-session via `mcp-session-id`, but computer-use is single-tenant
  // (the cross-process lock would reject concurrent sessions anyway), so
  // we generate a fresh session ID per server lifetime.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  const httpServer: HttpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        // DNS-rebinding defense: reject cross-origin browser requests.
        const origin = req.headers.origin
        if (!isAllowedOrigin(origin)) {
          res.writeHead(403, { 'content-type': 'text/plain' })
          res.end('Forbidden: invalid Origin')
          return
        }

        const url = req.url ?? ''
        const matchesPath =
          url === path || url.startsWith(`${path}?`) || url.startsWith(`${path}/`)
        if (!matchesPath) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('Not Found')
          return
        }

        try {
          await transport.handleRequest(req, res)
        } catch (err) {
          onError(err, req)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'text/plain' })
          }
          if (!res.writableEnded) {
            res.end('Internal Server Error')
          }
        }
      })()
    },
  )

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port, host, () => {
      httpServer.removeListener('error', reject)
      resolve()
    })
  })

  process.stderr.write(
    `[ccv-computer-use] HTTP server listening on http://${host}:${opts.port}${path}\n`,
  )

  return async () => {
    // Best-effort transport close; ignore errors so server.close always runs.
    try {
      await transport.close()
    } catch {}
    await new Promise<void>(resolve => {
      httpServer.close(() => resolve())
    })
  }
}
