import { describe, expect, it, vi } from 'vitest'
import { captureControlledThreadStart } from './codex-controlled-thread-start-notification'

describe('captureControlledThreadStart', () => {
  it('captures the exact visible TUI thread and releases its listener', async () => {
    const fixture = notificationFixture()
    const controller = new AbortController()
    const capture = captureControlledThreadStart(fixture.client, controller.signal)

    fixture.emit('other/event', {})
    fixture.emit('thread/started', { thread: { id: 'thread-visible' } })

    await expect(capture.waitForThreadId()).resolves.toBe('thread-visible')
    capture.assertExact('thread-visible')
    capture.stop()
    expect(fixture.unsubscribe).toHaveBeenCalledOnce()
  })

  it('fails closed on an invalid thread notification', async () => {
    const fixture = notificationFixture()
    const capture = captureControlledThreadStart(fixture.client, new AbortController().signal)

    fixture.emit('thread/started', { thread: {} })

    await expect(capture.waitForThreadId()).rejects.toThrow(
      'thread/started notification was invalid'
    )
    capture.stop()
  })

  it('rejects a second thread identity observed during launch', async () => {
    const fixture = notificationFixture()
    const capture = captureControlledThreadStart(fixture.client, new AbortController().signal)

    fixture.emit('thread/started', { thread: { id: 'thread-first' } })
    await expect(capture.waitForThreadId()).resolves.toBe('thread-first')
    fixture.emit('thread/started', { thread: { id: 'thread-second' } })

    expect(() => capture.assertExact('thread-first')).toThrow('started multiple threads')
    capture.stop()
  })

  it('does not time out after capturing the first thread', async () => {
    vi.useFakeTimers()
    try {
      const fixture = notificationFixture()
      const capture = captureControlledThreadStart(fixture.client, new AbortController().signal, 10)

      fixture.emit('thread/started', { thread: { id: 'thread-visible' } })
      await expect(capture.waitForThreadId()).resolves.toBe('thread-visible')
      await vi.advanceTimersByTimeAsync(20)

      expect(() => capture.assertExact('thread-visible')).not.toThrow()
      capture.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts its bounded deadline only when terminal readiness begins waiting', async () => {
    vi.useFakeTimers()
    try {
      const fixture = notificationFixture()
      const capture = captureControlledThreadStart(
        fixture.client,
        new AbortController().signal,
        10_000
      )

      await vi.advanceTimersByTimeAsync(25_000)
      const threadStarted = capture.waitForThreadId()
      await vi.advanceTimersByTimeAsync(9_999)
      fixture.emit('thread/started', { thread: { id: 'thread-at-boundary' } })

      await expect(threadStarted).resolves.toBe('thread-at-boundary')
      capture.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still fails closed when no thread starts after readiness', async () => {
    vi.useFakeTimers()
    try {
      const fixture = notificationFixture()
      const capture = captureControlledThreadStart(
        fixture.client,
        new AbortController().signal,
        10_000
      )
      const threadStarted = capture.waitForThreadId()

      await vi.advanceTimersByTimeAsync(10_000)

      await expect(threadStarted).rejects.toThrow('visible TUI did not start a thread')
      capture.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

function notificationFixture(): {
  client: { onNotification: (next: NotificationListener) => () => void }
  emit: NotificationListener
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: NotificationListener | null = null
  const unsubscribe = vi.fn()
  return {
    client: {
      onNotification: (next) => {
        listener = next
        return unsubscribe
      }
    },
    emit: (method, params) => {
      if (!listener) {
        throw new Error('notification listener was not registered')
      }
      listener(method, params)
    },
    unsubscribe
  }
}

type NotificationListener = (method: string, params: Record<string, unknown>) => void
