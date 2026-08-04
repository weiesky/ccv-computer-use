/**
 * stderr logger for the standalone MCP server.
 *
 * The `Logger` interface here matches the one in `../types.ts` (info / error /
 * warn / debug / silly) — but the variadic signature accepts extra context
 * args which are JSON-serialized onto the line, since there's no telemetry
 * pipeline to ship structured events to.
 *
 * Everything goes to stderr because stdout is the MCP transport.
 */

export type LogLevel = 'silly' | 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  silly(msg: string, ...args: unknown[]): void
}

const LEVELS: ReadonlyArray<LogLevel | 'silly'> = [
  'silly',
  'debug',
  'info',
  'warn',
  'error',
]

export function createStderrLogger(
  prefix: string,
  minLevel: LogLevel = 'info',
): Logger {
  const minIdx = LEVELS.indexOf(minLevel)

  const write = (level: LogLevel | 'silly', msg: string, args: unknown[]) => {
    if (LEVELS.indexOf(level) < minIdx) return
    const extra =
      args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : ''
    process.stderr.write(`[${prefix}] [${level}] ${msg}${extra}\n`)
  }

  return {
    silly: (m, ...a) => write('silly', m, a),
    debug: (m, ...a) => write('debug', m, a),
    info: (m, ...a) => write('info', m, a),
    warn: (m, ...a) => write('warn', m, a),
    error: (m, ...a) => write('error', m, a),
  }
}
