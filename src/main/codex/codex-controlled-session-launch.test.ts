import { describe, expect, it } from 'vitest'
import { buildControlledThreadStartParams } from './codex-controlled-session-launch'

describe('controlled Codex session launch', () => {
  it('attaches host-provided dynamic tools when the controller creates a thread', () => {
    const dynamicTools = [{ type: 'function', name: 'orca_launch_worker' }]

    expect(buildControlledThreadStartParams(launchFixture, dynamicTools)).toMatchObject({
      dynamicTools,
      developerInstructions: expect.stringContaining('orca_launch_worker')
    })
  })
})

const launchFixture = {
  conversationId: 'conversation-shape',
  threadId: 'pending',
  worktreeSelector: 'id:worktree-shape',
  workspaceKind: 'worktree' as const,
  hostKind: 'local' as const,
  cwd: '/workspace',
  codexHome: '/codex-home',
  accountId: 'account-shape'
}
