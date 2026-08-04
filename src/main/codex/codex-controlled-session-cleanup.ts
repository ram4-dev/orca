export async function captureControlledCleanup(
  failures: unknown[],
  cleanup: () => void | Promise<void>
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    failures.push(error)
  }
}

export function throwControlledCleanupFailures(failures: unknown[]): void {
  if (failures.length === 1) {
    throw failures[0]
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'controlled Codex cleanup failed')
  }
}
