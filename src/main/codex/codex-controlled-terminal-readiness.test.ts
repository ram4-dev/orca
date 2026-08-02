import { describe, expect, it, vi } from 'vitest'
import { waitForControlledTerminalReadiness } from './codex-controlled-terminal-readiness'

describe('waitForControlledTerminalReadiness', () => {
  const remoteTransport = {
    waitForRemoteTransport: async () => undefined,
    assertRemoteTransportLive: () => undefined
  }

  it('rejects a local prompt false positive after remote connection failure', async () => {
    const waitForIdle = vi.fn(async () => undefined)

    await expect(
      waitForControlledTerminalReadiness({
        ...remoteTransport,
        waitForIdle,
        observe: async () => ({
          status: 'running',
          output: 'Error: failed to connect to remote app server\n> ',
          outputComplete: true,
          value: 'terminal-1'
        }),
        timeoutMs: 100
      })
    ).rejects.toThrow('failed to connect')
  })

  it('waits for the remote transport after generic TUI readiness', async () => {
    let observations = 0
    let connect!: () => void
    const result = await waitForControlledTerminalReadiness({
      waitForIdle: async () => undefined,
      waitForRemoteTransport: () => new Promise((resolve) => (connect = resolve)),
      assertRemoteTransportLive: () => undefined,
      observe: async () => {
        observations += 1
        if (observations === 2) {
          connect()
        }
        return {
          status: 'running' as const,
          output: 'Codex',
          outputComplete: true,
          value: `terminal-${observations}`
        }
      },
      timeoutMs: 100,
      pollIntervalMs: 1
    })

    expect(result).toMatch(/^terminal-/)
    expect(observations).toBeGreaterThanOrEqual(2)
  })

  it('fails immediately when the controller or visible terminal exits', async () => {
    await expect(
      waitForControlledTerminalReadiness({
        ...remoteTransport,
        waitForIdle: async () => new Promise<void>(() => {}),
        observe: async () => {
          throw new Error('controlled Codex app-server exited before remote attachment')
        },
        timeoutMs: 100
      })
    ).rejects.toThrow('app-server exited')

    await expect(
      waitForControlledTerminalReadiness({
        ...remoteTransport,
        waitForIdle: async () => new Promise<void>(() => {}),
        observe: async () => ({
          status: 'exited',
          output: '',
          outputComplete: true,
          value: 'terminal-1'
        }),
        timeoutMs: 100
      })
    ).rejects.toThrow('terminal exited')
  })

  it('rejects generic readiness when the remote transport never connects', async () => {
    await expect(
      waitForControlledTerminalReadiness({
        waitForIdle: async () => undefined,
        waitForRemoteTransport: async () => {
          throw new Error('remote lease failed')
        },
        assertRemoteTransportLive: () => undefined,
        observe: async () => ({
          status: 'running',
          output: 'Codex',
          outputComplete: true,
          value: 'local-fallback'
        }),
        timeoutMs: 100
      })
    ).rejects.toThrow('remote lease failed')
  })

  it('rejects a lease that disconnects after readiness but before binding', async () => {
    await expect(
      waitForControlledTerminalReadiness({
        waitForIdle: async () => undefined,
        waitForRemoteTransport: async () => undefined,
        assertRemoteTransportLive: () => {
          throw new Error('visible remote transport is disconnected')
        },
        observe: async () => ({
          status: 'running',
          output: 'Codex',
          outputComplete: true,
          value: 'terminal-1'
        }),
        timeoutMs: 100
      })
    ).rejects.toThrow('visible remote transport is disconnected')
  })
})
