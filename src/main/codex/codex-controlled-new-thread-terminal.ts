import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import { createReadyControlledTerminal } from './codex-controlled-session-acquisition'
import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import type {
  ControlledCodexCommand,
  ControlledCodexServer,
  CodexControlledSessionLaunch
} from './codex-controlled-session-launch'
import type {
  CodexControlledSessionIdentity,
  CodexControlledSessionManagerOptions
} from './codex-controlled-session-manager'
import {
  captureControlledThreadStart,
  type ControlledThreadStartCapture
} from './codex-controlled-thread-start-notification'
import type { ControlledVisibleTransport } from './codex-controlled-visible-transport'
import { buildControlledOrcaMcpArgs } from './codex-controlled-orca-mcp-command'
import { getControlledOrcaMcpBindingPath } from './codex-controlled-orca-mcp-binding'

export async function createReadyControlledNewThreadTerminal(
  options: CodexControlledSessionManagerOptions,
  input: CodexControlledSessionLaunch,
  visibleTransport: ControlledVisibleTransport,
  command: ControlledCodexCommand,
  onCreated: (identity: CodexControlledSessionIdentity) => void,
  server: ControlledCodexServer,
  client: CodexUnixAppServerClient
): Promise<{
  identity: CodexControlledSessionIdentity
  threadId: string
  capture: ControlledThreadStartCapture
}> {
  const controller = new AbortController()
  const capture = captureControlledThreadStart(client, controller.signal)
  try {
    const identity = await createReadyControlledTerminal(
      options,
      input,
      visibleTransport,
      command,
      onCreated,
      server,
      {
        command: buildControlledVisibleStartCommand(input, visibleTransport.socketPath, command),
        resumeThreadId: null
      }
    )
    const threadId = await capture.waitForThreadId()
    capture.assertExact(threadId)
    return { identity: { ...identity, threadId }, threadId, capture }
  } catch (error) {
    controller.abort()
    capture.stop()
    throw error
  }
}

function buildControlledVisibleStartCommand(
  input: CodexControlledSessionLaunch,
  socketPath: string,
  command: ControlledCodexCommand
): string {
  const args = [
    '--remote',
    `unix://${socketPath}`,
    ...buildControlledOrcaMcpArgs(
      process.execPath,
      undefined,
      getControlledOrcaMcpBindingPath(socketPath)
    )
  ]
  if (input.model) {
    args.push('--model', input.model)
  }
  if (input.sandbox) {
    args.push('--sandbox', input.sandbox)
  }
  if (input.approvalPolicy) {
    args.push('--ask-for-approval', input.approvalPolicy)
  }
  args.push('--cd', input.cwd)
  return [command.executable, ...command.prefixArgs, ...args].map(quotePosixShell).join(' ')
}
