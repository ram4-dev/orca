import { describe, expect, it, vi } from 'vitest'
import { materializeControlledThread } from './codex-controlled-thread-materialization'

describe('controlled Codex thread materialization', () => {
  it('materializes and rolls back the hidden turn', async () => {
    let listener: ((method: string, params: Record<string, unknown>) => void) | null = null
    const request = vi.fn(async (method: string) => {
      if (method === 'turn/start') {
        queueMicrotask(() =>
          listener?.('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1' } })
        )
        return { turn: { id: 'turn-1' } }
      }
      return { thread: { id: 'thread-1', turns: [] } }
    })
    const remove = vi.fn()

    await materializeControlledThread(
      {
        request: request as never,
        onNotification: (next) => {
          listener = next
          return remove
        }
      },
      'thread-1'
    )

    expect(request).toHaveBeenNthCalledWith(
      1,
      'turn/start',
      { threadId: 'thread-1', input: [] },
      30_000
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      'thread/rollback',
      { threadId: 'thread-1', numTurns: 1 },
      30_000
    )
    expect(remove).toHaveBeenCalledOnce()
  })

  it('accepts completion that arrives before turn/start resolves', async () => {
    let listener: ((method: string, params: Record<string, unknown>) => void) | null = null
    const request = vi.fn(async (method: string) => {
      if (method === 'turn/start') {
        listener?.('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1' } })
        return { turn: { id: 'turn-1' } }
      }
      return {}
    })

    await materializeControlledThread(
      {
        request: request as never,
        onNotification: (next) => {
          listener = next
          return () => undefined
        }
      },
      'thread-1'
    )

    expect(request).toHaveBeenCalledTimes(2)
  })
})
