import { constants, accessSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree-id'

export type OrchestrationCliCommand = string

export function resolveTerminalOrchestrationCliCommand(args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
  localCommand?: OrchestrationCliCommand
}): OrchestrationCliCommand {
  if (args.connectionId) {
    return 'orca'
  }
  if (args.isWsl !== null && args.isWsl !== undefined) {
    return args.isWsl ? 'orca-ide' : (args.localCommand ?? 'orca')
  }
  if (args.projectRuntime?.status === 'resolved' && args.projectRuntime.runtime.kind === 'wsl') {
    return 'orca-ide'
  }

  const worktreePath = splitWorktreeIdForFilesystem(args.worktreeId)?.worktreePath
  return worktreePath && isWslUncPath(worktreePath) ? 'orca-ide' : (args.localCommand ?? 'orca')
}

export function resolveLocalOrchestrationCliCommand(
  env: NodeJS.ProcessEnv = process.env
): OrchestrationCliCommand {
  if (env.ORCA_PACKAGED_COMMAND_NAME !== 'orca-wake') {
    return 'orca'
  }
  const executable = env.ORCA_PACKAGED_CLI_BIN_PATH
  if (!executable || !isAbsolute(executable) || basename(executable) !== 'orca-wake') {
    throw new Error('Wake Dev bundled CLI path is unavailable')
  }
  try {
    if (!statSync(executable).isFile()) {
      throw new Error('not a file')
    }
    accessSync(executable, constants.X_OK)
  } catch {
    throw new Error('Wake Dev bundled CLI is missing or not executable')
  }
  return executable
}

export function resolveUnidentifiedTerminalOrchestrationCliCommand(
  env: NodeJS.ProcessEnv = process.env
): 'orca' {
  if (env.ORCA_PACKAGED_COMMAND_NAME === 'orca-wake') {
    throw new Error('Wake Dev terminal CLI identity is unavailable')
  }
  return 'orca'
}
