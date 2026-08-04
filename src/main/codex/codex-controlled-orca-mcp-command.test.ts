import { describe, expect, it } from 'vitest'
import { buildControlledOrcaMcpArgs } from './codex-controlled-orca-mcp-command'

describe('controlled Orca MCP command', () => {
  it('passes the exact Wake Dev CLI identity into the MCP process', () => {
    const args = buildControlledOrcaMcpArgs('/app/electron', '/app/mcp.js', '/tmp/binding.json', {
      ORCA_PACKAGED_COMMAND_NAME: 'orca-wake',
      ORCA_PACKAGED_CLI_BIN_PATH: '/app/Resources/bin/orca-wake'
    })

    expect(args).toContain('mcp_servers.orca_controlled.env.ORCA_PACKAGED_COMMAND_NAME="orca-wake"')
    expect(args).toContain(
      'mcp_servers.orca_controlled.env.ORCA_PACKAGED_CLI_BIN_PATH="/app/Resources/bin/orca-wake"'
    )
  })

  it('does not invent a Wake Dev CLI identity in other builds', () => {
    const args = buildControlledOrcaMcpArgs('/app/electron', '/app/mcp.js', undefined, {})

    expect(args.join('\n')).not.toContain('ORCA_PACKAGED_COMMAND_NAME')
    expect(args.join('\n')).not.toContain('ORCA_PACKAGED_CLI_BIN_PATH')
  })
})
