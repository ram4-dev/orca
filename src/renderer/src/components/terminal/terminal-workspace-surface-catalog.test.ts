import { describe, expect, it } from 'vitest'
import { collectTerminalWorkspaceSurfaces } from './terminal-workspace-surface-catalog'

describe('collectTerminalWorkspaceSurfaces', () => {
  it('keeps detected-only worktrees renderable while active or owning terminal tabs', () => {
    const detectedWorktreesByRepo = {
      repo: {
        worktrees: [
          { id: 'visible', path: '/visible' },
          { id: 'active-detected', path: '/active-detected' },
          { id: 'live-detected', path: '/live-detected' },
          { id: 'hidden-idle', path: '/hidden-idle' }
        ]
      }
    }

    expect(
      collectTerminalWorkspaceSurfaces({
        visibleWorktrees: [{ id: 'visible', path: '/visible' }],
        folderWorkspaces: [{ id: 'folder', folderPath: '/folder' }],
        detectedWorktreesByRepo,
        activeWorktreeId: 'active-detected',
        terminalTabsByWorktree: { 'live-detected': ['tab-1'] }
      })
    ).toEqual([
      { id: 'visible', path: '/visible' },
      { id: 'folder:folder', path: '/folder' },
      { id: 'active-detected', path: '/active-detected' },
      { id: 'live-detected', path: '/live-detected' }
    ])
  })

  it('mounts a requested canonical worktree before the detected catalog sees it', () => {
    const freshWorktreeId = 'repo::/worktrees/fresh'

    expect(
      collectTerminalWorkspaceSurfaces({
        visibleWorktrees: [{ id: 'restored', path: '/restored' }],
        folderWorkspaces: [],
        detectedWorktreesByRepo: {},
        activeWorktreeId: freshWorktreeId,
        terminalTabsByWorktree: { [freshWorktreeId]: ['requested-tab'] }
      })
    ).toEqual([
      { id: 'restored', path: '/restored' },
      { id: freshWorktreeId, path: '/worktrees/fresh' }
    ])
  })
})
