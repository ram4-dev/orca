import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import {
  createConnection,
  createServer as createSocketServer,
  type Server,
  type Socket
} from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import {
  startControlledVisibleTransport,
  type ControlledVisibleTransport
} from './codex-controlled-visible-transport'

const roots: string[] = []
const servers: Server[] = []
const sockets: Socket[] = []
const webSockets: WebSocket[] = []
const webSocketServers: WebSocketServer[] = []
const transports: ControlledVisibleTransport[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.stop()))
  for (const socket of webSockets.splice(0)) {
    socket.terminate()
  }
  for (const socket of sockets.splice(0)) {
    socket.destroy()
  }
  for (const server of webSocketServers.splice(0)) {
    server.close()
  }
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('controlled visible transport', () => {
  it('proves and observes the one exact proxied connection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-'))
    roots.push(root)
    const upstreamPath = join(root, 'upstream.sock')
    const visiblePath = join(root, 'visible.sock')
    await startWebSocketEchoServer(upstreamPath)
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath)
    transports.push(transport)
    const disconnected = vi.fn()
    transport.onDisconnect(disconnected)
    const visible = connectWebSocket(visiblePath)
    webSockets.push(visible)

    await transport.waitForLive()
    await waitForWebSocketOpen(visible)
    expect(transport.isLive()).toBe(true)
    visible.send('proof')
    await expect(readWebSocketOnce(visible)).resolves.toBe('proof')

    visible.terminate()
    await vi.waitFor(() => expect(transport.isLive()).toBe(false))
    expect(disconnected).toHaveBeenCalledOnce()
    const replacement = createConnection(visiblePath)
    sockets.push(replacement)
    await expectClosed(replacement)
    expect(transport.isLive()).toBe(false)
    await transport.stop()
  })

  it('removes its listener and socket when post-listen hardening fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-hardening-'))
    roots.push(root)
    const visiblePath = join(root, 'visible.sock')
    let proxyServer!: Server

    await expect(
      startControlledVisibleTransport('/unused-upstream.sock', visiblePath, {
        hardenSocket: () => {
          throw new Error('hardening failed')
        },
        createSocketServer: ((listener: (socket: Socket) => void) => {
          proxyServer = createSocketServer(listener)
          return proxyServer
        }) as typeof createSocketServer
      })
    ).rejects.toThrow('hardening failed')

    expect(proxyServer.listenerCount('error')).toBe(0)
    expect(existsSync(visiblePath)).toBe(false)
  })

  it('fails closed and cleans up after a post-listen server error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-error-'))
    roots.push(root)
    const upstreamPath = join(root, 'upstream.sock')
    const visiblePath = join(root, 'visible.sock')
    await startWebSocketEchoServer(upstreamPath)
    let proxyServer!: Server
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath, {
      createSocketServer: ((listener: (socket: Socket) => void) => {
        proxyServer = createSocketServer(listener)
        return proxyServer
      }) as typeof createSocketServer
    })
    transports.push(transport)
    const visible = connectWebSocket(visiblePath)
    webSockets.push(visible)
    await transport.waitForLive()

    expect(() => proxyServer.emit('error', new Error('proxy failed'))).not.toThrow()

    await vi.waitFor(() => expect(transport.isLive()).toBe(false))
    await vi.waitFor(() => expect(existsSync(visiblePath)).toBe(false))
    expect(proxyServer.listenerCount('error')).toBe(0)
    await expect(transport.waitForLive()).rejects.toThrow('proxy failed')
  })

  it('fails a consumed lease that disconnects before WebSocket attachment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-upgrade-'))
    roots.push(root)
    const upstreamPath = join(root, 'upstream.sock')
    const visiblePath = join(root, 'visible.sock')
    const upstream = createHttpServer()
    const rejectingWebSocketServer = new WebSocketServer({
      server: upstream,
      perMessageDeflate: false,
      verifyClient: () => false
    })
    servers.push(upstream)
    webSocketServers.push(rejectingWebSocketServer)
    await listen(upstream, upstreamPath)
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath)
    transports.push(transport)
    const visible = connectWebSocket(visiblePath)
    webSockets.push(visible)

    await expect(transport.waitForLive()).rejects.toThrow('WebSocket upgrade was rejected')
    expect(transport.isLive()).toBe(false)
    await vi.waitFor(() => expect(existsSync(visiblePath)).toBe(false))
    await transport.stop()
    expect(existsSync(visiblePath)).toBe(false)
  })

  it('preserves a WebSocket frame sent with the accepted upgrade response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-early-frame-'))
    roots.push(root)
    const upstreamPath = join(root, 'upstream.sock')
    const visiblePath = join(root, 'visible.sock')
    const response = Buffer.concat([
      Buffer.from(validUpgradeResponse(), 'latin1'),
      Buffer.from([0x81, 0x02, 0x6f, 0x6b])
    ])
    await startRawUpgradeServer(upstreamPath, () => response)
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath)
    transports.push(transport)
    const visible = createConnection(visiblePath)
    sockets.push(visible)
    const received = readSocketBytes(visible, response.length)

    visible.write(rawWebSocketRequest())

    await transport.waitForLive()
    await expect(received).resolves.toStrictEqual(response)
  })

  it('rejects one consumed connection that closes before the upstream upgrade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ocw-visible-pre-upstream-close-'))
    roots.push(root)
    const upstreamPath = join(root, 'upstream.sock')
    const visiblePath = join(root, 'visible.sock')
    let upstreamConnections = 0
    const upstream = createSocketServer(() => {
      upstreamConnections += 1
    })
    servers.push(upstream)
    await listen(upstream, upstreamPath)
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath)
    transports.push(transport)
    const visible = createConnection(visiblePath)
    sockets.push(visible)
    await new Promise<void>((resolve) => visible.once('connect', resolve))

    visible.destroy()

    await expect(transport.waitForLive()).rejects.toThrow('remote transport disconnected')
    await vi.waitFor(() => expect(upstreamConnections).toBe(1))
    const replacement = createConnection(visiblePath)
    sockets.push(replacement)
    await expectClosed(replacement)
  })
})

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve) => server.listen(path, resolve))
}

async function startWebSocketEchoServer(path: string): Promise<void> {
  const server = createHttpServer()
  const webSocketServer = new WebSocketServer({ server, perMessageDeflate: false })
  webSocketServer.on('connection', (socket) => {
    webSockets.push(socket)
    socket.on('message', (message) => socket.send(message))
  })
  servers.push(server)
  webSocketServers.push(webSocketServer)
  await listen(server, path)
}

function connectWebSocket(path: string): WebSocket {
  const socket = new WebSocket('ws://localhost/rpc', {
    perMessageDeflate: false,
    createConnection: () => createConnection(path)
  })
  socket.on('error', () => undefined)
  return socket
}

function readWebSocketOnce(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => socket.once('message', (data) => resolve(data.toString())))
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function expectClosed(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('close', resolve)
    socket.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve()
      } else {
        reject(error)
      }
    })
  })
}

function startRawUpgradeServer(
  path: string,
  response: (request: string) => string | Buffer
): Promise<void> {
  const server = createSocketServer((socket) => {
    sockets.push(socket)
    let request = ''
    socket.on('data', (data) => {
      request += data.toString('latin1')
      if (request.includes('\r\n\r\n')) {
        socket.write(response(request))
      }
    })
  })
  servers.push(server)
  return listen(server, path)
}

function rawWebSocketRequest(): string {
  return [
    'GET /rpc HTTP/1.1',
    'Host: localhost',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '',
    ''
  ].join('\r\n')
}

function validUpgradeResponse(): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
    '',
    ''
  ].join('\r\n')
}

function readSocketBytes(socket: Socket, expectedLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let receivedLength = 0
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    const onData = (data: Buffer) => {
      chunks.push(data)
      receivedLength += data.length
      if (receivedLength >= expectedLength) {
        cleanup()
        resolve(Buffer.concat(chunks))
      }
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}
