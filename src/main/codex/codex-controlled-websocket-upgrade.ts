import { createHash } from 'node:crypto'
import type { Socket } from 'node:net'

const WEBSOCKET_UPGRADE_HEADER_LIMIT = 16 * 1024
const WEBSOCKET_ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const HEADER_TERMINATOR = Buffer.from('\r\n\r\n')

export function observeControlledWebSocketUpgrade(
  downstream: Socket,
  upstream: Socket,
  onAccepted: () => void,
  onRejected: (error: Error) => void
): () => void {
  let downstreamHeader: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let upstreamHeader: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let expectedAccept: string | null = null
  let requestedProtocols: string[] = []
  let requestedExtensions = false
  let settled = false

  const cleanup = () => {
    downstream.off('data', onDownstreamData)
    upstream.off('data', onUpstreamData)
  }
  const reject = (message: string) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    onRejected(new Error(message))
  }
  const onDownstreamData = (data: Buffer) => {
    const next = appendUpgradeHeader(downstreamHeader, data)
    downstreamHeader = next.header
    if (next.invalid) {
      reject('controlled Codex visible WebSocket upgrade was invalid')
      return
    }
    if (!next.complete) {
      return
    }
    const request = parseWebSocketRequest(next.complete)
    if (!request) {
      reject('controlled Codex visible WebSocket upgrade was invalid')
      return
    }
    expectedAccept = request.accept
    requestedProtocols = request.protocols
    requestedExtensions = request.requestsExtensions
    downstream.off('data', onDownstreamData)
  }
  const onUpstreamData = (data: Buffer) => {
    const next = appendUpgradeHeader(upstreamHeader, data)
    upstreamHeader = next.header
    if (next.invalid) {
      reject('controlled Codex visible WebSocket upgrade was invalid')
      return
    }
    if (!next.complete) {
      return
    }
    if (
      !expectedAccept ||
      !isAcceptedWebSocketUpgrade(
        next.complete,
        expectedAccept,
        requestedProtocols,
        requestedExtensions
      )
    ) {
      reject('controlled Codex visible WebSocket upgrade was rejected')
      return
    }
    settled = true
    cleanup()
    onAccepted()
  }

  downstream.on('data', onDownstreamData)
  upstream.on('data', onUpstreamData)
  return cleanup
}

type UpgradeHeader = {
  header: Buffer<ArrayBufferLike>
  complete?: string
  invalid?: true
}

function appendUpgradeHeader(
  header: Buffer<ArrayBufferLike>,
  data: Buffer<ArrayBufferLike>
): UpgradeHeader {
  const remaining = WEBSOCKET_UPGRADE_HEADER_LIMIT + HEADER_TERMINATOR.length - header.length
  const next = remaining > 0 ? Buffer.concat([header, data.subarray(0, remaining)]) : header
  const headerEnd = next.indexOf(HEADER_TERMINATOR)
  if (headerEnd !== -1) {
    if (headerEnd + HEADER_TERMINATOR.length > WEBSOCKET_UPGRADE_HEADER_LIMIT) {
      return { header: next, invalid: true }
    }
    return {
      header: next,
      complete: next.subarray(0, headerEnd + HEADER_TERMINATOR.length).toString('latin1')
    }
  }
  if (next.length > WEBSOCKET_UPGRADE_HEADER_LIMIT) {
    return { header: next, invalid: true }
  }
  return { header: next }
}

type WebSocketRequest = {
  accept: string
  protocols: string[]
  requestsExtensions: boolean
}

function parseWebSocketRequest(header: string): WebSocketRequest | null {
  const fields = parseHeaderFields(header)
  const key = fields?.get('sec-websocket-key')
  if (!fields || !key || key.length !== 1 || !key[0]?.trim()) {
    return null
  }
  const protocols = parseRequestedProtocols(fields.get('sec-websocket-protocol'))
  if (!protocols) {
    return null
  }
  return {
    accept: createHash('sha1').update(`${key[0].trim()}${WEBSOCKET_ACCEPT_GUID}`).digest('base64'),
    protocols,
    requestsExtensions: fields.has('sec-websocket-extensions')
  }
}

function isAcceptedWebSocketUpgrade(
  header: string,
  expectedAccept: string,
  requestedProtocols: string[],
  requestedExtensions: boolean
): boolean {
  const lines = header.slice(0, -HEADER_TERMINATOR.length).split('\r\n')
  if (!/^HTTP\/1\.1 101(?:[ \t].*)?$/.test(lines[0] ?? '')) {
    return false
  }
  const fields = parseHeaderFields(header)
  const accept = fields?.get('sec-websocket-accept')
  return (
    fields !== null &&
    hasSingleHeaderValue(fields.get('upgrade'), 'websocket') &&
    hasHeaderToken(fields.get('connection'), 'upgrade') &&
    accept?.length === 1 &&
    accept[0]?.trim() === expectedAccept &&
    selectsOfferedProtocol(fields.get('sec-websocket-protocol'), requestedProtocols) &&
    acceptsExtensionSelection(fields.get('sec-websocket-extensions'), requestedExtensions)
  )
}

function parseHeaderFields(header: string): Map<string, string[]> | null {
  const lines = header.slice(0, -HEADER_TERMINATOR.length).split('\r\n')
  if (!lines[0]) {
    return null
  }
  const fields = new Map<string, string[]>()
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      return null
    }
    const name = line.slice(0, separator)
    if (!isHeaderFieldName(name)) {
      return null
    }
    const normalizedName = name.toLowerCase()
    const values = fields.get(normalizedName) ?? []
    values.push(line.slice(separator + 1).trim())
    fields.set(normalizedName, values)
  }
  return fields
}

function isHeaderFieldName(name: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
}

function parseRequestedProtocols(values: string[] | undefined): string[] | null {
  if (!values) {
    return []
  }
  const protocols = values.flatMap((value) => value.split(',').map((part) => part.trim()))
  return protocols.every(isToken) ? protocols : null
}

function hasSingleHeaderValue(values: string[] | undefined, value: string): boolean {
  return values?.length === 1 && values[0]?.trim().toLowerCase() === value
}

function selectsOfferedProtocol(
  values: string[] | undefined,
  requestedProtocols: string[]
): boolean {
  if (!values) {
    return requestedProtocols.length === 0
  }
  const selected = values.length === 1 ? values[0]?.trim() : undefined
  return selected !== undefined && isToken(selected) && requestedProtocols.includes(selected)
}

function acceptsExtensionSelection(
  values: string[] | undefined,
  requestedExtensions: boolean
): boolean {
  if (!values) {
    return true
  }
  if (!requestedExtensions) {
    return false
  }
  // Why: no extension negotiation contract is proven for the visible Codex client.
  return false
}

function hasHeaderToken(values: string[] | undefined, token: string): boolean {
  return (
    values?.some((value) => value.split(',').some((part) => part.trim().toLowerCase() === token)) ??
    false
  )
}

function isToken(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)
}
