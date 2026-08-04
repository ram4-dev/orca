import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  getControlledSocketRoot,
  startControlledCodexServer,
  type CodexControlledSessionLaunch
} from './codex-controlled-session-launch'

describe.skipIf(process.platform === 'win32')('controlled Codex socket root', () => {
  it('uses a validated environment root unless explicitly configured', () => {
    const prior = process.env.ORCA_CONTROLLED_CODEX_SOCKET_ROOT
    process.env.ORCA_CONTROLLED_CODEX_SOCKET_ROOT = join(tmpdir(), 'ocw-wake-env')
    try {
      expect(getControlledSocketRoot()).toBe(join(tmpdir(), 'ocw-wake-env'))
      expect(getControlledSocketRoot(join(tmpdir(), 'ocw-explicit'))).toBe(
        join(tmpdir(), 'ocw-explicit')
      )
      process.env.ORCA_CONTROLLED_CODEX_SOCKET_ROOT = 'relative/socket-root'
      expect(() => getControlledSocketRoot()).toThrow('absolute private directory')
    } finally {
      if (prior === undefined) {
        delete process.env.ORCA_CONTROLLED_CODEX_SOCKET_ROOT
      } else {
        process.env.ORCA_CONTROLLED_CODEX_SOCKET_ROOT = prior
      }
    }
  })

  it('rejects a socket root that is not already private', async () => {
    const unsafeRoot = mkdtempSync(join(tmpdir(), 'ocw-unsafe-'))
    try {
      chmodSync(unsafeRoot, 0o755)
      const spawnProcess = vi.fn() as unknown as typeof spawn
      await expect(
        startControlledCodexServer(input, join(unsafeRoot, 'controlled-codex.sock'), spawnProcess)
      ).rejects.toThrow('private owned directory')
      expect(spawnProcess).not.toHaveBeenCalled()
    } finally {
      rmSync(unsafeRoot, { recursive: true, force: true })
    }
  })
})

const input: CodexControlledSessionLaunch = {
  conversationId: 'conversation-1',
  threadId: 'thread-1',
  worktreeSelector: 'id:worktree-1',
  workspaceKind: 'worktree',
  hostKind: 'local',
  cwd: '/unused',
  codexHome: '/unused/codex-home',
  accountId: 'account-a'
}
