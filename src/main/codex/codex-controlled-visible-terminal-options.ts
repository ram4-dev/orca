export type ControlledVisibleTerminalLaunch = {
  worktreeSelector: string
  command: string
  cwd: string
  env: Record<string, string>
  viewMode: 'terminal'
  conversationId: string
  threadId: string | null
}

export function buildControlledVisibleTerminalOptions(launch: ControlledVisibleTerminalLaunch): {
  command: string
  cwd: string
  env: Record<string, string>
  title: 'Codex'
  launchAgent: 'codex'
  presentation: 'focused'
  rendererBacked: false
  viewMode: 'terminal'
} {
  return {
    command: launch.command,
    cwd: launch.cwd,
    env: launch.env,
    title: 'Codex',
    launchAgent: 'codex',
    presentation: 'focused',
    rendererBacked: false,
    // The command already resumes through Orca's private remote app-server socket.
    // Agent resume metadata would replace it with an independent `codex resume` process.
    viewMode: launch.viewMode
  }
}

export async function appendControlledTerminalDiagnostic<T>(
  error: Error,
  terminal: T | null,
  inspect?: (terminal: T) => Promise<string>
): Promise<Error> {
  if (!terminal || !inspect) {
    return error
  }
  try {
    const diagnostic = await inspect(terminal)
    if (diagnostic) {
      error.message = `${error.message}: ${diagnostic}`
    }
  } catch {
    // Rollback remains authoritative if the diagnostic read races terminal exit.
  }
  return error
}
