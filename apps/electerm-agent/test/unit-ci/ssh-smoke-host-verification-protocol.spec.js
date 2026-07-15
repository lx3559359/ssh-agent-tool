const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { once } = require('node:events')
const { Client, Server, utils } = require('@electerm/ssh2')

const root = path.resolve(__dirname, '../..')
const sshSmoke = require(path.join(root, 'build/bin/smoke-ssh-sftp.js'))

function createHostKey () {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048
  })
  return privateKey.export({ type: 'pkcs1', format: 'pem' })
}

function hostFingerprint (privateKey) {
  const parsed = utils.parseKey(privateKey)
  if (parsed instanceof Error) throw parsed
  const digest = crypto.createHash('sha256')
    .update(parsed.getPublicSSH())
    .digest('base64')
    .replace(/=+$/, '')
  return `SHA256:${digest}`
}

async function startServer () {
  const privateKey = createHostKey()
  const clients = new Set()
  const state = {
    authenticationCount: 0,
    passwordAuthenticationCount: 0
  }
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client)
    const remove = () => clients.delete(client)
    client.on('error', () => {})
    client.on('close', remove)
    client.on('end', remove)
    client.on('authentication', context => {
      state.authenticationCount += 1
      if (context.method === 'password') {
        state.passwordAuthenticationCount += 1
      }
      if (
        context.method === 'password' &&
        context.username === 'protocol-user' &&
        context.password === ' protocol-password '
      ) {
        context.accept()
      } else {
        context.reject(['password'])
      }
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    fingerprint: hostFingerprint(privateKey),
    port: server.address().port,
    state,
    async close () {
      for (const client of clients) client.end()
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

function configFor (server, fingerprint) {
  return sshSmoke.resolveConfig({
    SHELLPILOT_SSH_HOST: '127.0.0.1',
    SHELLPILOT_SSH_USER: 'protocol-user',
    SHELLPILOT_SSH_PASSWORD: ' protocol-password ',
    SHELLPILOT_SSH_HOST_FINGERPRINT: fingerprint,
    SHELLPILOT_SSH_PORT: String(server.port),
    SHELLPILOT_SSH_TEST_DIR: '/tmp',
    SHELLPILOT_SSH_TIMEOUT: '3000'
  })
}

test('production SSH smoke verification accepts the expected host key before authentication', {
  timeout: 10000
}, async () => {
  const server = await startServer()
  let client
  try {
    const config = sshSmoke.validateConfig(configFor(server, server.fingerprint))
    client = await sshSmoke.connect(config, () => new Client())
    assert.ok(server.state.authenticationCount > 0)
    assert.equal(server.state.passwordAuthenticationCount, 1)
  } finally {
    client?.end()
    await server.close()
  }
})

test('production SSH smoke verification rejects a wrong host key before authentication', {
  timeout: 10000
}, async () => {
  const server = await startServer()
  let client
  try {
    const wrongFingerprint = `SHA256:${Buffer.alloc(32, 0x5a)
      .toString('base64')
      .replace(/=+$/, '')}`
    const config = sshSmoke.validateConfig(configFor(server, wrongFingerprint))
    await assert.rejects(
      sshSmoke.connect(config, () => {
        client = new Client()
        return client
      }),
      /host verifier|host key|host denied|handshake/i
    )
    assert.equal(server.state.authenticationCount, 0)
  } finally {
    client?.end()
    await server.close()
  }
})
