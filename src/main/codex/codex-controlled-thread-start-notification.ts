type NotificationClient = {
  onNotification: (
    listener: (method: string, params: Record<string, unknown>) => void
  ) => () => void
}

export type ControlledThreadStartCapture = {
  waitForThreadId: () => Promise<string>
  assertExact: (threadId: string) => void
  stop: () => void
}

export function captureControlledThreadStart(
  client: NotificationClient,
  signal: AbortSignal,
  timeoutMs = 10_000
): ControlledThreadStartCapture {
  let threadId: string | null = null
  let failure: Error | null = null
  let stopped = false
  let resolveThread!: (threadId: string) => void
  let rejectThread!: (error: Error) => void
  const thread = new Promise<string>((resolve, reject) => {
    resolveThread = resolve
    rejectThread = reject
  })
  void thread.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const fail = (error: Error): void => {
    if (failure || stopped) {
      return
    }
    failure = error
    if (!threadId) {
      rejectThread(error)
    }
  }
  const unsubscribe = client.onNotification((method, params) => {
    if (method !== 'thread/started') {
      return
    }
    const started = params.thread
    const nextThreadId = isRecord(started) ? started.id : null
    if (typeof nextThreadId !== 'string' || !nextThreadId.trim()) {
      fail(new Error('controlled Codex thread/started notification was invalid'))
      return
    }
    if (threadId) {
      fail(new Error('controlled Codex visible TUI started multiple threads'))
      return
    }
    threadId = nextThreadId
    clearTimer()
    resolveThread(nextThreadId)
  })
  const abort = () => fail(new Error('controlled Codex thread start wait aborted'))
  signal.addEventListener('abort', abort, { once: true })
  const startTimer = (): void => {
    if (threadId || failure || stopped || timer) {
      return
    }
    timer = setTimeout(
      () => fail(new Error('controlled Codex visible TUI did not start a thread')),
      timeoutMs
    )
    timer.unref?.()
  }
  const stop = (): void => {
    if (stopped) {
      return
    }
    stopped = true
    clearTimer()
    signal.removeEventListener('abort', abort)
    unsubscribe()
  }
  if (signal.aborted) {
    abort()
  }
  return {
    waitForThreadId: () => {
      startTimer()
      return thread
    },
    assertExact: (expectedThreadId) => {
      if (failure) {
        throw failure
      }
      if (threadId !== expectedThreadId) {
        throw new Error('controlled Codex visible TUI thread identity changed')
      }
    },
    stop
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
