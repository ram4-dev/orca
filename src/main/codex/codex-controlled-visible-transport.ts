import { chmodSync, existsSync, lstatSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { observeControlledWebSocketUpgrade } from './codex-controlled-websocket-upgrade'

const TRANSPORT_READY_TIMEOUT_MS = 10_000

export type ControlledVisibleTransport = {
  socketPath: string
  isLive: () => boolean
  assertLive: () => void
  waitForLive: (signal?: AbortSignal) => Promise<void>
  onDisconnect: (listener: () => void) => void
  stop: () => Promise<void>
}

type VisibleTransportStartOptions = {
  hardenSocket?: typeof chmodSync
  createSocketServer?: typeof createServer
}

export async function startControlledVisibleTransport(
  upstreamSocketPath: string,
  socketPath: string,
  options: VisibleTransportStartOptions = {}
): Promise<ControlledVisibleTransport> {
  if (existsSync(socketPath)) {
    throw new Error('controlled Codex visible socket path is already owned')
  }
  const state = createTransportState(socketPath)
  state.upstreamSocketPath = upstreamSocketPath
  const server = (options.createSocketServer ?? createServer)((downstream) =>
    acceptVisibleConnection(state, downstream)
  )
  state.server = server
  await listen(server, socketPath)
  const onServerError = (error: Error) => failTransport(state, error)
  state.serverErrorListener = onServerError
  server.on('error', onServerError)
  try {
    const stat = lstatSync(socketPath)
    state.socketIdentity = { dev: stat.dev, ino: stat.ino }
    ;(options.hardenSocket ?? chmodSync)(socketPath, 0o600)
    return createTransport(state)
  } catch (error) {
    server.off('error', onServerError)
    await closeServer(server)
    removeCreatedSocket(state)
    throw error
  }
}

type TransportState = {
  server: Server | null
  socketPath: string
  upstreamSocketPath: string
  socketIdentity: { dev: number; ino: number } | null
  downstream: Socket | null
  upstream: Socket | null
  live: boolean
  accepted: boolean
  stopped: boolean
  failure: Error | null
  serverErrorListener: ((error: Error) => void) | null
  waiters: Set<{ resolve: () => void; reject: (error: Error) => void }>
  disconnectListeners: Set<() => void>
}

function createTransportState(socketPath: string): TransportState {
  return {
    server: null,
    socketPath,
    upstreamSocketPath: '',
    socketIdentity: null,
    downstream: null,
    upstream: null,
    live: false,
    accepted: false,
    stopped: false,
    failure: null,
    serverErrorListener: null,
    waiters: new Set(),
    disconnectListeners: new Set()
  }
}

function acceptVisibleConnection(state: TransportState, downstream: Socket): void {
  if (state.stopped || state.accepted) {
    downstream.destroy()
    return
  }
  state.accepted = true
  state.downstream = downstream
  const upstream = createConnection(state.upstreamSocketPath)
  state.upstream = upstream
  let stopObservingUpgrade: () => void = () => undefined
  const disconnect = () => {
    stopObservingUpgrade()
    disconnectTransport(state, downstream, upstream)
  }
  stopObservingUpgrade = observeControlledWebSocketUpgrade(
    downstream,
    upstream,
    () => markTransportLive(state, downstream, upstream),
    (error) => {
      stopObservingUpgrade()
      failTransport(state, error, downstream, upstream)
    }
  )
  downstream.once('close', disconnect)
  downstream.once('error', disconnect)
  upstream.once('close', disconnect)
  upstream.once('error', disconnect)
  downstream.pipe(upstream).pipe(downstream)
  upstream.once('connect', () => {
    if (
      state.stopped ||
      state.downstream !== downstream ||
      state.upstream !== upstream ||
      downstream.destroyed
    ) {
      disconnect()
    }
  })
}

function markTransportLive(state: TransportState, downstream: Socket, upstream: Socket): void {
  if (
    state.stopped ||
    state.downstream !== downstream ||
    state.upstream !== upstream ||
    downstream.destroyed ||
    upstream.destroyed
  ) {
    disconnectTransport(state, downstream, upstream)
    return
  }
  state.live = true
  for (const waiter of state.waiters) {
    waiter.resolve()
  }
  state.waiters.clear()
}

function disconnectTransport(state: TransportState, downstream?: Socket, upstream?: Socket): void {
  if (
    (downstream !== undefined && state.downstream !== downstream) ||
    (upstream !== undefined && state.upstream !== upstream)
  ) {
    return
  }
  const wasLive = state.live
  state.live = false
  state.downstream?.destroy()
  state.upstream?.destroy()
  state.downstream = null
  state.upstream = null
  if (!wasLive && state.accepted && !state.stopped) {
    const error =
      state.failure ?? new Error('controlled Codex visible remote transport disconnected')
    state.failure = error
    for (const waiter of state.waiters) {
      waiter.reject(error)
    }
    state.waiters.clear()
  }
  if (wasLive) {
    for (const listener of state.disconnectListeners) {
      listener()
    }
  }
}

function failTransport(
  state: TransportState,
  error: Error,
  downstream?: Socket,
  upstream?: Socket
): void {
  if (
    (downstream !== undefined && state.downstream !== downstream) ||
    (upstream !== undefined && state.upstream !== upstream)
  ) {
    return
  }
  state.failure = error
  disconnectTransport(state, downstream, upstream)
  for (const waiter of state.waiters) {
    waiter.reject(error)
  }
  state.waiters.clear()
  void closeTransportServer(state).catch(() => removeCreatedSocket(state))
}

function createTransport(state: TransportState): ControlledVisibleTransport {
  return {
    socketPath: state.socketPath,
    isLive: () => state.live,
    assertLive: () => {
      if (state.failure) {
        throw state.failure
      }
      if (!state.live) {
        throw new Error('controlled Codex visible remote transport is disconnected')
      }
    },
    waitForLive: (signal) => waitForLive(state, signal),
    onDisconnect: (listener) => state.disconnectListeners.add(listener),
    stop: () => stopTransport(state)
  }
}

function waitForLive(state: TransportState, signal?: AbortSignal): Promise<void> {
  if (state.live) {
    return Promise.resolve()
  }
  if (state.failure) {
    return Promise.reject(state.failure)
  }
  if (state.stopped) {
    return Promise.reject(new Error('controlled Codex visible transport stopped'))
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve: finish(resolve), reject: finish(reject) }
    const timeout = setTimeout(
      () => waiter.reject(new Error('controlled Codex visible remote transport did not connect')),
      TRANSPORT_READY_TIMEOUT_MS
    )
    timeout.unref?.()
    const abort = () => waiter.reject(new Error('controlled Codex visible transport wait aborted'))
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      state.waiters.delete(waiter)
    }
    function finish<T extends (...args: never[]) => void>(callback: T): T {
      return ((...args: never[]) => {
        cleanup()
        callback(...args)
      }) as T
    }
    state.waiters.add(waiter)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
    }
  })
}

async function stopTransport(state: TransportState): Promise<void> {
  if (state.stopped) {
    return
  }
  state.stopped = true
  disconnectTransport(state)
  const error = new Error('controlled Codex visible transport stopped')
  for (const waiter of state.waiters) {
    waiter.reject(error)
  }
  state.waiters.clear()
  try {
    await closeTransportServer(state)
  } finally {
    removeOwnedSocket(state)
  }
}

async function closeTransportServer(state: TransportState): Promise<void> {
  if (!state.server) {
    return
  }
  const server = state.server
  state.server = null
  if (state.serverErrorListener) {
    server.off('error', state.serverErrorListener)
    state.serverErrorListener = null
  }
  await closeServer(server)
  removeOwnedSocket(state)
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

function removeCreatedSocket(state: TransportState): void {
  if (state.socketIdentity) {
    removeOwnedSocket(state)
  } else {
    rmSync(state.socketPath, { force: true })
  }
}

function removeOwnedSocket(state: TransportState): void {
  if (!state.socketIdentity || !existsSync(state.socketPath)) {
    return
  }
  const stat = lstatSync(state.socketPath)
  if (stat.dev === state.socketIdentity.dev && stat.ino === state.socketIdentity.ino) {
    rmSync(state.socketPath)
  }
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}
