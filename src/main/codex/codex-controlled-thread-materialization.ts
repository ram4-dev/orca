import type { CodexUnixAppServerClient } from './codex-unix-app-server-client'

const MATERIALIZATION_TIMEOUT_MS = 30_000

export async function materializeControlledThread(
  client: Pick<CodexUnixAppServerClient, 'request' | 'onNotification'>,
  threadId: string,
  timeoutMs = MATERIALIZATION_TIMEOUT_MS
): Promise<void> {
  const completedTurns = new Set<string>()
  let resolveCompletion: (() => void) | null = null
  const removeNotificationListener = client.onNotification((method, params) => {
    if (method !== 'turn/completed' || params.threadId !== threadId) {
      return
    }
    const turn = isRecord(params.turn) ? params.turn : null
    if (typeof turn?.id !== 'string') {
      return
    }
    completedTurns.add(turn.id)
    resolveCompletion?.()
  })

  try {
    const started = await client.request('turn/start', { threadId, input: [] }, timeoutMs)
    const turnId = extractTurnId(started)
    if (!completedTurns.has(turnId)) {
      await waitForCompletion(
        () => completedTurns.has(turnId),
        (resolve) => {
          resolveCompletion = resolve
        },
        timeoutMs
      )
    }
    await client.request('thread/rollback', { threadId, numTurns: 1 }, timeoutMs)
  } finally {
    removeNotificationListener()
  }
}

function extractTurnId(value: unknown): string {
  const result = isRecord(value) ? value : null
  const turn = result && isRecord(result.turn) ? result.turn : null
  if (typeof turn?.id !== 'string') {
    throw new Error('controlled Codex materialization did not return a turn id')
  }
  return turn.id
}

async function waitForCompletion(
  isCompleted: () => boolean,
  setResolver: (resolve: () => void) => void,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('controlled Codex thread materialization timed out')),
      timeoutMs
    )
    timer.unref?.()
    setResolver(() => {
      if (!isCompleted()) {
        return
      }
      clearTimeout(timer)
      resolve()
    })
    if (isCompleted()) {
      clearTimeout(timer)
      resolve()
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
