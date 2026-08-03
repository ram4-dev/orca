const ENV_BOOLEAN_OPTIONS = new Set([
  '-',
  '-0',
  '-i',
  '-v',
  '--ignore-environment',
  '--null',
  '--debug',
  '--list-signal-handling'
])
const ENV_OPTIONS_WITH_VALUES = new Set([
  '-C',
  '-P',
  '-S',
  '-u',
  '--chdir',
  '--split-string',
  '--unset'
])
const ENV_TERMINAL_OPTIONS = new Set(['--help', '--version'])

export function tokenizeLeadingShellWords(command: string, limit: number): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        if (tokens.length >= limit) {
          return tokens
        }
        current = ''
      }
      continue
    }
    current += ch
  }

  if (current && tokens.length < limit) {
    tokens.push(current)
  }
  return tokens
}

export function commandBasename(command: string): string {
  const normalized = command.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
}

function isShellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function tokenizeEnvSplitString(value: string): string[] | null {
  if (/[\\$`\r\n]/.test(value)) {
    return null
  }
  let quote: '"' | "'" | null = null
  for (const ch of value) {
    if (quote) {
      if (ch === quote) {
        quote = null
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
    }
  }
  if (quote !== null) {
    return null
  }
  const tokens = tokenizeLeadingShellWords(value, 32).filter((token) => token.length > 0)
  return tokens.length > 0 ? tokens : null
}

function isEnvSplitStringOption(option: string): boolean {
  return option === '-S' || option === '--split-string'
}

function stripEnvLaunchPrefix(tokens: string[]): string[] {
  const remaining = [...tokens]
  let splitExpansions = 0
  let parsingOptions = true
  while (remaining[0]) {
    const token = remaining[0]
    if (isShellAssignment(token)) {
      remaining.shift()
      continue
    }
    if (!parsingOptions) {
      break
    }
    if (token === '--') {
      remaining.shift()
      parsingOptions = false
      continue
    }
    if (ENV_TERMINAL_OPTIONS.has(token)) {
      return []
    }
    if (ENV_BOOLEAN_OPTIONS.has(token) || /^-[0iv]{2,}$/.test(token)) {
      remaining.shift()
      continue
    }

    const longOption = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
    if (token.startsWith('--') && ENV_OPTIONS_WITH_VALUES.has(longOption)) {
      const hasAttachedValue = token.includes('=')
      const value = hasAttachedValue ? token.slice(token.indexOf('=') + 1) : remaining[1]
      if (!value) {
        return []
      }
      if (isEnvSplitStringOption(longOption)) {
        const expanded = tokenizeEnvSplitString(value)
        if (!expanded || splitExpansions >= 4) {
          return []
        }
        splitExpansions += 1
        remaining.splice(0, hasAttachedValue ? 1 : 2, ...expanded)
      } else {
        remaining.splice(0, hasAttachedValue ? 1 : 2)
      }
      continue
    }

    const shortOption = token.slice(0, 2)
    if (ENV_OPTIONS_WITH_VALUES.has(shortOption)) {
      const hasAttachedValue = token.length > 2
      const value = hasAttachedValue ? token.slice(2) : remaining[1]
      if (!value) {
        return []
      }
      if (isEnvSplitStringOption(shortOption)) {
        const expanded = tokenizeEnvSplitString(value)
        if (!expanded || splitExpansions >= 4) {
          return []
        }
        splitExpansions += 1
        remaining.splice(0, hasAttachedValue ? 1 : 2, ...expanded)
      } else {
        remaining.splice(0, hasAttachedValue ? 1 : 2)
      }
      continue
    }
    // Why: an unknown env option may consume the next token; never promote it to an agent executable.
    if (token.startsWith('-')) {
      return []
    }
    break
  }
  return remaining
}

export function stripShellLaunchPrefix(tokens: string[]): string[] {
  const remaining = [...tokens]
  while (remaining[0] && isShellAssignment(remaining[0])) {
    remaining.shift()
  }
  if (remaining[0] && commandBasename(remaining[0]) === 'env') {
    remaining.shift()
    return stripEnvLaunchPrefix(remaining)
  }
  return remaining
}
