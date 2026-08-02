import { describe, expect, it, vi } from 'vitest'
import { ensureControlledTerminalPtyStopped } from './codex-controlled-terminal-pty-stop'

describe('ensureControlledTerminalPtyStopped', () => {
  it('accepts an exact PTY that already exited', async () => {
    const controller = {
      listProcesses: vi.fn(async () => []),
      stopAndWait: vi.fn(async () => true)
    }

    await expect(ensureControlledTerminalPtyStopped(controller, 'pty-1')).resolves.toBeUndefined()
    expect(controller.stopAndWait).not.toHaveBeenCalled()
  })

  it('force-stops and post-verifies the exact PTY', async () => {
    let running = true
    const controller = {
      listProcesses: vi.fn(async () => (running ? [{ id: 'pty-1' }] : [])),
      stopAndWait: vi.fn(async () => {
        running = false
        return true
      })
    }

    await ensureControlledTerminalPtyStopped(controller, 'pty-1')

    expect(controller.stopAndWait).toHaveBeenCalledWith(
      'pty-1',
      expect.objectContaining({ deadlineMs: expect.any(Number) })
    )
    expect(controller.listProcesses).toHaveBeenCalledTimes(2)
  })

  it('fails when the exact PTY remains live after force stop', async () => {
    const controller = {
      listProcesses: vi.fn(async () => [{ id: 'pty-1' }]),
      stopAndWait: vi.fn(async () => false)
    }

    await expect(ensureControlledTerminalPtyStopped(controller, 'pty-1')).rejects.toThrow(
      'remains live after forced stop'
    )
  })
})
