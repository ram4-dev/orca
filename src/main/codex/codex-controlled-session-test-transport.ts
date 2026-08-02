import { createConnection, type Socket } from 'node:net'

export function connectTestTransport(command: string): Socket {
  const socketPath = command.match(/unix:\/\/([^']+)/)?.[1]
  if (!socketPath) {
    throw new Error('missing visible socket path')
  }
  const connection = createConnection(socketPath)
  connection.on('error', () => undefined)
  return connection
}

export function closeTestTransports(connections: Socket[]): void {
  for (const connection of connections.splice(0)) {
    connection.destroy()
  }
}
