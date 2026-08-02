import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startControlledVisibleTransport } from './codex-controlled-visible-transport'

const roots: string[] = []
const servers: Server[] = []
const sockets: Socket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy()
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
    const upstream = createServer((socket) => socket.pipe(socket))
    servers.push(upstream)
    await listen(upstream, upstreamPath)
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath)
    const disconnected = vi.fn()
    transport.onDisconnect(disconnected)
    const visible = createConnection(visiblePath)
    sockets.push(visible)

    await transport.waitForLive()
    expect(transport.isLive()).toBe(true)
    visible.write('proof')
    await expect(readOnce(visible)).resolves.toBe('proof')

    visible.destroy()
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
          proxyServer = createServer(listener)
          return proxyServer
        }) as typeof createServer
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
    const upstream = createServer((socket) => socket.pipe(socket))
    servers.push(upstream)
    await listen(upstream, upstreamPath)
    let proxyServer!: Server
    const transport = await startControlledVisibleTransport(upstreamPath, visiblePath, {
      createSocketServer: ((listener: (socket: Socket) => void) => {
        proxyServer = createServer(listener)
        return proxyServer
      }) as typeof createServer
    })
    const visible = createConnection(visiblePath)
    sockets.push(visible)
    await transport.waitForLive()

    expect(() => proxyServer.emit('error', new Error('proxy failed'))).not.toThrow()

    await vi.waitFor(() => expect(transport.isLive()).toBe(false))
    await vi.waitFor(() => expect(existsSync(visiblePath)).toBe(false))
    expect(proxyServer.listenerCount('error')).toBe(0)
    await expect(transport.waitForLive()).rejects.toThrow('proxy failed')
  })
})

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve) => server.listen(path, resolve))
}

function readOnce(socket: Socket): Promise<string> {
  return new Promise((resolve) => socket.once('data', (data) => resolve(data.toString())))
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
