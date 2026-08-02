type ControlledTerminalPtyController = {
  stopAndWait?: (ptyId: string, opts?: { deadlineMs?: number }) => Promise<boolean>
  listProcesses?: (connectionId?: string | null) => Promise<{ id: string }[]>
}

export async function ensureControlledTerminalPtyStopped(
  controller: ControlledTerminalPtyController | null,
  ptyId: string
): Promise<void> {
  if (!controller?.stopAndWait || !controller.listProcesses) {
    throw new Error('terminal PTY stop verification is unavailable')
  }
  const isRunning = async (): Promise<boolean> =>
    (await controller.listProcesses!(null)).some((process) => process.id === ptyId)
  if (!(await isRunning())) {
    return
  }
  await controller.stopAndWait(ptyId, { deadlineMs: Date.now() + 5_000 })
  if (await isRunning()) {
    throw new Error('controlled Codex terminal PTY remains live after forced stop')
  }
}
