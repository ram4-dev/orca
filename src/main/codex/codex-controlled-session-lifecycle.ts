import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import {
  captureControlledCleanup,
  throwControlledCleanupFailures
} from './codex-controlled-session-cleanup'
import {
  createControlledCodexSession,
  type ControlledCodexSession
} from './codex-controlled-session-acquisition'
import {
  stopControlledCodexServer,
  type ControlledCodexServer,
  type CodexControlledSessionLaunch
} from './codex-controlled-session-launch'
import type {
  CodexControlledSessionIdentity,
  CodexControlledSessionManagerOptions
} from './codex-controlled-session-manager'
import type { ControlledVisibleTransport } from './codex-controlled-visible-transport'

export class ControlledTerminalCleanupBlockedError extends Error {
  constructor(
    readonly stopError: unknown,
    readonly priorFailures: unknown[]
  ) {
    super('controlled Codex terminal stop could not be proven')
  }
}

export class CodexControlledSessionLifecycle {
  constructor(
    private readonly options: CodexControlledSessionManagerOptions,
    private readonly onNotification: (
      session: ControlledCodexSession,
      method: string,
      params: Record<string, unknown>
    ) => void,
    private readonly onMissing: (conversationId: string) => void
  ) {}

  create(
    launch: CodexControlledSessionLaunch,
    socketPath: string,
    server: ControlledCodexServer,
    visibleTransport: ControlledVisibleTransport,
    client: CodexUnixAppServerClient,
    terminal: CodexControlledSessionIdentity
  ): ControlledCodexSession {
    return createControlledCodexSession({
      options: this.options,
      launch,
      socketPath,
      server,
      visibleTransport,
      client,
      terminal,
      onNotification: this.onNotification,
      onMissing: this.onMissing
    })
  }

  async refresh(session: ControlledCodexSession): Promise<CodexControlledSessionIdentity> {
    session.visibleTransport.assertLive()
    const current = await this.options.waitForVisibleTerminal(session.terminal)
    session.visibleTransport.assertLive()
    if (
      current.terminalPaneKey !== session.terminal.terminalPaneKey ||
      current.worktreeId !== session.terminal.worktreeId ||
      current.terminalPtyId !== session.terminal.terminalPtyId
    ) {
      throw new Error('controlled Codex terminal identity changed')
    }
    return current
  }

  async dispose(session: ControlledCodexSession): Promise<void> {
    session.missing = true
    const failures: unknown[] = []
    if (!session.terminalClosed) {
      await captureControlledCleanup(failures, () =>
        this.options.closeVisibleTerminal(session.terminal)
      )
      await this.stopTerminal(session.terminal, failures)
      session.terminalClosed = true
    }
    await captureControlledCleanup(failures, async () => session.client.close())
    await captureControlledCleanup(failures, () => session.visibleTransport.stop())
    await captureControlledCleanup(failures, () =>
      stopControlledCodexServer(session.server, session.socketPath)
    )
    throwControlledCleanupFailures(failures)
  }

  async rollback(
    socketPath: string,
    server: ControlledCodexServer,
    visibleTransport: ControlledVisibleTransport | null,
    client: CodexUnixAppServerClient | null,
    terminal: CodexControlledSessionIdentity | null
  ): Promise<void> {
    const failures: unknown[] = []
    if (terminal) {
      await captureControlledCleanup(failures, () => this.options.closeVisibleTerminal(terminal))
      await this.stopTerminal(terminal, failures)
    }
    await captureControlledCleanup(failures, async () => client?.close())
    if (visibleTransport) {
      await captureControlledCleanup(failures, () => visibleTransport.stop())
    }
    await captureControlledCleanup(failures, () => stopControlledCodexServer(server, socketPath))
    throwControlledCleanupFailures(failures)
  }

  private async stopTerminal(
    terminal: CodexControlledSessionIdentity,
    failures: unknown[]
  ): Promise<void> {
    try {
      await this.options.ensureVisibleTerminalStopped(terminal)
    } catch (error) {
      throw new ControlledTerminalCleanupBlockedError(error, failures)
    }
  }
}
