export function formatOrcaJsonFailure(command, stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {}
  const blockedReason = parsed?.result?.wait?.blockedReason
  if (typeof blockedReason === 'string' && blockedReason) {
    return `${command} failed: blockedReason: ${blockedReason}`
  }
  const detail = parsed?.error ?? parsed
  if (typeof detail?.code === 'string' && typeof detail?.message === 'string') {
    return `${command} failed: ${detail.code}: ${detail.message}`
  }
  return `${command} failed without a structured error`
}
