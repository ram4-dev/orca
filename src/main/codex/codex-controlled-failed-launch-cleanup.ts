import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import {
  type CodexControlledSessionLifecycle,
  ControlledTerminalCleanupBlockedError
} from './codex-controlled-session-lifecycle'
import type { ControlledCodexServer } from './codex-controlled-session-launch'
import type { CodexControlledSessionIdentity } from './codex-controlled-session-manager'
import type { ControlledVisibleTransport } from './codex-controlled-visible-transport'

type FailedLaunchCleanup = {
  socketPath: string
  server: ControlledCodexServer
  visibleTransport: ControlledVisibleTransport
  client: CodexUnixAppServerClient | null
  terminal: CodexControlledSessionIdentity
}

export class CodexControlledFailedLaunchCleanupRegistry {
  private readonly cleanups = new Map<string, FailedLaunchCleanup>()

  constructor(private readonly lifecycle: CodexControlledSessionLifecycle) {}

  has(conversationId: string): boolean {
    return this.cleanups.has(conversationId)
  }

  keys(): IterableIterator<string> {
    return this.cleanups.keys()
  }

  async rollback(
    conversationId: string,
    socketPath: string,
    server: ControlledCodexServer,
    visibleTransport: ControlledVisibleTransport | null,
    client: CodexUnixAppServerClient | null,
    terminal: CodexControlledSessionIdentity | null
  ): Promise<void> {
    try {
      await this.lifecycle.rollback(socketPath, server, visibleTransport, client, terminal)
    } catch (error) {
      if (error instanceof ControlledTerminalCleanupBlockedError && visibleTransport && terminal) {
        this.cleanups.set(conversationId, {
          socketPath,
          server,
          visibleTransport,
          client,
          terminal
        })
      }
      throw error
    }
  }

  async dispose(conversationId: string): Promise<void> {
    const cleanup = this.cleanups.get(conversationId)
    if (!cleanup) {
      return
    }
    try {
      await this.lifecycle.rollback(
        cleanup.socketPath,
        cleanup.server,
        cleanup.visibleTransport,
        cleanup.client,
        cleanup.terminal
      )
      this.cleanups.delete(conversationId)
    } catch (error) {
      if (!(error instanceof ControlledTerminalCleanupBlockedError)) {
        this.cleanups.delete(conversationId)
      }
      throw error
    }
  }
}
