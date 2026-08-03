export type TerminalRevealIdentity = {
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string
}

export const TERMINAL_CREATE_SETTLEMENT_UNAVAILABLE_ERROR =
  'renderer_terminal_settlement_unavailable'

export type TerminalTabCreateReply = {
  requestId: string
  tabId?: string
  title?: string
  identity?: TerminalRevealIdentity
  error?: string
}
