import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree-id'

export type TerminalWorkspaceSurface = {
  id: string
  path: string
}

type FolderSurface = {
  id: string
  folderPath: string
}

type DetectedSurfaceCatalog = Readonly<
  Record<string, { worktrees: readonly TerminalWorkspaceSurface[] } | undefined>
>

export function collectTerminalWorkspaceSurfaces(input: {
  visibleWorktrees: readonly TerminalWorkspaceSurface[]
  folderWorkspaces: readonly FolderSurface[]
  detectedWorktreesByRepo: DetectedSurfaceCatalog
  activeWorktreeId: string | null
  terminalTabsByWorktree: Readonly<Record<string, readonly unknown[] | undefined>>
}): TerminalWorkspaceSurface[] {
  const surfaces = [
    ...input.visibleWorktrees,
    ...input.folderWorkspaces.map((workspace) => ({
      id: folderWorkspaceKey(workspace.id),
      path: workspace.folderPath
    }))
  ]
  const includedIds = new Set(surfaces.map((surface) => surface.id))

  for (const catalog of Object.values(input.detectedWorktreesByRepo)) {
    for (const worktree of catalog?.worktrees ?? []) {
      const ownsTerminalSurface =
        worktree.id === input.activeWorktreeId ||
        (input.terminalTabsByWorktree[worktree.id]?.length ?? 0) > 0
      if (ownsTerminalSurface && !includedIds.has(worktree.id)) {
        includedIds.add(worktree.id)
        surfaces.push({ id: worktree.id, path: worktree.path })
      }
    }
  }

  for (const [worktreeId, tabs] of Object.entries(input.terminalTabsByWorktree)) {
    if (includedIds.has(worktreeId) || (tabs?.length ?? 0) === 0) {
      continue
    }
    const worktreePath = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath.trim()
    if (worktreePath) {
      includedIds.add(worktreeId)
      surfaces.push({ id: worktreeId, path: worktreePath })
    }
  }

  return surfaces
}
