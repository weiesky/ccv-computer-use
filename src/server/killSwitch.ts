/**
 * Kill switch for the standalone computer-use MCP server.
 *
 * Mirrors the `chicagoEnabled` app preference from the Claude Code desktop
 * host, but reads from the environment instead — a standalone MCP server has
 * no app-preferences store.
 *
 * When disabled, `mcpServer.ts`'s ListTools handler returns an empty tool
 * list and `handleToolCall` errors out on every tool.
 */

import { isSandboxMode } from '../sandbox.js'

export function isComputerUseEnabled(): boolean {
  // Sandbox mode is an explicit escape hatch that bypasses the kill-switch.
  if (isSandboxMode()) return true
  return (
    process.env.ALLOW_ANT_COMPUTER_USE_MCP === '1' ||
    process.env.ALLOW_ANT_COMPUTER_USE_MCP === 'true'
  )
}
