import { CodexControlledSessionDisposalFence } from './codex-controlled-session-disposal-fence'
import type { CodexControlledFailedLaunchCleanupRegistry } from './codex-controlled-failed-launch-cleanup'
import type { ControlledCodexSession } from './codex-controlled-session-acquisition'
import {
  type CodexControlledSessionLifecycle,
  ControlledTerminalCleanupBlockedError
} from './codex-controlled-session-lifecycle'

export class CodexControlledSessionCleanupCoordinator {
  private readonly fence: CodexControlledSessionDisposalFence

  constructor(
    private readonly sessions: Map<string, ControlledCodexSession>,
    launches: Map<string, Promise<unknown>>,
    failedLaunches: CodexControlledFailedLaunchCleanupRegistry,
    lifecycle: CodexControlledSessionLifecycle
  ) {
    this.fence = new CodexControlledSessionDisposalFence(
      (conversationId) => launches.get(conversationId),
      () => new Set([...sessions.keys(), ...failedLaunches.keys(), ...launches.keys()]),
      async (conversationId) => {
        const session = sessions.get(conversationId)
        if (!session) {
          return failedLaunches.dispose(conversationId)
        }
        try {
          await lifecycle.dispose(session)
          sessions.delete(conversationId)
        } catch (error) {
          if (!(error instanceof ControlledTerminalCleanupBlockedError)) {
            sessions.delete(conversationId)
          }
          throw error
        }
      }
    )
  }

  assertNotDisposing(conversationId: string): void {
    this.fence.assertNotDisposing(conversationId)
  }

  disposeConversation(conversationId: string): Promise<void> {
    return this.fence.disposeConversation(conversationId)
  }

  dispose(): Promise<void> {
    return this.fence.dispose()
  }

  getConversationForPane(paneKey: string): string | null {
    for (const session of this.sessions.values()) {
      if (
        session.terminal.terminalPaneKey === paneKey &&
        !session.missing &&
        session.visibleTransport.isLive()
      ) {
        return session.launch.conversationId
      }
    }
    return null
  }
}
