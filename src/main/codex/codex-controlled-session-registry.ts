import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import { CodexControlledFailedLaunchCleanupRegistry } from './codex-controlled-failed-launch-cleanup'
import { CodexControlledSessionCleanupCoordinator } from './codex-controlled-session-cleanup-coordinator'
import { CodexControlledSessionLifecycle } from './codex-controlled-session-lifecycle'
import { trackControlledSessionLaunch } from './codex-controlled-session-launch-tracker'
import {
  assertControlledThreadAlive,
  buildControlledThreadResumeParams,
  buildControlledThreadStartParams,
  controlledLaunchOutcomeUnknown,
  extractControlledThreadId,
  getControlledSocketPath,
  getControlledVisibleSocketPath,
  isSameControlledLaunch,
  resolveControlledCodexCommand,
  startControlledCodexServer,
  type ControlledCodexCommand,
  type CodexControlledSessionLaunch
} from './codex-controlled-session-launch'
import {
  connectControlledCodexClient,
  createReadyControlledTerminal,
  assertControlledServerAlive,
  submitControlledInitialPrompt,
  toControlledSessionError,
  type ControlledCodexSession
} from './codex-controlled-session-acquisition'
import {
  startControlledVisibleTransport,
  type ControlledVisibleTransport
} from './codex-controlled-visible-transport'
import type {
  CodexControlledNewSessionLaunch,
  CodexControlledSessionIdentity,
  CodexControlledSessionLaunchResult,
  CodexControlledSessionManagerOptions
} from './codex-controlled-session-manager'

export type { ControlledCodexSession } from './codex-controlled-session-acquisition'
export class CodexControlledSessionRegistry {
  private readonly sessions = new Map<string, ControlledCodexSession>()
  private readonly launches = new Map<string, Promise<unknown>>()
  private readonly lifecycle: CodexControlledSessionLifecycle
  private readonly failedLaunches: CodexControlledFailedLaunchCleanupRegistry
  private readonly cleanupCoordinator: CodexControlledSessionCleanupCoordinator

  constructor(
    private readonly options: CodexControlledSessionManagerOptions,
    private readonly socketRoot: () => string,
    onNotification: (
      session: ControlledCodexSession,
      method: string,
      params: Record<string, unknown>
    ) => void,
    onMissing: (conversationId: string) => void,
    private readonly assertCanSubmit: (session: ControlledCodexSession) => void,
    private readonly assertCanLaunch: (input: CodexControlledSessionLaunch) => void
  ) {
    this.lifecycle = new CodexControlledSessionLifecycle(options, onNotification, onMissing)
    this.failedLaunches = new CodexControlledFailedLaunchCleanupRegistry(this.lifecycle)
    this.cleanupCoordinator = new CodexControlledSessionCleanupCoordinator(
      this.sessions,
      this.launches,
      this.failedLaunches,
      this.lifecycle
    )
  }

  get(conversationId: string): ControlledCodexSession | undefined {
    return this.sessions.get(conversationId)
  }
  values(): IterableIterator<ControlledCodexSession> {
    return this.sessions.values()
  }

  async launch(input: CodexControlledSessionLaunch): Promise<CodexControlledSessionLaunchResult> {
    return trackControlledSessionLaunch(
      this.launches,
      input.conversationId,
      (conversationId) => this.assertNotDisposing(conversationId),
      () => this.launchExistingThread(input)
    )
  }
  private async launchExistingThread(
    input: CodexControlledSessionLaunch
  ): Promise<CodexControlledSessionLaunchResult> {
    const existing = this.sessions.get(input.conversationId)
    this.assertNoFailedCleanup(input.conversationId)
    if (existing) {
      if (!isSameControlledLaunch(existing.launch, input)) {
        throw new Error('controlled Codex conversation identity mismatch')
      }
      if (existing.missing) {
        throw new Error('controlled Codex conversation requires cleanup before relaunch')
      }
      existing.terminal = await this.lifecycle.refresh(existing)
      this.assertLaunchPermitted(existing.launch)
      return { identity: existing.terminal, disposition: 'reused', surface: 'visible' }
    }
    const command = resolveControlledCodexCommand(input.command)
    const socketRoot = this.socketRoot()
    const socketPath = getControlledSocketPath(socketRoot, input.conversationId)
    const server = await startControlledCodexServer(
      input,
      socketPath,
      this.options.spawnProcess,
      command
    )
    let client: CodexUnixAppServerClient | null = null
    let visibleIdentity: CodexControlledSessionIdentity | null = null
    let visibleTransport: ControlledVisibleTransport | null = null
    try {
      this.assertLaunchPermitted(input)
      client = await connectControlledCodexClient(input, socketPath)
      this.assertLaunchPermitted(input)
      await client.request('thread/resume', buildControlledThreadResumeParams(input))
      this.assertLaunchPermitted(input)
      visibleTransport = await startControlledVisibleTransport(
        socketPath,
        getControlledVisibleSocketPath(socketRoot, input.conversationId)
      )
      visibleIdentity = await createReadyControlledTerminal(
        this.options,
        input,
        visibleTransport,
        command,
        (created) => {
          visibleIdentity = created
        },
        server
      )
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      await assertControlledThreadAlive(client, input.threadId)
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      this.assertLaunchPermitted(input)
      const session = this.lifecycle.create(
        input,
        socketPath,
        server,
        visibleTransport,
        client,
        visibleIdentity
      )
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      this.sessions.set(input.conversationId, session)
      return { identity: visibleIdentity, disposition: 'created', surface: 'visible' }
    } catch (error) {
      try {
        await this.failedLaunches.rollback(
          input.conversationId,
          socketPath,
          server,
          visibleTransport,
          client,
          visibleIdentity
        )
      } catch (cleanupError) {
        Object.assign(toControlledSessionError(error), { cleanupError })
      }
      throw error
    }
  }
  async launchNew(
    input: CodexControlledNewSessionLaunch,
    command: ControlledCodexCommand = resolveControlledCodexCommand(input.command)
  ): Promise<CodexControlledSessionLaunchResult> {
    return trackControlledSessionLaunch(
      this.launches,
      input.conversationId,
      (conversationId) => this.assertNotDisposing(conversationId),
      () => this.launchNewThread(input, command)
    )
  }
  private async launchNewThread(
    input: CodexControlledNewSessionLaunch,
    command: ControlledCodexCommand
  ): Promise<CodexControlledSessionLaunchResult> {
    const existing = this.sessions.get(input.conversationId)
    this.assertNoFailedCleanup(input.conversationId)
    if (existing) {
      this.assertNewLaunchMatches(existing.launch, input)
      if (existing.missing) {
        throw new Error('controlled Codex conversation requires cleanup before relaunch')
      }
      existing.terminal = await this.lifecycle.refresh(existing)
      this.assertLaunchPermitted(existing.launch)
      await submitControlledInitialPrompt(existing, input, this.assertCanSubmit)
      return { identity: existing.terminal, disposition: 'reused', surface: 'visible' }
    }
    const socketRoot = this.socketRoot()
    const socketPath = getControlledSocketPath(socketRoot, input.conversationId)
    const provisional = { ...input, threadId: 'pending' }
    const server = await startControlledCodexServer(
      provisional,
      socketPath,
      this.options.spawnProcess,
      command
    )
    let client: CodexUnixAppServerClient | null = null
    let launch: CodexControlledSessionLaunch | null = null
    let identity: CodexControlledSessionIdentity | null = null
    let visibleTransport: ControlledVisibleTransport | null = null
    let threadStartAttempted = false
    try {
      this.assertLaunchPermitted(provisional)
      client = await connectControlledCodexClient(provisional, socketPath)
      this.assertLaunchPermitted(provisional)
      threadStartAttempted = true
      const started = await client.request(
        'thread/start',
        buildControlledThreadStartParams(provisional)
      )
      launch = { ...input, threadId: extractControlledThreadId(started) }
      this.assertLaunchPermitted(launch)
      visibleTransport = await startControlledVisibleTransport(
        socketPath,
        getControlledVisibleSocketPath(socketRoot, input.conversationId)
      )
      identity = await createReadyControlledTerminal(
        this.options,
        launch,
        visibleTransport,
        command,
        (created) => {
          identity = created
        },
        server
      )
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      await assertControlledThreadAlive(client, launch.threadId)
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      this.assertLaunchPermitted(launch)
      const session = this.lifecycle.create(
        launch,
        socketPath,
        server,
        visibleTransport,
        client,
        identity
      )
      assertControlledServerAlive(server)
      visibleTransport.assertLive()
      this.sessions.set(input.conversationId, session)
      await submitControlledInitialPrompt(session, input, this.assertCanSubmit)
      return { identity, disposition: 'created', surface: 'visible' }
    } catch (error) {
      if (this.sessions.has(input.conversationId)) {
        throw controlledLaunchOutcomeUnknown(error)
      }
      try {
        await this.failedLaunches.rollback(
          input.conversationId,
          socketPath,
          server,
          visibleTransport,
          client,
          identity
        )
      } catch (cleanupError) {
        Object.assign(toControlledSessionError(error), { cleanupError })
      }
      throw threadStartAttempted ? controlledLaunchOutcomeUnknown(error) : error
    }
  }

  async refresh(session: ControlledCodexSession): Promise<CodexControlledSessionIdentity> {
    return this.lifecycle.refresh(session)
  }

  async disposeConversation(conversationId: string): Promise<void> {
    return this.cleanupCoordinator.disposeConversation(conversationId)
  }

  async dispose(): Promise<void> {
    await this.cleanupCoordinator.dispose()
  }

  getConversationForPane(paneKey: string): string | null {
    return this.cleanupCoordinator.getConversationForPane(paneKey)
  }

  private assertNewLaunchMatches(
    existing: CodexControlledSessionLaunch,
    input: CodexControlledNewSessionLaunch
  ): void {
    if (!isSameControlledLaunch(existing, { ...input, threadId: existing.threadId })) {
      throw new Error('controlled Codex conversation identity mismatch')
    }
  }

  private assertLaunchPermitted(input: CodexControlledSessionLaunch): void {
    this.assertNotDisposing(input.conversationId)
    this.assertCanLaunch(input)
  }

  private assertNotDisposing(conversationId: string): void {
    this.cleanupCoordinator.assertNotDisposing(conversationId)
  }

  private assertNoFailedCleanup(conversationId: string): void {
    if (this.failedLaunches.has(conversationId)) {
      throw new Error('controlled Codex conversation requires cleanup before relaunch')
    }
  }
}
