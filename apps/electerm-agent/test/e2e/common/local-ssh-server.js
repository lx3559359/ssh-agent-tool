const { once } = require('node:events')
const { Server, utils } = require('@electerm/ssh2')

const TEST_USERNAME = 'shellpilot-e2e'
const TEST_PASSWORD = 'shellpilot-e2e-password'
const HOST_KEY = utils.generateKeyPairSync('ed25519', {
  comment: 'shellpilot-e2e-host'
})

function writePrompt (stream) {
  stream.write('\r\n$ ')
}

function runCommand (stream, command) {
  if (command === 'echo shellpilot-e2e') {
    stream.write('shellpilot-e2e\r\n')
  } else if (command === 'pwd') {
    stream.write('/home/shellpilot\r\n')
  } else if (command) {
    stream.write(`command received: ${command}\r\n`)
  }
  stream.write('$ ')
}

function attachShell (stream, state) {
  let line = ''
  let lastWasCarriageReturn = false

  stream.write('ShellPilot E2E ready\r\n$ ')
  stream.on('error', () => {})
  stream.on('data', chunk => {
    for (const byte of chunk) {
      if (byte === 3) {
        state.ctrlCCount += 1
        line = ''
        stream.write('^C')
        writePrompt(stream)
        lastWasCarriageReturn = false
        continue
      }
      if (byte === 13 || byte === 10) {
        if (byte === 10 && lastWasCarriageReturn) {
          lastWasCarriageReturn = false
          continue
        }
        lastWasCarriageReturn = byte === 13
        stream.write('\r\n')
        runCommand(stream, line.trim())
        line = ''
        continue
      }
      lastWasCarriageReturn = false
      if (byte === 8 || byte === 127) {
        line = line.slice(0, -1)
        stream.write('\b \b')
        continue
      }
      const char = String.fromCharCode(byte)
      line += char
      stream.write(char)
    }
  })
}

async function startLocalSshServer () {
  const clients = new Set()
  const state = {
    authenticationCount: 0,
    acceptedCount: 0,
    readyCount: 0,
    shellCount: 0,
    ctrlCCount: 0
  }
  const server = new Server({
    hostKeys: [HOST_KEY.private]
  }, client => {
    clients.add(client)
    const remove = () => clients.delete(client)
    client.on('error', remove)
    client.on('close', remove)
    client.on('end', remove)
    client.on('authentication', ctx => {
      state.authenticationCount += 1
      if (
        ctx.method === 'password' &&
        ctx.username === TEST_USERNAME &&
        ctx.password === TEST_PASSWORD
      ) {
        state.acceptedCount += 1
        ctx.accept()
        return
      }
      ctx.reject(['password'])
    })
    client.on('ready', () => {
      state.readyCount += 1
      client.on('session', accept => {
        const session = accept()
        session.on('env', acceptEnv => acceptEnv?.())
        session.on('pty', acceptPty => acceptPty())
        session.on('window-change', () => {})
        session.on('shell', acceptShell => {
          state.shellCount += 1
          attachShell(acceptShell(), state)
        })
      })
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    host: '127.0.0.1',
    port: server.address().port,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    state,
    async close () {
      for (const client of clients) {
        client.end()
      }
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

module.exports = {
  startLocalSshServer
}
