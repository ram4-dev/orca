import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { CodexControlledSessionIdentity } from './codex-controlled-session-manager'
import type { CodexControlledSessionLaunch } from './codex-controlled-session-launch'

export function getControlledOrcaMcpBindingPath(socketPath: string): string {
  return socketPath.replace(/(?:\.visible)?\.sock$/, '.orca-mcp.json')
}

export function writeControlledOrcaMcpBinding(
  socketPath: string,
  binding: { conversationId: string; threadId: string; terminalHandle: string }
): void {
  const path = getControlledOrcaMcpBindingPath(socketPath)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(binding)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export function bindControlledOrcaMcp(
  socketPath: string,
  launch: CodexControlledSessionLaunch,
  terminal: CodexControlledSessionIdentity
): void {
  writeControlledOrcaMcpBinding(socketPath, {
    conversationId: launch.conversationId,
    threadId: launch.threadId,
    terminalHandle: terminal.terminalHandle
  })
}

export function readControlledOrcaMcpBinding(path: string): {
  conversationId: string
  threadId: string
  terminalHandle: string
} {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (
    !isRecord(parsed) ||
    typeof parsed.conversationId !== 'string' ||
    typeof parsed.threadId !== 'string' ||
    typeof parsed.terminalHandle !== 'string'
  ) {
    throw new Error('controlled Orca MCP binding is invalid')
  }
  return parsed as { conversationId: string; threadId: string; terminalHandle: string }
}

export function removeControlledOrcaMcpBinding(socketPath: string): void {
  rmSync(getControlledOrcaMcpBindingPath(socketPath), { force: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
