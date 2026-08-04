import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v3'
import {
  CONTROLLED_ORCA_LAUNCH_TOOL_NAME,
  launchControlledOrcaWorker
} from './codex-controlled-orca-launch-tool'
import { readControlledOrcaMcpBinding } from './codex-controlled-orca-mcp-binding'

async function main(): Promise<void> {
  const bindingPath = process.env.ORCA_CONTROLLED_BINDING_PATH?.trim()
  if (!bindingPath) {
    throw new Error('ORCA_CONTROLLED_BINDING_PATH is required')
  }
  const server = new McpServer({ name: 'orca-controlled', version: '1.0.0' })
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: Record<string, unknown> },
    handler: (arguments_: {
      prompt: string
      title?: string
      agent?: 'codex' | 'claude' | 'cursor' | 'gemini' | 'opencode'
    }) => Promise<unknown>
  ) => void
  registerTool(
    CONTROLLED_ORCA_LAUNCH_TOOL_NAME,
    {
      description:
        'Launch one supervised Orca worker asynchronously in the current worktree. Return as soon as the worker is ready; do not wait for completion. Orca will wake this same Codex conversation when it finishes.',
      inputSchema: {
        prompt: z.string().min(1).describe('Complete task for the worker.'),
        title: z.string().min(1).max(120).optional().describe('Short task title shown in Orca.'),
        agent: z.enum(['codex', 'claude', 'cursor', 'gemini', 'opencode']).optional()
      }
    },
    async (arguments_) => {
      try {
        const binding = readControlledOrcaMcpBinding(bindingPath)
        const result = await launchControlledOrcaWorker({
          arguments: arguments_,
          cwd: process.cwd(),
          terminalHandle: binding.terminalHandle
        })
        return {
          content: result.contentItems.map((item) => ({ type: 'text' as const, text: item.text }))
        }
      } catch (error) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: error instanceof Error ? error.message : String(error) }
          ]
        }
      }
    }
  )
  await server.connect(new StdioServerTransport())
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
