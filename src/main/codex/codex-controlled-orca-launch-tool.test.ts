import { describe, expect, it, vi } from 'vitest'
import {
  CONTROLLED_ORCA_DYNAMIC_TOOLS,
  controlledOrcaCliEnv,
  handleControlledOrcaDynamicToolCall
} from './codex-controlled-orca-launch-tool'

describe('controlled Orca launch tool', () => {
  it('creates a task and starts a supervised worker without waiting for completion', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { run: null } })
      .mockResolvedValueOnce({ ok: true, result: { run: { id: 'run-1' } } })
      .mockResolvedValueOnce({ ok: true, result: { task: { id: 'task-1' } } })
      .mockResolvedValueOnce({
        ok: true,
        result: { taskId: 'task-1', dispatchId: 'ctx-1', state: 'ready' }
      })

    const response = await handleControlledOrcaDynamicToolCall({
      tool: 'orca_launch_worker',
      arguments: {
        prompt: 'Write a README with 50 lines about goblins.',
        title: 'Goblins README',
        agent: 'codex'
      },
      launch: launchFixture,
      terminal: terminalFixture,
      cliCommand: '/Applications/Orca Wake Dev.app/Contents/Resources/bin/orca-wake',
      runCommand
    })

    expect(runCommand).toHaveBeenCalledTimes(4)
    expect(runCommand.mock.calls[0]?.[2]).toEqual(
      expect.arrayContaining(['run-current', '--from', 'term-coordinator'])
    )
    expect(runCommand.mock.calls[1]?.[2]).toEqual(
      expect.arrayContaining(['run-create', '--from', 'term-coordinator'])
    )
    expect(runCommand.mock.calls[2]?.[2]).toEqual(
      expect.arrayContaining([
        'task-create',
        '--spec',
        'Write a README with 50 lines about goblins.',
        '--run',
        'run-1',
        '--from',
        'term-coordinator'
      ])
    )
    expect(runCommand.mock.calls[3]?.[2]).toEqual(
      expect.arrayContaining([
        'worker-start',
        '--task',
        'task-1',
        '--worktree',
        'current',
        '--agent',
        'codex',
        '--from',
        'term-coordinator'
      ])
    )
    expect(response).toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText' }]
    })
    expect(response.contentItems[0]?.text).toContain('"dispatchId":"ctx-1"')
    expect(response.contentItems[0]?.text).toContain('"runId":"run-1"')
  })

  it('reuses the coordinator current run and preserves its wake binding', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { run: { id: 'run-current' } } })
      .mockResolvedValueOnce({ ok: true, result: { task: { id: 'task-2' } } })
      .mockResolvedValueOnce({ ok: true, result: { state: 'ready', dispatchId: 'ctx-2' } })

    await handleControlledOrcaDynamicToolCall({
      tool: 'orca_launch_worker',
      arguments: { prompt: 'Do work' },
      launch: launchFixture,
      terminal: terminalFixture,
      cliCommand: 'orca-wake',
      runCommand
    })

    expect(runCommand).toHaveBeenCalledTimes(3)
    expect(runCommand.mock.calls.flatMap((call) => call[2])).not.toContain('run-create')
    expect(runCommand.mock.calls[1]?.[2]).toEqual(expect.arrayContaining(['--run', 'run-current']))
  })

  it('exposes only the bounded asynchronous worker launcher', () => {
    expect(CONTROLLED_ORCA_DYNAMIC_TOOLS).toHaveLength(1)
    expect(CONTROLLED_ORCA_DYNAMIC_TOOLS[0]).toMatchObject({
      type: 'function',
      name: 'orca_launch_worker'
    })
  })

  it('does not force the packaged Orca CLI to run as a Node entrypoint', () => {
    expect(
      controlledOrcaCliEnv({
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_PACKAGED_COMMAND_NAME: 'orca-wake'
      })
    ).toEqual({ ORCA_PACKAGED_COMMAND_NAME: 'orca-wake' })
  })

  it('rejects unsupported agents before creating Orca resources', async () => {
    const runCommand = vi.fn()
    await expect(
      handleControlledOrcaDynamicToolCall({
        tool: 'orca_launch_worker',
        arguments: { prompt: 'Do work', agent: 'shell' },
        launch: launchFixture,
        terminal: terminalFixture,
        cliCommand: 'orca-wake',
        runCommand
      })
    ).rejects.toThrow('unsupported agent')
    expect(runCommand).not.toHaveBeenCalled()
  })
})

const launchFixture = {
  conversationId: 'conversation-1',
  threadId: 'thread-1',
  worktreeSelector: 'id:worktree-1',
  workspaceKind: 'worktree' as const,
  hostKind: 'local' as const,
  cwd: '/workspace',
  codexHome: '/codex-home',
  accountId: 'account-1'
}

const terminalFixture = {
  conversationId: 'conversation-1',
  threadId: 'thread-1',
  terminalHandle: 'term-coordinator',
  terminalPtyId: 'pty-1',
  terminalTabId: 'tab-1',
  terminalPaneKey: 'tab-1:pane-1',
  worktreeId: 'worktree-1'
}
