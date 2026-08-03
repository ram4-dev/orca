import { createConnection } from 'node:net'
import WebSocket from 'ws'

export function connectTestTransport(command: string): WebSocket {
  const socketPath = command.match(/unix:\/\/([^']+)/)?.[1]
  if (!socketPath) {
    throw new Error('missing visible socket path')
  }
  const connection = new WebSocket('ws://localhost/rpc', {
    perMessageDeflate: false,
    createConnection: () => createConnection(socketPath)
  })
  connection.on('error', () => undefined)
  return connection
}

export function closeTestTransports(connections: WebSocket[]): void {
  for (const connection of connections.splice(0)) {
    connection.terminate()
  }
}
