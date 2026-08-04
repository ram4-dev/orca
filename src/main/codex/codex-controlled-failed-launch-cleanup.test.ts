import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import { CodexControlledFailedLaunchCleanupRegistry } from './codex-controlled-failed-launch-cleanup'
import type { ControlledCodexSession } from './codex-controlled-session-acquisition'
import {
  CodexControlledSessionLifecycle,
  ControlledTerminalCleanupBlockedError
} from './codex-controlled-session-lifecycle'
import type { ControlledCodexServer } from './codex-controlled-session-launch'
import type {
  CodexControlledSessionIdentity,
  CodexControlledSessionManagerOptions
} from './codex-controlled-session-manager'
import type { ControlledVisibleTransport } from './codex-controlled-visible-transport'

describe('controlled failed-launch cleanup', () => {
  it('force-stops and verifies the PTY before releasing the transport and controller', async () => {
    const fixture = createFixture()

    await expect(fixture.registry.rollback(...fixture.rollbackArgs)).rejects.toThrow(
      'terminal close failed'
    )

    expect(fixture.ensureStopped).toHaveBeenCalledOnce()
    expect(fixture.transport.stop).toHaveBeenCalledOnce()
    expect(fixture.process.exitCode).toBe(0)
    expect(fixture.registry.has('conversation-1')).toBe(false)
  })

  it('retains a safe cleanup target when exact PTY stop cannot be proven', async () => {
    const fixture = createFixture({ stopFailures: 1 })

    await expect(fixture.registry.rollback(...fixture.rollbackArgs)).rejects.toBeInstanceOf(
      ControlledTerminalCleanupBlockedError
    )
    expect(fixture.registry.has('conversation-1')).toBe(true)
    expect(fixture.transport.stop).not.toHaveBeenCalled()
    expect(fixture.process.kill).not.toHaveBeenCalled()

    await expect(fixture.registry.dispose('conversation-1')).rejects.toThrow(
      'terminal close failed'
    )
    expect(fixture.registry.has('conversation-1')).toBe(false)
    expect(fixture.transport.stop).toHaveBeenCalledOnce()
    expect(fixture.process.exitCode).toBe(0)
  })

  it('keeps an existing missing session controlled until PTY stop is proven', async () => {
    const fixture = createFixture({ stopFailures: 1 })
    const session = {
      terminal: fixture.terminal,
      terminalClosed: false,
      missing: false,
      client: fixture.client,
      visibleTransport: fixture.transport,
      server: fixture.server,
      socketPath: '/unused.sock'
    } as ControlledCodexSession

    await expect(fixture.lifecycle.dispose(session)).rejects.toBeInstanceOf(
      ControlledTerminalCleanupBlockedError
    )
    expect(session.missing).toBe(true)
    expect(fixture.transport.stop).not.toHaveBeenCalled()
    expect(fixture.process.exitCode).toBeNull()

    await expect(fixture.lifecycle.dispose(session)).rejects.toThrow('terminal close failed')
    expect(fixture.transport.stop).toHaveBeenCalledOnce()
    expect(fixture.process.exitCode).toBe(0)
  })
})

function createFixture(options: { stopFailures?: number } = {}) {
  const closeVisibleTerminal = vi.fn(async () => {
    throw new Error('terminal close failed')
  })
  const ensureStopped = vi.fn(async () => {
    if (ensureStopped.mock.calls.length <= (options.stopFailures ?? 0)) {
      throw new Error('terminal force stop failed')
    }
  })
  const managerOptions = {
    stateRoot: '/unused',
    createVisibleTerminal: vi.fn(),
    waitForVisibleTerminal: vi.fn(),
    waitForVisibleRemoteAttachment: vi.fn(),
    closeVisibleTerminal,
    ensureVisibleTerminalStopped: ensureStopped,
    resolveCurrentAccountId: () => 'account-a'
  } as unknown as CodexControlledSessionManagerOptions
  const lifecycle = new CodexControlledSessionLifecycle(managerOptions, vi.fn(), vi.fn())
  const registry = new CodexControlledFailedLaunchCleanupRegistry(lifecycle)
  const process = createProcess()
  const server: ControlledCodexServer = { process, socketIdentity: { dev: 0, ino: 0 } }
  const transport = {
    socketPath: '/unused-visible.sock',
    stop: vi.fn(async () => undefined)
  } as unknown as ControlledVisibleTransport
  const client = { close: vi.fn() } as unknown as CodexUnixAppServerClient
  const terminal: CodexControlledSessionIdentity = {
    conversationId: 'conversation-1',
    threadId: 'thread-1',
    terminalHandle: 'handle-1',
    terminalPtyId: 'pty-1',
    terminalTabId: 'tab-1',
    terminalPaneKey: 'pane-1',
    worktreeId: 'worktree-1'
  }
  return {
    registry,
    lifecycle,
    ensureStopped,
    transport,
    client,
    terminal,
    server,
    process,
    rollbackArgs: ['conversation-1', '/unused.sock', server, transport, client, terminal] as const
  }
}

function createProcess(): ChildProcess & {
  exitCode: number | null
  kill: ReturnType<typeof vi.fn>
} {
  const process = new EventEmitter() as ChildProcess & {
    exitCode: number | null
    kill: ReturnType<typeof vi.fn>
  }
  process.exitCode = null
  process.kill = vi.fn(() => {
    process.exitCode = 0
    process.emit('exit', 0, null)
    return true
  })
  return process
}
