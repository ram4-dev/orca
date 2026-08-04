import { describe, expect, it } from 'vitest'
import { buildControlledVisibleTerminalOptions } from './codex-controlled-visible-terminal-options'

describe('controlled visible terminal options', () => {
  it('preserves the private remote command without standalone resume metadata', () => {
    const options = buildControlledVisibleTerminalOptions({
      worktreeSelector: 'id:worktree-1',
      command: 'codex resume --remote unix:///tmp/visible.sock --cd /workspace thread-1',
      cwd: '/workspace',
      env: { CODEX_HOME: '/codex-home' },
      viewMode: 'terminal',
      conversationId: 'conversation-1',
      threadId: 'thread-1'
    })

    expect(options.command).toContain('--remote unix:///tmp/visible.sock')
    expect(options.rendererBacked).toBe(false)
    expect(options.launchAgent).toBe('codex')
    expect(options).not.toHaveProperty('resumeProviderSession')
  })
})
