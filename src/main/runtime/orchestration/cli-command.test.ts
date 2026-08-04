import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveLocalOrchestrationCliCommand,
  resolveTerminalOrchestrationCliCommand,
  resolveUnidentifiedTerminalOrchestrationCliCommand
} from './cli-command'

describe('resolveTerminalOrchestrationCliCommand', () => {
  it('uses orca-ide for a pane recorded as WSL', () => {
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: null,
        isWsl: true,
        worktreeId: 'repo::C:\\repo'
      })
    ).toBe('orca-ide')
  })

  it('uses project runtime and WSL paths when restored pane metadata is unavailable', () => {
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: null,
        isWsl: null,
        worktreeId: 'repo::C:\\repo',
        projectRuntime: {
          status: 'resolved',
          runtime: {
            kind: 'wsl',
            hostPlatform: 'wsl',
            projectId: 'project',
            distro: 'Ubuntu',
            reason: 'project-override',
            cacheKey: 'project:wsl:Ubuntu'
          }
        }
      })
    ).toBe('orca-ide')
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: null,
        isWsl: null,
        worktreeId: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\alice\\repo'
      })
    ).toBe('orca-ide')
  })

  it('preserves native and SSH bare-orca commands', () => {
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: null,
        isWsl: false,
        worktreeId: 'repo::/home/alice/repo'
      })
    ).toBe('orca')
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: 'ssh-1',
        isWsl: null,
        worktreeId: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\alice\\repo'
      })
    ).toBe('orca')
  })

  it('uses the branded command only for local native panes', () => {
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: null,
        isWsl: false,
        worktreeId: 'repo::/workspace',
        localCommand: 'orca-wake'
      })
    ).toBe('orca-wake')
    expect(
      resolveTerminalOrchestrationCliCommand({
        connectionId: 'ssh-1',
        isWsl: false,
        worktreeId: 'repo::/workspace',
        localCommand: 'orca-wake'
      })
    ).toBe('orca')
  })

  it('requires an executable absolute branded launcher', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-wake-cli-'))
    const executable = join(root, 'orca-wake')
    try {
      writeFileSync(executable, '#!/bin/sh\n')
      chmodSync(executable, 0o700)
      expect(
        resolveLocalOrchestrationCliCommand({
          ORCA_PACKAGED_COMMAND_NAME: 'orca-wake',
          ORCA_PACKAGED_CLI_BIN_PATH: executable
        })
      ).toBe(executable)
      expect(() =>
        resolveLocalOrchestrationCliCommand({
          ORCA_PACKAGED_COMMAND_NAME: 'orca-wake',
          ORCA_PACKAGED_CLI_BIN_PATH: join(root, 'missing', 'orca-wake')
        })
      ).toThrow('missing or not executable')
      expect(() =>
        resolveLocalOrchestrationCliCommand({
          ORCA_PACKAGED_COMMAND_NAME: 'orca-wake',
          ORCA_PACKAGED_CLI_BIN_PATH: process.execPath
        })
      ).toThrow('path is unavailable')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed when a Wake terminal execution host cannot be resolved', () => {
    expect(() =>
      resolveUnidentifiedTerminalOrchestrationCliCommand({
        ORCA_PACKAGED_COMMAND_NAME: 'orca-wake'
      })
    ).toThrow('terminal CLI identity is unavailable')
    expect(resolveUnidentifiedTerminalOrchestrationCliCommand({})).toBe('orca')
  })
})
