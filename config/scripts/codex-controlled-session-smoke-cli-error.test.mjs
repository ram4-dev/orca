import { describe, expect, it } from 'vitest'
import { formatOrcaJsonFailure } from './codex-controlled-session-smoke-cli-error.mjs'

describe('formatOrcaJsonFailure', () => {
  it('preserves a structured terminal wait blocker from a nonzero CLI exit', () => {
    const stdout = JSON.stringify({
      ok: true,
      result: {
        wait: {
          satisfied: false,
          status: 'running',
          blockedReason: 'codex-cwd-prompt'
        }
      }
    })

    expect(formatOrcaJsonFailure('orca terminal wait', stdout)).toBe(
      'orca terminal wait failed: blockedReason: codex-cwd-prompt'
    )
  })

  it('preserves ordinary structured CLI errors', () => {
    const stdout = JSON.stringify({
      ok: false,
      error: { code: 'terminal_not_found', message: 'terminal is unavailable' }
    })

    expect(formatOrcaJsonFailure('orca terminal close', stdout)).toBe(
      'orca terminal close failed: terminal_not_found: terminal is unavailable'
    )
  })
})
