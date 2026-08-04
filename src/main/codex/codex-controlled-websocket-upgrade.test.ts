import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { observeControlledWebSocketUpgrade } from './codex-controlled-websocket-upgrade'

const requestLines = [
  'GET /rpc HTTP/1.1',
  'Host: localhost',
  'Upgrade: websocket',
  'Connection: Upgrade',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version: 13'
]
const request = requestWithHeaders()
const accept = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='

describe('controlled WebSocket upgrade observer', () => {
  it('accepts a fragmented valid upgrade and removes its listeners', () => {
    const fixture = createObserver()

    fixture.downstream.write(request)
    fixture.upstream.write(validResponse().slice(0, -1))
    expect(fixture.accepted).not.toHaveBeenCalled()
    fixture.upstream.write('\n')

    expect(fixture.accepted).toHaveBeenCalledOnce()
    expect(fixture.rejected).not.toHaveBeenCalled()
    expect(fixture.downstream.listenerCount('data')).toBe(0)
    expect(fixture.upstream.listenerCount('data')).toBe(0)
  })

  it.each([
    ['an invalid accept digest', validResponse('invalid')],
    ['HTTP/1.0', validResponse(accept, 'HTTP/1.0 101 Switching Protocols')],
    ['a non-websocket Upgrade token', validResponse(accept, undefined, 'Upgrade: h2c')],
    ['a multi-token Upgrade value', validResponse(accept, undefined, 'Upgrade: h2c, websocket')],
    [
      'a whitespace-padded Upgrade field name',
      validResponse(accept, undefined, 'Upgrade : websocket')
    ],
    [
      'an invalid Upgrade field-name character',
      validResponse(accept, undefined, 'Upg(rade: websocket')
    ],
    [
      'an unsolicited response protocol',
      validResponse(accept, undefined, undefined, undefined, 'Sec-WebSocket-Protocol: bogus')
    ],
    [
      'an unsolicited response extension',
      validResponse(
        accept,
        undefined,
        undefined,
        undefined,
        'Sec-WebSocket-Extensions: permessage-deflate'
      )
    ],
    [
      'an invalid response extension',
      validResponse(
        accept,
        undefined,
        undefined,
        undefined,
        'Sec-WebSocket-Extensions: invalid extension'
      )
    ],
    [
      'an invalid Connection token',
      validResponse(accept, undefined, undefined, 'Connection: x-upgrade')
    ]
  ])('rejects %s', (_label, response) => {
    const fixture = createObserver()

    fixture.downstream.write(request)
    fixture.upstream.write(response)

    expect(fixture.accepted).not.toHaveBeenCalled()
    expect(fixture.rejected).toHaveBeenCalledOnce()
  })

  it('accepts a single protocol offered by the downstream client', () => {
    const fixture = createObserver()

    fixture.downstream.write(requestWithHeaders('Sec-WebSocket-Protocol: codex'))
    fixture.upstream.write(
      validResponse(accept, undefined, undefined, undefined, 'Sec-WebSocket-Protocol: codex')
    )

    expect(fixture.accepted).toHaveBeenCalledOnce()
    expect(fixture.rejected).not.toHaveBeenCalled()
  })

  it('rejects an omitted protocol when the downstream client offered one', () => {
    const fixture = createObserver()

    fixture.downstream.write(requestWithHeaders('Sec-WebSocket-Protocol: codex'))
    fixture.upstream.write(validResponse())

    expect(fixture.accepted).not.toHaveBeenCalled()
    expect(fixture.rejected).toHaveBeenCalledOnce()
  })

  it('rejects response extensions until extension negotiation is supported', () => {
    const fixture = createObserver()

    fixture.downstream.write(requestWithHeaders('Sec-WebSocket-Extensions: permessage-deflate'))
    fixture.upstream.write(
      validResponse(
        accept,
        undefined,
        undefined,
        undefined,
        'Sec-WebSocket-Extensions: permessage-deflate'
      )
    )

    expect(fixture.accepted).not.toHaveBeenCalled()
    expect(fixture.rejected).toHaveBeenCalledOnce()
  })

  it('rejects a completed header larger than 16 KiB in one chunk', () => {
    const fixture = createObserver()
    const oversized = `HTTP/1.1 101 Switching Protocols\r\n${'x'.repeat(16 * 1024)}\r\n\r\n`

    fixture.downstream.write(request)
    fixture.upstream.write(oversized)

    expect(fixture.accepted).not.toHaveBeenCalled()
    expect(fixture.rejected).toHaveBeenCalledOnce()
  })
})

function createObserver(): {
  downstream: PassThrough
  upstream: PassThrough
  accepted: ReturnType<typeof vi.fn>
  rejected: ReturnType<typeof vi.fn>
} {
  const downstream = new PassThrough()
  const upstream = new PassThrough()
  const accepted = vi.fn()
  const rejected = vi.fn()
  observeControlledWebSocketUpgrade(downstream as never, upstream as never, accepted, rejected)
  return { downstream, upstream, accepted, rejected }
}

function validResponse(
  digest = accept,
  status = 'HTTP/1.1 101 Switching Protocols',
  upgrade = 'Upgrade: websocket',
  connection = 'Connection: Upgrade',
  ...negotiationHeaders: string[]
): string {
  return [
    status,
    upgrade,
    connection,
    `Sec-WebSocket-Accept: ${digest}`,
    ...negotiationHeaders,
    '',
    ''
  ].join('\r\n')
}

function requestWithHeaders(...headers: string[]): string {
  return [...requestLines, ...headers, '', ''].join('\r\n')
}
