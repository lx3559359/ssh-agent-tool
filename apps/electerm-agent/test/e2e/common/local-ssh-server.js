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

function osc633 (nonce, type, payload = '') {
  return `\u001b]633;${type};${nonce}${payload ? `;${payload}` : ''}\u0007`
}

function writeTrackedPrompt (stream, nonce) {
  stream.write(
    osc633(nonce, 'P', 'Cwd=/home/shellpilot') +
    osc633(nonce, 'A') +
    '$ ' +
    osc633(nonce, 'B')
  )
}

function runCommand (stream, command, state) {
  const integration = command.match(/__e_nonce=[\s\S]*?([a-f0-9]{32})/)
  if (integration) {
    state.shellIntegrationNonce = integration[1]
    // The client intentionally discards the first OSC chunk while ending
    // output suppression. A real shell emits the next prompt separately.
    stream.write(osc633(state.shellIntegrationNonce, 'A'))
    setTimeout(() => writeTrackedPrompt(stream, state.shellIntegrationNonce), 20)
    return
  }

  state.commands.push(command)
  const nonce = state.shellIntegrationNonce
  if (nonce) {
    stream.write(
      osc633(nonce, 'E', command.replace(/\\/g, '\\\\').replace(/;/g, '\\x3b')) +
      osc633(nonce, 'C')
    )
  }
  if (command === 'echo shellpilot-e2e') {
    stream.write('shellpilot-e2e\r\n')
  } else if (command === 'pwd') {
    stream.write('/home/shellpilot\r\n')
  } else if (command) {
    stream.write(`command received: ${command}\r\n`)
  }
  if (nonce) {
    stream.write(osc633(nonce, 'D', '0'))
    writeTrackedPrompt(stream, nonce)
  } else {
    stream.write('$ ')
  }
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
        runCommand(stream, line.trim(), state)
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
    ctrlCCount: 0,
    shellIntegrationNonce: '',
    execCommands: [],
    commands: []
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
        session.on('exec', (acceptExec, rejectExec, info) => {
          state.execCommands.push(info.command)
          const stream = acceptExec()
          if (/\$SHELL/.test(info.command)) {
            stream.write('/bin/bash\n')
            stream.exit(0)
          } else {
            stream.stderr.write(`unsupported E2E exec: ${info.command}\n`)
            stream.exit(127)
          }
          stream.end()
        })
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
