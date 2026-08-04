const CODEX_THREAD_NOT_FOUND_RPC_CODE = -32600

export type ControlledThreadShape = {
  status?: { type?: unknown }
  canAcceptDirectInput?: unknown
}

export function parseControlledThread(response: unknown, threadId: string): ControlledThreadShape {
  if (!isRecord(response) || !isRecord(response.thread) || response.thread.id !== threadId) {
    throw new Error('controlled Codex thread/read returned an invalid response')
  }
  return response.thread as ControlledThreadShape
}

export function isMissingControlledThreadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error as Error & { rpcCode?: unknown }).rpcCode === CODEX_THREAD_NOT_FOUND_RPC_CODE ||
      /thread.*(?:not found|missing)|rollout.*not found/i.test(error.message))
  )
}

export function isUnmaterializedControlledThreadTurnsError(
  error: unknown,
  threadId: string
): boolean {
  return (
    error instanceof Error &&
    error.message ===
      `thread ${threadId} is not materialized yet; includeTurns is unavailable before first user message`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
