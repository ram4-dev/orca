import type { CodexControlledSessionIdentity } from './codex-controlled-session-manager'
import {
  buildControlledThreadStartParams,
  extractControlledThreadId,
  type ControlledCodexCommand,
  type CodexControlledSessionLaunch
} from './codex-controlled-session-launch'
import { buildControlledVisibleResumeCommand } from './codex-controlled-visible-resume-command'
import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'
import { materializeControlledThread } from './codex-controlled-thread-materialization'

export type ControlledDynamicToolOptions = {
  dynamicTools?: Record<string, unknown>[]
  controlledOrcaMcpEnabled?: boolean
  handleDynamicToolCall?: (request: {
    tool: string
    arguments: unknown
    launch: CodexControlledSessionLaunch
    terminal: CodexControlledSessionIdentity
  }) => Promise<unknown>
}

export function assertControlledLaunchPermitted(
  conversationId: string,
  assertNotDisposing: (conversationId: string) => void,
  assertCanLaunch: () => void
): void {
  assertNotDisposing(conversationId)
  assertCanLaunch()
}

export function assertNoControlledFailedCleanup(failed: boolean): void {
  if (failed) {
    throw new Error('controlled Codex conversation requires cleanup before relaunch')
  }
}

export async function startControlledThread(
  client: CodexUnixAppServerClient,
  input: CodexControlledSessionLaunch,
  dynamicTools?: Record<string, unknown>[],
  controlledOrcaMcpEnabled = false
): Promise<string> {
  return extractControlledThreadId(
    await client.request(
      'thread/start',
      buildControlledThreadStartParams(input, dynamicTools, controlledOrcaMcpEnabled)
    )
  )
}

export async function startMaterializedControlledThread(
  client: CodexUnixAppServerClient,
  input: CodexControlledSessionLaunch,
  options: ControlledDynamicToolOptions & {
    materializeThread?: (client: CodexUnixAppServerClient, threadId: string) => Promise<void>
  }
): Promise<string> {
  const threadId = await startControlledThread(
    client,
    input,
    options.dynamicTools,
    options.controlledOrcaMcpEnabled
  )
  await (options.materializeThread ?? materializeControlledThread)(client, threadId)
  return threadId
}

export function buildControlledNewThreadResume(
  launch: CodexControlledSessionLaunch,
  socketPath: string,
  command: ControlledCodexCommand
): { command: string; resumeThreadId: string } {
  return {
    command: buildControlledVisibleResumeCommand(launch, socketPath, command),
    resumeThreadId: launch.threadId
  }
}

export function attachControlledDynamicToolHandler(
  client: CodexUnixAppServerClient,
  options: ControlledDynamicToolOptions,
  launch: CodexControlledSessionLaunch,
  terminal: CodexControlledSessionIdentity
): void {
  if (!options.handleDynamicToolCall || !options.dynamicTools?.length) {
    return
  }
  client.onServerRequest(async (method, params) => {
    if (method !== 'item/tool/call') {
      throw new Error(`Unsupported controlled Codex request: ${method}`)
    }
    if (params.threadId !== launch.threadId || typeof params.tool !== 'string') {
      throw new Error('Controlled Codex dynamic tool request identity mismatch')
    }
    return options.handleDynamicToolCall!({
      tool: params.tool,
      arguments: params.arguments,
      launch,
      terminal
    })
  })
}
