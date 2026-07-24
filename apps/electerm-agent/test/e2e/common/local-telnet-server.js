const net = require('node:net')
const { once } = require('node:events')

async function startLocalTelnetServer () {
  const sockets = new Set()
  const state = {
    connectionCount: 0,
    receivedText: ''
  }
  const server = net.createServer(socket => {
    sockets.add(socket)
    state.connectionCount += 1
    socket.setEncoding('utf8')
    socket.write('ShellPilot local Telnet ready\r\n> ')
    let buffer = ''
    socket.on('data', chunk => {
      state.receivedText += chunk
      buffer += chunk
      let lineEnding = buffer.match(/\r\n|\r|\n/)
      while (lineEnding) {
        const endIndex = lineEnding.index
        const line = buffer.slice(0, endIndex)
        buffer = buffer.slice(endIndex + lineEnding[0].length)
        socket.write(`echo:${line}\r\n> `)
        lineEnding = buffer.match(/\r\n|\r|\n/)
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    host: '127.0.0.1',
    port: server.address().port,
    state,
    async close () {
      for (const socket of sockets) {
        socket.destroy()
      }
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
        })
      }
    }
  }
}

module.exports = {
  startLocalTelnetServer
}
