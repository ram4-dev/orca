const REMOTE_CONNECTION_FAILURE =
  /failed to connect to (?:the )?remote app server|remote app server.*(?:connection refused|disconnected|unavailable)/i

export type ControlledTerminalObservation<T> = {
  status: 'running' | 'exited' | 'unknown'
  output: string
  outputComplete: boolean
  value: T
}

export function assertControlledTerminalIdleResult(result: {
  satisfied: boolean
  status: 'running' | 'exited' | 'unknown'
  blockedReason?: string
}): void {
  if (result.blockedReason) {
    throw new Error(`controlled Codex visible terminal is blocked: ${result.blockedReason}`)
  }
  if (!result.satisfied || result.status !== 'running') {
    throw new Error('controlled Codex visible terminal did not become ready')
  }
}

export async function waitForControlledTerminalReadiness<T>(args: {
  waitForIdle: (signal: AbortSignal) => Promise<void>
  waitForRemoteTransport: (signal: AbortSignal) => Promise<void>
  assertRemoteTransportLive: () => void
  observe: () => Promise<ControlledTerminalObservation<T>>
  timeoutMs: number
  pollIntervalMs?: number
}): Promise<T> {
  const controller = new AbortController()
  let idleReady = false
  let transportReady = false
  let readinessError: unknown
  const idle = args.waitForIdle(controller.signal).then(
    () => (idleReady = true),
    (error: unknown) => (readinessError = error)
  )
  const transport = args.waitForRemoteTransport(controller.signal).then(
    () => (transportReady = true),
    (error: unknown) => (readinessError = error)
  )
  const deadline = Date.now() + args.timeoutMs
  try {
    while (Date.now() < deadline) {
      const observation = await args.observe()
      if (transportReady) {
        args.assertRemoteTransportLive()
      }
      assertControlledTerminalObservation(observation)
      if (readinessError) {
        throw readinessError
      }
      if (idleReady && transportReady) {
        return observation.value
      }
      await Promise.race([Promise.all([idle, transport]), delay(args.pollIntervalMs ?? 25)])
      if (readinessError) {
        throw readinessError
      }
    }
    throw new Error('controlled Codex visible terminal did not prove remote attachment')
  } finally {
    controller.abort()
  }
}

function assertControlledTerminalObservation<T>(
  observation: ControlledTerminalObservation<T>
): void {
  if (observation.status !== 'running') {
    throw new Error('controlled Codex visible terminal exited before remote attachment')
  }
  if (!observation.outputComplete) {
    throw new Error('controlled Codex visible terminal startup output was truncated')
  }
  if (REMOTE_CONNECTION_FAILURE.test(observation.output)) {
    throw new Error('controlled Codex visible terminal failed to connect to the remote app-server')
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    timer.unref?.()
  })
}
