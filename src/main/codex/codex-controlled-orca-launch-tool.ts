import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolveLocalOrchestrationCliCommand } from '../runtime/orchestration/cli-command'
import type { CodexControlledSessionIdentity } from './codex-controlled-session-manager'
import type { CodexControlledSessionLaunch } from './codex-controlled-session-launch'

export const CONTROLLED_ORCA_LAUNCH_TOOL_NAME = 'orca_launch_worker'

export const CONTROLLED_ORCA_DYNAMIC_TOOLS: Record<string, unknown>[] = [
  {
    type: 'function',
    name: CONTROLLED_ORCA_LAUNCH_TOOL_NAME,
    description:
      'Launch one supervised Orca worker asynchronously in the current worktree. This creates the Task and Dispatch, starts the agent, and returns as soon as the worker is ready; it does not wait for task completion. Use this instead of running the orca CLI from the shell. Orca will wake this same Codex conversation when the worker finishes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1, description: 'Complete task for the worker.' },
        title: { type: 'string', description: 'Short task title shown in Orca.' },
        agent: {
          type: 'string',
          enum: ['codex', 'claude', 'cursor', 'gemini', 'opencode'],
          description: 'Agent to launch. Defaults to codex.'
        }
      }
    }
  }
]

type DynamicToolResponse = {
  success: boolean
  contentItems: { type: 'inputText'; text: string }[]
}

export async function handleControlledOrcaDynamicToolCall(args: {
  tool: string
  arguments: unknown
  launch: CodexControlledSessionLaunch
  terminal: CodexControlledSessionIdentity
  cliCommand?: string
  runCommand?: typeof runJsonCommand
}): Promise<DynamicToolResponse> {
  if (args.tool !== CONTROLLED_ORCA_LAUNCH_TOOL_NAME) {
    throw new Error(`Unsupported controlled Orca tool: ${args.tool}`)
  }
  return launchControlledOrcaWorker({
    arguments: args.arguments,
    cwd: args.launch.cwd,
    terminalHandle: args.terminal.terminalHandle,
    ...(args.cliCommand ? { cliCommand: args.cliCommand } : {}),
    ...(args.runCommand ? { runCommand: args.runCommand } : {})
  })
}

export async function launchControlledOrcaWorker(args: {
  arguments: unknown
  cwd: string
  terminalHandle: string
  cliCommand?: string
  runCommand?: typeof runJsonCommand
}): Promise<DynamicToolResponse> {
  const input = parseLaunchArguments(args.arguments)
  const cliCommand = args.cliCommand ?? resolveLocalOrchestrationCliCommand()
  const runCommand = args.runCommand ?? runJsonCommand
  const title = input.title ?? summarizeTitle(input.prompt)
  const currentRunPayload = await runCommand(cliCommand, args.cwd, [
    'orchestration',
    'run-current',
    '--from',
    args.terminalHandle,
    '--json'
  ])
  const currentRun = readOptionalRun(currentRunPayload)
  const runId = currentRun?.id ?? (await createRun()).id
  const taskPayload = await runCommand(cliCommand, args.cwd, [
    'orchestration',
    'task-create',
    '--spec',
    input.prompt,
    '--task-title',
    title,
    '--display-name',
    title,
    '--run',
    runId,
    '--from',
    args.terminalHandle,
    '--retry-request',
    randomUUID(),
    '--json'
  ])
  const taskId = readTaskId(taskPayload)
  let workerPayload: Record<string, unknown>
  try {
    workerPayload = await runCommand(cliCommand, args.cwd, [
      'orchestration',
      'worker-start',
      '--task',
      taskId,
      '--worktree',
      'current',
      '--agent',
      input.agent,
      '--from',
      args.terminalHandle,
      '--retry-request',
      randomUUID(),
      '--timeout-ms',
      '60000',
      '--json'
    ])
  } catch (error) {
    throw new Error(
      `Orca created task ${taskId} but could not start its worker: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const result = readResult(workerPayload)
  if (result.state !== 'ready') {
    throw new Error(
      `Orca worker launch did not reach ready state: ${JSON.stringify({ taskId, ...result })}`
    )
  }
  return {
    success: true,
    contentItems: [
      {
        type: 'inputText',
        text: JSON.stringify({ launched: true, runId, taskId, ...result })
      }
    ]
  }

  async function createRun(): Promise<{ id: string }> {
    const runPayload = await runCommand(cliCommand, args.cwd, [
      'orchestration',
      'run-create',
      '--objective',
      `Coordinate Orca work requested from Codex: ${title}`,
      '--from',
      args.terminalHandle,
      '--retry-request',
      randomUUID(),
      '--json'
    ])
    const run = readOptionalRun(runPayload)
    if (!run) {
      throw new Error('Orca run-create response did not include a run id')
    }
    return run
  }
}

function parseLaunchArguments(value: unknown): {
  prompt: string
  title?: string
  agent: 'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode'
} {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) {
    throw new Error('orca_launch_worker requires a non-empty prompt')
  }
  const supportedAgents = new Set(['codex', 'claude', 'cursor', 'gemini', 'opencode'])
  const agent = value.agent ?? 'codex'
  if (typeof agent !== 'string' || !supportedAgents.has(agent)) {
    throw new Error('orca_launch_worker received an unsupported agent')
  }
  if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim())) {
    throw new Error('orca_launch_worker title must be a non-empty string when supplied')
  }
  return {
    prompt: value.prompt.trim(),
    ...(typeof value.title === 'string' ? { title: value.title.trim().slice(0, 120) } : {}),
    agent: agent as 'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode'
  }
}

function summarizeTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || 'Orca worker'
  return firstLine.slice(0, 80)
}

async function runJsonCommand(
  command: string,
  cwd: string,
  argv: string[]
): Promise<Record<string, unknown>> {
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        command,
        argv,
        { cwd, env: controlledOrcaCliEnv(), timeout: 75_000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(`Orca command failed: ${stderr.trim() || stdout.trim() || error.message}`)
            )
            return
          }
          resolve({ stdout, stderr })
        }
      )
    }
  )
  let payload: unknown
  try {
    payload = JSON.parse(stdout) as unknown
  } catch (error) {
    throw new Error(
      `Orca returned invalid JSON: ${error instanceof Error ? error.message : String(error)}${stderr.trim() ? ` (${stderr.trim()})` : ''}`
    )
  }
  if (!isRecord(payload)) {
    throw new Error('Orca returned invalid JSON: response is not an object')
  }
  if (payload.ok === false) {
    throw new Error(readErrorMessage(payload) ?? 'Orca returned an unsuccessful response')
  }
  return payload
}

export function controlledOrcaCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  return childEnv
}

function readTaskId(payload: Record<string, unknown>): string {
  const result = readResult(payload)
  const task = isRecord(result.task) ? result.task : null
  const taskId = task?.id ?? result.taskId
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error('Orca task-create response did not include a task id')
  }
  return taskId
}

function readOptionalRun(payload: Record<string, unknown>): { id: string } | null {
  const result = readResult(payload)
  const run = isRecord(result.run) ? result.run : null
  return typeof run?.id === 'string' && run.id ? { id: run.id } : null
}

function readResult(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.result) ? payload.result : payload
}

function readErrorMessage(payload: Record<string, unknown>): string | null {
  const error = isRecord(payload.error) ? payload.error : null
  return typeof error?.message === 'string' ? error.message : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
