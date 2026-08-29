import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { buildPrivilegedFileCommand } from '../../src/client/components/sftp/privileged-file-protocol.js'

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

function runExec (client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error)
      let stdout = ''
      let stderr = ''
      stream.on('data', data => { stdout += data.toString('utf8') })
      stream.stderr.on('data', data => { stderr += data.toString('utf8') })
      stream.once('close', code => resolve({ stdout, stderr, code }))
    })
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

function digest (value) {
  return createHash('sha256').update(value).digest('hex')
}

function parentProof (fixture, childPath, prefix, { trust = false } = {}) {
  const parentPath = path.posix.dirname(childPath)
  const parent = fixture.statRootPath(parentPath)
  return {
    [`${prefix}ParentRealPath`]: parentPath,
    [`${prefix}ParentDevice`]: String(parent.device),
    [`${prefix}ParentInode`]: String(parent.inode),
    ...(trust
      ? {
          [`${prefix}ParentUid`]: String(parent.uid),
          [`${prefix}ParentMode`]: parent.mode.toString(8)
        }
      : {})
  }
}

function entryProof (entry, prefix) {
  return {
    [`${prefix}Device`]: String(entry.device),
    [`${prefix}Inode`]: String(entry.inode),
    [`${prefix}Type`]: entry.type
  }
}

async function openRootFixtureShell (server, client) {
  const stream = await openShell(client)
  let output = ''
  stream.on('data', data => { output += data.toString('utf8') })
  await waitFor(() => server.state.shellCount > 0)
  stream.write('su root\r')
  await waitFor(() => server.state.effectiveIdentity?.uid === '0')
  return {
    stream,
    output: () => output
  }
}

let privilegedTokenSequence = 1

async function runPrivilegedRequest (shell, request) {
  const token = privilegedTokenSequence.toString(16).padStart(32, '0')
  privilegedTokenSequence += 1
  const command = buildPrivilegedFileCommand({ token, request })
  const start = shell.output().length
  shell.stream.write(command + '\r')
  const endPrefix = `\u001b]698;SHELLPILOT_FILE;${token};end;`
  await waitFor(() => shell.output().slice(start).includes(endPrefix), 10000)
  const result = shell.output().slice(start)
  const exitCode = Number(result.slice(
    result.indexOf(endPrefix) + endPrefix.length
  ).split('\u0007', 1)[0])
  return { exitCode, output: result }
}

async function withPrivilegedFixture (runTest) {
  const fixture = await createLocalSftpFixture()
  const server = await startLocalSshServer({
    managedPtyTasks: true,
    sftpRoot: fixture.root,
    sftpFixture: fixture
  })
  let client
  try {
    client = await connectClient(server)
    const shell = await openRootFixtureShell(server, client)
    await runTest({ fixture, server, shell })
  } finally {
    client?.end()
    await server.close()
    await fixture.cleanup()
  }
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
    const incomingDirectory = initialEntries.find(entry => entry.filename === 'incoming')
    assert.equal(incomingDirectory?.longname?.startsWith('d'), true)

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

test('local SSH fixture accepts deterministic custom exec results', async () => {
  const server = await startLocalSshServer({
    execResults: {
      'shellpilot status probe': ['probe-ok\n', 0]
    }
  })
  let client

  try {
    client = await connectClient(server)
    assert.deepEqual(
      await runExec(client, 'shellpilot status probe'),
      { stdout: 'probe-ok\n', stderr: '', code: 0 }
    )
  } finally {
    client?.end()
    await server.close().catch(() => {})
  }
})

test('local OSC 698 fixture rejects stale mutation proofs without changing its model', async t => {
  await t.test('forged parent and entry bindings cannot chmod an entry', async () => {
    await withPrivilegedFixture(async ({ fixture, shell }) => {
      const targetPath = '/root-only/app.conf'
      const before = fixture.statRootPath(targetPath)
      const baseArgs = {
        targetPath,
        ...parentProof(fixture, targetPath, 'target', { trust: true }),
        ...entryProof(before, 'target'),
        targetMode: '666',
        targetUid: String(before.uid),
        targetGid: String(before.gid)
      }
      const forgeries = [
        ['parent device', args => {
          args.targetParentDevice = String(Number(args.targetParentDevice) + 1)
        }],
        ['parent inode', args => {
          args.targetParentInode = String(Number(args.targetParentInode) + 1)
        }],
        ['parent uid', args => {
          args.targetParentUid = String(Number(args.targetParentUid) + 1)
        }],
        ['parent mode', args => { args.targetParentMode = '755' }],
        ['entry device', args => {
          args.targetDevice = String(Number(args.targetDevice) + 1)
        }],
        ['entry inode', args => {
          args.targetInode = String(Number(args.targetInode) + 1)
        }],
        ['entry type', args => { args.targetType = 'directory' }]
      ]
      for (const [label, forge] of forgeries) {
        const args = { ...baseArgs }
        forge(args)
        const result = await runPrivilegedRequest(shell, {
          operation: 'metadata-bound',
          args
        })
        assert.notEqual(result.exitCode, 0, label)
        assert.deepEqual(fixture.statRootPath(targetPath), before, label)
      }
    })
  })

  await t.test('forged file metadata cannot remove a file', async () => {
    await withPrivilegedFixture(async ({ fixture, shell }) => {
      const targetPath = '/root-only/app.conf'
      const before = fixture.statRootPath(targetPath)
      const beforeContent = fixture.readRootBuffer(targetPath)
      const baseArgs = {
        targetPath,
        ...parentProof(fixture, targetPath, 'target'),
        ...entryProof(before, 'target'),
        targetMode: before.mode.toString(8),
        targetUid: String(before.uid),
        targetGid: String(before.gid),
        sha256: digest(beforeContent),
        size: String(beforeContent.length)
      }
      const forgeries = [
        ['mode', args => { args.targetMode = '644' }],
        ['uid', args => {
          args.targetUid = String(Number(args.targetUid) + 1)
        }],
        ['gid', args => {
          args.targetGid = String(Number(args.targetGid) + 1)
        }],
        ['digest', args => { args.sha256 = digest(Buffer.from('forged')) }],
        ['size', args => { args.size = String(Number(args.size) + 1) }]
      ]
      for (const [label, forge] of forgeries) {
        const args = { ...baseArgs }
        forge(args)
        const result = await runPrivilegedRequest(shell, {
          operation: 'remove-bound',
          args
        })
        assert.notEqual(result.exitCode, 0, label)
        assert.deepEqual(fixture.statRootPath(targetPath), before, label)
        assert.deepEqual(
          fixture.readRootBuffer(targetPath),
          beforeContent,
          label
        )
      }
    })
  })

  await t.test('rename cannot clobber a preexisting target', async () => {
    await withPrivilegedFixture(async ({ fixture, shell }) => {
      const sourcePath = '/root-only/app.conf'
      const targetPath = '/root-only/preexisting.conf'
      fixture.writeRootFile(targetPath, 'foreign=true\n')
      const source = fixture.statRootPath(sourcePath)
      const sourceContent = fixture.readRootBuffer(sourcePath)
      const target = fixture.statRootPath(targetPath)
      const targetContent = fixture.readRootBuffer(targetPath)
      const result = await runPrivilegedRequest(shell, {
        operation: 'rename-bound',
        args: {
          sourcePath,
          ...parentProof(fixture, sourcePath, 'source', { trust: true }),
          ...entryProof(source, 'source'),
          targetPath,
          ...parentProof(fixture, targetPath, 'target', { trust: true })
        }
      })
      assert.notEqual(result.exitCode, 0)
      assert.deepEqual(fixture.statRootPath(sourcePath), source)
      assert.deepEqual(fixture.readRootBuffer(sourcePath), sourceContent)
      assert.deepEqual(fixture.statRootPath(targetPath), target)
      assert.deepEqual(fixture.readRootBuffer(targetPath), targetContent)
    })
  })

  await t.test('stage import cannot overwrite a preexisting target', async () => {
    await withPrivilegedFixture(async ({ fixture, shell }) => {
      const rootPath = '/home/shellpilot/.shellpilot-privileged-transfers/proof-test'
      const objectName = 'upload-proof'
      const stagePath = path.posix.join(rootPath, objectName)
      await fs.promises.mkdir(fixture.resolve(rootPath), {
        recursive: true,
        mode: 0o700
      })
      await fs.promises.chmod(fixture.resolve(rootPath), 0o700)
      const staged = Buffer.from('must not overwrite\n')
      await fs.promises.writeFile(fixture.resolve(stagePath), staged, {
        flag: 'wx',
        mode: 0o600
      })
      await fs.promises.chmod(fixture.resolve(stagePath), 0o600)
      const rootStats = await fs.promises.stat(fixture.resolve(rootPath))
      const targetPath = '/root-only/app.conf'
      const before = fixture.statRootPath(targetPath)
      const beforeContent = fixture.readRootBuffer(targetPath)
      const result = await runPrivilegedRequest(shell, {
        operation: 'stage-import',
        args: {
          rootPath,
          rootRealPath: rootPath,
          rootDevice: String(rootStats.dev || 1),
          rootInode: String(rootStats.ino || 1),
          rootUid: String(rootStats.uid || 0),
          rootGid: String(rootStats.gid || 0),
          rootMode: '700',
          objectName,
          targetPath,
          sha256: digest(staged),
          size: String(staged.length),
          targetMode: '600',
          targetUid: '0',
          targetGid: '0',
          mustBeAbsent: '1',
          ...parentProof(fixture, targetPath, 'target', { trust: true }),
          targetDevice: '0',
          targetInode: '0'
        }
      })
      assert.notEqual(result.exitCode, 0)
      assert.deepEqual(fixture.statRootPath(targetPath), before)
      assert.deepEqual(fixture.readRootBuffer(targetPath), beforeContent)
    })
  })
})

test('local SSH fixture close cancels and joins active privileged handlers', async () => {
  const fixture = await createLocalSftpFixture()
  const server = await startLocalSshServer({
    managedPtyTasks: true,
    sftpRoot: fixture.root,
    sftpFixture: fixture,
    rootDownloadDelayMs: 750
  })
  let client
  try {
    client = await connectClient(server)
    const shell = await openRootFixtureShell(server, client)
    const rootPath = '/home/shellpilot/.shellpilot-privileged-transfers/close-test'
    await fs.promises.mkdir(fixture.resolve(rootPath), {
      recursive: true,
      mode: 0o700
    })
    await fs.promises.chmod(fixture.resolve(rootPath), 0o700)
    const rootStats = await fs.promises.stat(fixture.resolve(rootPath))
    const sourcePath = '/root-only/cancel.bin'
    const source = fixture.statRootPath(sourcePath)
    const token = privilegedTokenSequence.toString(16).padStart(32, '0')
    privilegedTokenSequence += 1
    shell.stream.write(buildPrivilegedFileCommand({
      token,
      request: {
        operation: 'stage-export',
        args: {
          rootPath,
          rootRealPath: rootPath,
          rootDevice: String(rootStats.dev || 1),
          rootInode: String(rootStats.ino || 1),
          rootUid: String(rootStats.uid || 0),
          rootGid: String(rootStats.gid || 0),
          rootMode: '700',
          objectName: 'close-download',
          sourcePath,
          ...parentProof(fixture, sourcePath, 'source'),
          sourceDevice: String(source.device),
          sourceInode: String(source.inode),
          expectedSize: String(source.content.length),
          maxSize: String(source.content.length)
        }
      }
    }) + '\r')
    await waitFor(() => server.state.privilegedFileRequests.some(
      request => request.token === token && request.stageReady === true
    ))
    client.end()
    client = null
    await server.close()
    assert.equal(server.state.activePrivilegedHandlers, 0)
    assert.equal(server.state.activePrivilegedRequests, 0)
    assert.equal(server.state.activeFixtureTimers, 0)
    assert.equal(server.state.cancelledPrivilegedFileRequests.some(
      request => request.token === token
    ), true)
    assert.deepEqual(await fixture.listStagingFiles(), [])
  } finally {
    client?.end()
    await server.close().catch(() => {})
    await fixture.cleanup()
  }
})
