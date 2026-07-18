import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('@electerm/ssh2')
const { startLocalSshServer } = require('../e2e/common/local-ssh-server')
const { createLocalSftpFixture } = require('../e2e/common/local-sftp-fixture')

function connectClient (server) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve(client))
    client.once('error', reject)
    client.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
      readyTimeout: 10000
    })
  })
}

function openSftp (client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => error ? reject(error) : resolve(sftp))
  })
}

function openShell (client) {
  return new Promise((resolve, reject) => {
    client.shell((error, stream) => error ? reject(error) : resolve(stream))
  })
}

async function waitFor (predicate, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('timed out waiting for local SSH fixture state')
}

function callSftp (sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, result) => error ? reject(error) : resolve(result))
  })
}

test('local SSH fixture provides isolated SFTP read, write, rename and cleanup operations', async () => {
  const fixture = await createLocalSftpFixture()
  const server = await startLocalSshServer({ sftpRoot: fixture.root })
  let client

  try {
    client = await connectClient(server)
    const sftp = await openSftp(client)
    const initialEntries = await callSftp(sftp, 'readdir', '/')
    assert.ok(initialEntries.some(entry => entry.filename === 'remote-seed.txt'))

    const source = path.join(fixture.root, 'remote-seed.txt')
    const expectedHash = await fixture.hashFile('/remote-seed.txt')
    const remoteContent = await callSftp(sftp, 'readFile', '/remote-seed.txt')
    assert.equal(remoteContent.toString('utf8'), await fs.promises.readFile(source, 'utf8'))

    await callSftp(sftp, 'writeFile', '/uploaded.txt', Buffer.from('isolated upload\n', 'utf8'))
    await callSftp(sftp, 'rename', '/uploaded.txt', '/renamed.txt')
    assert.equal(await fixture.hashFile('/remote-seed.txt'), expectedHash)
    assert.equal(await fs.promises.readFile(path.join(fixture.root, 'renamed.txt'), 'utf8'), 'isolated upload\n')

    await callSftp(sftp, 'mkdir', '/nested')
    await callSftp(sftp, 'unlink', '/renamed.txt')
    await callSftp(sftp, 'rmdir', '/nested')
    assert.ok(server.state.sftpSessions > 0)
    assert.ok(server.state.sftpWrites > 0)
    assert.ok(server.state.sftpRenames > 0)
  } finally {
    client?.end()
    await server.close().catch(() => {})
    await fixture.cleanup()
  }
})

test('local SSH fixture records shell commands against stable connection sessions', async () => {
  const server = await startLocalSshServer()
  const clients = []

  try {
    clients.push(await connectClient(server), await connectClient(server))
    const firstShell = await openShell(clients[0])
    const secondShell = await openShell(clients[1])
    firstShell.write('pwd\r')
    firstShell.write('ip addr\r')
    secondShell.write('pwd\r')
    await waitFor(() => server.state.commandEvents.length === 3)

    const [firstPwd, firstIp, secondPwd] = server.state.commandEvents
    assert.deepEqual(
      server.state.commands.slice(-3),
      ['pwd', 'ip addr', 'pwd'],
      'legacy command state remains compatible'
    )
    assert.equal(firstPwd.sessionId, firstIp.sessionId)
    assert.notEqual(firstPwd.sessionId, secondPwd.sessionId)
    assert.deepEqual(
      server.state.shellSessionIds,
      [firstPwd.sessionId, secondPwd.sessionId]
    )
  } finally {
    for (const client of clients) client.end()
    await server.close().catch(() => {})
  }
})
