import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import { getControlledOrcaMcpBindingPath } from './codex-controlled-orca-mcp-binding'
import { buildControlledOrcaMcpArgs } from './codex-controlled-orca-mcp-command'
import type {
  CodexControlledSessionLaunch,
  ControlledCodexCommand
} from './codex-controlled-session-launch'

export function buildControlledVisibleResumeCommand(
  input: CodexControlledSessionLaunch,
  socketPath: string,
  command: ControlledCodexCommand
): string {
  const args = [
    'resume',
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
  args.push('--cd', input.cwd, input.threadId)
  return [command.executable, ...command.prefixArgs, ...args].map(quotePosixShell).join(' ')
}
