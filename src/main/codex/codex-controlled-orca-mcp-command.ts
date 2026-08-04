import { join, sep } from 'node:path'

export function buildControlledOrcaMcpArgs(
  executable = process.execPath,
  entryPath = resolveControlledOrcaMcpEntryPath(),
  bindingPath?: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const wakeDevCliEnv =
    env.ORCA_PACKAGED_COMMAND_NAME === 'orca-wake' && env.ORCA_PACKAGED_CLI_BIN_PATH
      ? [
          '-c',
          'mcp_servers.orca_controlled.env.ORCA_PACKAGED_COMMAND_NAME="orca-wake"',
          '-c',
          `mcp_servers.orca_controlled.env.ORCA_PACKAGED_CLI_BIN_PATH=${JSON.stringify(env.ORCA_PACKAGED_CLI_BIN_PATH)}`
        ]
      : []
  return [
    '-c',
    `mcp_servers.orca_controlled.command=${JSON.stringify(executable)}`,
    '-c',
    `mcp_servers.orca_controlled.args=${JSON.stringify([entryPath])}`,
    '-c',
    'mcp_servers.orca_controlled.env.ELECTRON_RUN_AS_NODE="1"',
    '-c',
    'mcp_servers.orca_controlled.default_tools_approval_mode="approve"',
    ...wakeDevCliEnv,
    ...(bindingPath
      ? [
          '-c',
          `mcp_servers.orca_controlled.env.ORCA_CONTROLLED_BINDING_PATH=${JSON.stringify(bindingPath)}`
        ]
      : [])
  ]
}

function resolveControlledOrcaMcpEntryPath(): string {
  const adjacent = join(__dirname, 'codex-controlled-orca-mcp-entry.js')
  const asarSegment = `${sep}app.asar${sep}`
  return adjacent.includes(asarSegment)
    ? adjacent.replace(asarSegment, `${sep}app.asar.unpacked${sep}`)
    : adjacent
}
