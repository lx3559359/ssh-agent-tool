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
