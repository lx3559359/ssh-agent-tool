const { once } = require('node:events')
const { createHash, generateKeyPairSync } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')
const { Server, utils } = require('@electerm/ssh2')
const { resolveVirtualPath } = require('./local-sftp-fixture')

const TEST_USERNAME = 'shellpilot-e2e'
const TEST_PASSWORD = 'shellpilot-e2e-password'
const { privateKey: HOST_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: 'pkcs1',
    format: 'pem'
  },
  publicKeyEncoding: {
    type: 'pkcs1',
    format: 'pem'
  }
})

const execResults = Object.freeze({
  pwd: ['/home/shellpilot\n', 0],
  'ip addr': ['1: lo: <LOOPBACK,UP>\n2: eth0: <BROADCAST,UP>\n', 0],
  'ip route show': ['default via 192.0.2.1 dev eth0\n', 0],
  'uname -s': ['Linux\n', 0],
  'cat /proc/loadavg': ['0.00 0.01 0.05 1/100 1234\n', 0],
  'systemctl show --no-pager --property=LoadState,ActiveState,SubState,UnitFileState nginx': [
    'LoadState=loaded\nActiveState=active\nSubState=running\n',
    0
  ]
})

function writePrompt (stream) {
  stream.write('\r\n$ ')
}

function osc633 (nonce, type, payload = '') {
  return `\u001b]633;${type};${nonce}${payload ? `;${payload}` : ''}\u0007`
}

function writeTrackedPrompt (stream, nonce, { leadingNewline = false } = {}) {
  stream.write(
    (leadingNewline ? '\r\n\u001b[2J\u001b[H' : '') +
    osc633(nonce, 'P', 'Cwd=/home/shellpilot') +
    osc633(nonce, 'A') +
    '$ ' +
    osc633(nonce, 'B')
  )
}

function managedPtyMarker (token, phase, ...fields) {
  return `\u001b]697;SHELLPILOT_OPS;${token};${phase};${fields.join(';')}\u0007`
}

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

const privilegedCapabilities = [
  'sh', 'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
  'procFd', 'noclobber', 'cat', 'gnuStat', 'gnuMv', 'realpath', 'readlink',
  'chown', 'chmod', 'rm', 'rmdir', 'find', 'head', 'wc', 'gnuDd', 'mkfifo',
  'touch'
].map(name => `${name}=1`).join(',')

const privilegedArgumentNames = Object.freeze({
  PATH: 'path',
  ROOT_PATH: 'rootPath',
  ROOT_REAL_PATH: 'rootRealPath',
  ROOT_DEVICE: 'rootDevice',
  ROOT_INODE: 'rootInode',
  ROOT_UID: 'rootUid',
  ROOT_GID: 'rootGid',
  ROOT_MODE: 'rootMode',
  CHALLENGE_NAME: 'challengeName',
  RESPONSE_NAME: 'responseName',
  CHALLENGE: 'challenge',
  CHALLENGE_SIZE: 'challengeSize',
  OBJECT_NAME: 'objectName',
  SOURCE_PATH: 'sourcePath',
  SOURCE_PARENT_REAL_PATH: 'sourceParentRealPath',
  SOURCE_PARENT_DEVICE: 'sourceParentDevice',
  SOURCE_PARENT_INODE: 'sourceParentInode',
  SOURCE_PARENT_UID: 'sourceParentUid',
  SOURCE_PARENT_MODE: 'sourceParentMode',
  SOURCE_DEVICE: 'sourceDevice',
  SOURCE_INODE: 'sourceInode',
  SOURCE_TYPE: 'sourceType',
  TARGET_PATH: 'targetPath',
  TEMP_PATH: 'tempPath',
  TEMP_PARENT_REAL_PATH: 'tempParentRealPath',
  TEMP_PARENT_DEVICE: 'tempParentDevice',
  TEMP_PARENT_INODE: 'tempParentInode',
  TEMP_PARENT_UID: 'tempParentUid',
  TEMP_PARENT_MODE: 'tempParentMode',
  SHA256: 'sha256',
  SIZE: 'size',
  TARGET_MODE: 'targetMode',
  TARGET_UID: 'targetUid',
  TARGET_GID: 'targetGid',
  MUST_BE_ABSENT: 'mustBeAbsent',
  TARGET_PARENT_REAL_PATH: 'targetParentRealPath',
  TARGET_PARENT_DEVICE: 'targetParentDevice',
  TARGET_PARENT_INODE: 'targetParentInode',
  TARGET_PARENT_UID: 'targetParentUid',
  TARGET_PARENT_MODE: 'targetParentMode',
  TARGET_DEVICE: 'targetDevice',
  TARGET_INODE: 'targetInode',
  TARGET_TYPE: 'targetType',
  PEER_PATH: 'peerPath',
  PEER_PARENT_REAL_PATH: 'peerParentRealPath',
  PEER_PARENT_DEVICE: 'peerParentDevice',
  PEER_PARENT_INODE: 'peerParentInode',
  PEER_DEVICE: 'peerDevice',
  PEER_INODE: 'peerInode',
  PEER_TYPE: 'peerType',
  PEER_MODE: 'peerMode',
  PEER_UID: 'peerUid',
  PEER_GID: 'peerGid',
  PEER_SHA256: 'peerSha256',
  PEER_SIZE: 'peerSize',
  INITIAL_MODE: 'initialMode',
  INITIAL_UID: 'initialUid',
  INITIAL_GID: 'initialGid',
  EXPECTED_SIZE: 'expectedSize',
  MAX_SIZE: 'maxSize',
  OFFSET: 'offset',
  MAX_BYTES: 'maxBytes'
})

function privilegedFileMarker (token, phase, ...fields) {
  return `\u001b]698;SHELLPILOT_FILE;${token};${phase};${fields.join(';')}\u0007`
}

function privilegedOperationFrom (body, args) {
  if (Object.keys(args).length === 0 && body.trim() === ':') return 'probe'
  if (args.challengeName) return 'stage-handshake'
  if (args.tempPath) return 'stage-import-cleanup'
  if (args.mustBeAbsent) return 'stage-import'
  if (args.peerPath) return 'remove-peer-bound'
  if (args.sourcePath && args.targetPath) return 'rename-bound'
  if (args.targetPath && args.sha256 && args.size) return 'remove-bound'
  if (args.targetPath && args.targetMode && args.targetDevice) return 'metadata-bound'
  if (args.targetPath && args.targetDevice) return 'touch-bound'
  if (args.targetPath && args.targetMode) return 'mkdir-bound'
  if (args.sourcePath && args.objectName && args.offset) return 'stage-export-range'
  if (args.sourcePath && args.objectName) return 'stage-export'
  if (args.path && args.objectName && args.offset) return 'sha256-range-bound'
  if (args.path && args.objectName) return 'sha256-bound'
  if (args.objectName && args.sha256 && args.size) return 'stage-cleanup'
  if (args.objectName) return 'digest-cleanup'
  if (args.sourceParentDevice && body.includes('__sp_emit_entry')) return 'list-bound'
  if (args.sourceParentDevice && body.includes('missing')) return 'lstat-bound'
  if (body.includes('__sp_emit_entry')) return 'list'
  if (body.includes('missing')) return 'lstat'
  if (body.includes('__sp_emit_stat')) return 'stat'
  if (body.includes('readlink --')) return 'readlink'
  if (body.includes('realpath --')) return 'realpath'
  if (body.trim() === 'return 1') return 'sha256'
  return null
}

function parsePrivilegedFileCommand (command) {
  const token = /SHELLPILOT_TOKEN='([a-f0-9]{32,128})'/.exec(command)?.[1]
  if (!token || !command.includes('SHELLPILOT_FILE')) return null
  const args = {}
  const argumentPattern = /SHELLPILOT_ARG_([A-Z0-9_]+)='([A-Za-z0-9+/=]+)'/g
  for (const match of command.matchAll(argumentPattern)) {
    const key = privilegedArgumentNames[match[1]]
    if (!key) continue
    args[key] = Buffer.from(match[2], 'base64').toString('utf8')
  }
  const body = /__sp_run_operation\(\) \{ ([\s\S]*); \}; __sp_status=125;/.exec(command)?.[1] || ''
  const operation = privilegedOperationFrom(body, args)
  return operation ? { token, operation, args, body } : null
}

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

function rootMetadata (fixture, remotePath, entry, includeBinding = true) {
  const parentPath = remotePath === '/' ? '/' : path.posix.dirname(remotePath)
  const parent = fixture.statRootPath(parentPath)
  const type = entry.type === 'directory' ? 0x4000 : 0x8000
  const size = entry.type === 'file' ? entry.content.length : 0
  const metadata = [
    (type | entry.mode).toString(16), size, entry.atime, entry.mtime,
    entry.uid, entry.gid
  ]
  if (includeBinding) {
    metadata.push(entry.device, entry.inode, parent.device, parent.inode)
  }
  return metadata.join(';')
}

async function stagingMetadata (fixture, remotePath) {
  const localPath = fixture.resolve(remotePath)
  const parentPath = path.posix.dirname(remotePath)
  const [stats, parent] = await Promise.all([
    fs.promises.lstat(localPath),
    fs.promises.lstat(fixture.resolve(parentPath))
  ])
  const type = stats.isDirectory() ? 0x4000 : 0x8000
  const mode = stats.isDirectory() ? 0o700 : 0o600
  return [
    (type | mode).toString(16),
    stats.isFile() ? stats.size : 0,
    Math.floor(stats.atimeMs / 1000),
    Math.floor(stats.mtimeMs / 1000),
    String(stats.uid || 0),
    String(stats.gid || 0),
    String(stats.dev || 1),
    String(stats.ino || 1),
    String(parent.dev || 1),
    String(parent.ino || 1)
  ].join(';')
}

async function protocolMetadata (fixture, remotePath) {
  if (fixture.isStagingPath(remotePath)) {
    return stagingMetadata(fixture, remotePath)
  }
  const entry = fixture.getRootEntry(remotePath)
  return entry ? rootMetadata(fixture, remotePath, entry) : null
}

async function readProtocolBuffer (fixture, remotePath) {
  return fixture.isStagingPath(remotePath)
    ? fs.promises.readFile(fixture.resolve(remotePath))
    : fixture.readRootBuffer(remotePath)
}

function fixtureProofError (label) {
  const error = new Error(`OSC 698 fixture proof mismatch: ${label}`)
  error.code = 'FIXTURE_PROOF_MISMATCH'
  return error
}

function requireFixtureProof (condition, label) {
  if (!condition) throw fixtureProofError(label)
}

function fixtureMode (entry) {
  return Number(entry.mode).toString(8)
}

function assertRootParentProof (fixture, entryPath, args, prefix, trust = false) {
  const parentPath = path.posix.dirname(entryPath)
  const parent = fixture.statRootPath(parentPath)
  requireFixtureProof(parent.type === 'directory', `${prefix} parent type`)
  requireFixtureProof(parent.uid === 0, `${prefix} parent uid`)
  requireFixtureProof((parent.mode & 0o22) === 0, `${prefix} parent mode`)
  requireFixtureProof(
    args[`${prefix}ParentRealPath`] === parentPath,
    `${prefix} parent path`
  )
  requireFixtureProof(
    String(args[`${prefix}ParentDevice`]) === String(parent.device),
    `${prefix} parent device`
  )
  requireFixtureProof(
    String(args[`${prefix}ParentInode`]) === String(parent.inode),
    `${prefix} parent inode`
  )
  if (trust) {
    requireFixtureProof(
      String(args[`${prefix}ParentUid`]) === String(parent.uid),
      `${prefix} parent trusted uid`
    )
    requireFixtureProof(
      args[`${prefix}ParentMode`] === fixtureMode(parent),
      `${prefix} parent trusted mode`
    )
  }
  return parent
}

function assertRootEntryProof (fixture, entryPath, args, prefix) {
  const entry = fixture.statRootPath(entryPath)
  requireFixtureProof(
    String(args[`${prefix}Device`]) === String(entry.device),
    `${prefix} device`
  )
  requireFixtureProof(
    String(args[`${prefix}Inode`]) === String(entry.inode),
    `${prefix} inode`
  )
  if (Object.hasOwn(args, `${prefix}Type`)) {
    requireFixtureProof(
      args[`${prefix}Type`] === entry.type,
      `${prefix} type`
    )
  }
  return entry
}

async function assertProtocolParentProof (fixture, entryPath, args, prefix) {
  if (!fixture.isStagingPath(entryPath)) {
    return assertRootParentProof(fixture, entryPath, args, prefix)
  }
  const parentPath = path.posix.dirname(entryPath)
  const parent = await fs.promises.lstat(fixture.resolve(parentPath))
  requireFixtureProof(parent.isDirectory(), `${prefix} stage parent type`)
  requireFixtureProof(
    args[`${prefix}ParentRealPath`] === parentPath,
    `${prefix} stage parent path`
  )
  requireFixtureProof(
    String(args[`${prefix}ParentDevice`]) === String(parent.dev || 1),
    `${prefix} stage parent device`
  )
  requireFixtureProof(
    String(args[`${prefix}ParentInode`]) === String(parent.ino || 1),
    `${prefix} stage parent inode`
  )
  return parent
}

async function assertProtocolEntryProof (fixture, entryPath, args, prefix) {
  if (!fixture.isStagingPath(entryPath)) {
    return assertRootEntryProof(fixture, entryPath, args, prefix)
  }
  const entry = await fs.promises.lstat(fixture.resolve(entryPath))
  requireFixtureProof(
    String(args[`${prefix}Device`]) === String(entry.dev || 1),
    `${prefix} stage device`
  )
  requireFixtureProof(
    String(args[`${prefix}Inode`]) === String(entry.ino || 1),
    `${prefix} stage inode`
  )
  return entry
}

function assertRootRemovalProof (fixture, entryPath, args, prefix, digestKey, sizeKey) {
  assertRootParentProof(fixture, entryPath, args, prefix)
  const entry = assertRootEntryProof(fixture, entryPath, args, prefix)
  requireFixtureProof(
    args[`${prefix}Mode`] === fixtureMode(entry),
    `${prefix} mode`
  )
  requireFixtureProof(
    String(args[`${prefix}Uid`]) === String(entry.uid),
    `${prefix} uid`
  )
  requireFixtureProof(
    String(args[`${prefix}Gid`]) === String(entry.gid),
    `${prefix} gid`
  )
  const expectedSize = entry.type === 'file' ? entry.content.length : 0
  const expectedDigest = entry.type === 'file'
    ? sha256(entry.content)
    : '0'.repeat(64)
  requireFixtureProof(
    String(args[sizeKey]) === String(expectedSize),
    `${prefix} size`
  )
  requireFixtureProof(args[digestKey] === expectedDigest, `${prefix} digest`)
  return entry
}

async function assertStageRootProof (fixture, args) {
  requireFixtureProof(args.rootRealPath === args.rootPath, 'stage root path')
  requireFixtureProof(fixture.isStagingPath(args.rootPath), 'stage root namespace')
  const metadata = await fixture.statStagingPath(args.rootPath)
  requireFixtureProof(metadata.type === 'directory', 'stage root type')
  requireFixtureProof(String(args.rootDevice) === String(metadata.device), 'stage root device')
  requireFixtureProof(String(args.rootInode) === String(metadata.inode), 'stage root inode')
  requireFixtureProof(String(args.rootUid) === String(metadata.uid), 'stage root uid')
  requireFixtureProof(String(args.rootGid) === String(metadata.gid), 'stage root gid')
  requireFixtureProof(args.rootMode === fixtureMode(metadata), 'stage root mode')
  return metadata
}

async function assertStageObjectProof (fixture, args, { allowAbsent = false } = {}) {
  await assertStageRootProof(fixture, args)
  const objectPath = path.posix.join(args.rootPath, args.objectName)
  let stats
  try {
    stats = await fs.promises.lstat(fixture.resolve(objectPath))
  } catch (error) {
    if (allowAbsent && error?.code === 'ENOENT') {
      return { content: null, objectPath, missing: true }
    }
    throw error
  }
  requireFixtureProof(stats.isFile(), 'stage object type')
  const content = await fs.promises.readFile(fixture.resolve(objectPath))
  requireFixtureProof(String(args.size) === String(content.length), 'stage object size')
  requireFixtureProof(args.sha256 === sha256(content), 'stage object digest')
  return { content, objectPath }
}

function writePrivilegedData (stream, request, sequence, total, kind, ...fields) {
  stream.write(privilegedFileMarker(
    request.token,
    'data',
    String(sequence),
    String(total),
    kind,
    ...fields.map(encodeMarkerField)
  ))
}

function finishShellCommand (stream, nonce, status = 0, scheduleTimer = setTimeout) {
  if (nonce) {
    stream.write(osc633(nonce, 'D', String(status)))
    scheduleTimer(() => {
      if (!stream.destroyed) {
        writeTrackedPrompt(stream, nonce, { leadingNewline: true })
      }
    }, 20)
  } else {
    stream.write('$ ')
  }
}

function parseManagedPtyCommand (command) {
  const token = /__sp_token='([a-f0-9]{32,128})'/.exec(command)?.[1]
  const encodedScript = /__sp_script='([A-Za-z0-9+/=]+)'/.exec(command)?.[1]
  if (!token || !encodedScript) return null
  return {
    token,
    script: Buffer.from(encodedScript, 'base64').toString('utf8')
  }
}

function operationsDiscoveryOutput (script) {
  const nonce = /__SHELLPILOT_OPERATIONS_BEGIN__:([a-zA-Z0-9_-]{16,128})/
    .exec(script)?.[1]
  if (!nonce) return ''
  return [
    `__SHELLPILOT_OPERATIONS_BEGIN__:${nonce}`,
    'os.id=shellpilot-fixture',
    'os.idLike=debian',
    'os.version=1',
    'kernel=6.8.0-fixture',
    'arch=x86_64',
    'init=systemd',
    'tool=awk',
    'tool=df',
    'tool=free',
    'tool=ip',
    'tool=systemctl',
    'tool=tcpdump',
    'interface=eth0|UP||1500',
    'interface-address=eth0|192.0.2.10/24',
    'route=eth0|192.0.2.1',
    'service=nginx.service|loaded|active|enabled',
    `__SHELLPILOT_OPERATIONS_END__:${nonce}`,
    ''
  ].join('\r\n')
}

function writeManagedPtyResult (
  stream,
  managed,
  state,
  sessionId,
  shellState
) {
  const identity = { ...shellState.identity }
  state.managedPtyScripts.push({
    sessionId,
    token: managed.token,
    script: managed.script,
    identity
  })
  stream.write(managedPtyMarker(
    managed.token,
    'start',
    encodeMarkerField(identity.uid),
    encodeMarkerField(identity.username)
  ))
  const discovery = operationsDiscoveryOutput(managed.script)
  stream.write(discovery || (
    `managed_user=${identity.username} managed_uid=${identity.uid}\r\n`
  ))
  stream.write(managedPtyMarker(managed.token, 'end', '0'))
}

async function writePrivilegedFileResult (
  stream,
  request,
  state,
  sessionId,
  shellState,
  options,
  nonce
) {
  const fixture = options.sftpFixture
  const identity = { ...shellState.identity }
  const record = {
    sessionId,
    token: request.token,
    operation: request.operation,
    args: { ...request.args },
    identity
  }
  state.privilegedFileRequests.push(record)
  let activeStagePath = ''
  let delayResolve
  let delayTimer
  let cancellationResolve
  let cancelled = false
  const cancellationDone = new Promise(resolve => {
    cancellationResolve = resolve
  })
  const activeRequest = {
    token: request.token,
    cancel: () => {
      if (cancelled || shellState.activePrivilegedRequest !== activeRequest) {
        return false
      }
      cancelled = true
      options.clearFixtureTimer?.(delayTimer)
      delayResolve?.()
      Promise.resolve()
        .then(async () => {
          if (activeStagePath) {
            await options.removePrivilegedStagePath(activeStagePath)
            fixture?.stagingCleanups.push({
              operation: request.operation,
              path: request.args.rootPath,
              objectName: request.args.objectName,
              cancelled: true
            })
          }
          record.cancelled = true
          state.cancelledPrivilegedFileRequests.push(record)
        })
        .catch(error => {
          record.cancellationError = error?.stack || error?.message || String(error)
          options.recordPrivilegedCleanupError?.(error)
        })
        .finally(() => {
          if (shellState.activePrivilegedRequest === activeRequest) {
            shellState.activePrivilegedRequest = null
          }
          options.unregisterPrivilegedRequest?.(activeRequest)
          if (!stream.destroyed) {
            stream.write(privilegedFileMarker(request.token, 'end', '130'))
            finishShellCommand(
              stream,
              nonce,
              130,
              options.scheduleFixtureTimer
            )
          }
          cancellationResolve()
        })
      return true
    }
  }
  shellState.activePrivilegedRequest = activeRequest
  options.registerPrivilegedRequest?.(activeRequest)
  stream.write(privilegedFileMarker(
    request.token,
    'start',
    encodeMarkerField(identity.uid),
    encodeMarkerField(identity.username),
    encodeMarkerField(privilegedCapabilities)
  ))
  let exitCode = fixture ? 0 : 1
  try {
    const { args, operation } = request
    if (exitCode !== 0 || (identity.uid !== '0' && operation !== 'probe')) {
      throw new Error('root identity required')
    }
    if (operation === 'probe') {
      // The protocol boundary and identity are the probe result.
    } else if (operation === 'list' || operation === 'list-bound') {
      if (operation === 'list-bound') {
        await assertProtocolParentProof(fixture, args.path, args, 'source')
        await assertProtocolEntryProof(fixture, args.path, args, 'source')
      }
      const entries = fixture.listRootDirectory(args.path)
      entries.forEach((entry, index) => {
        writePrivilegedData(
          stream,
          request,
          index + 1,
          entries.length,
          'entry',
          entry.name,
          rootMetadata(
            fixture,
            path.posix.join(args.path, entry.name),
            entry,
            false
          )
        )
      })
    } else if (operation === 'lstat' || operation === 'lstat-bound' || operation === 'stat') {
      if (operation === 'lstat-bound') {
        await assertProtocolParentProof(fixture, args.path, args, 'source')
      }
      let metadata
      try {
        metadata = await protocolMetadata(fixture, args.path)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (!metadata && operation !== 'stat') {
        writePrivilegedData(stream, request, 1, 1, 'missing', '1')
      } else if (!metadata) {
        exitCode = 1
      } else {
        writePrivilegedData(
          stream,
          request,
          1,
          1,
          'metadata',
          metadata
        )
      }
    } else if (operation === 'readlink' || operation === 'realpath') {
      fixture.statRootPath(args.path)
      writePrivilegedData(stream, request, 1, 1, 'text', args.path)
    } else if (operation === 'mkdir-bound') {
      assertRootParentProof(fixture, args.targetPath, args, 'target', true)
      requireFixtureProof(
        fixture.getRootEntry(args.targetPath) === null,
        'mkdir target must be absent'
      )
      const entry = fixture.mkdirRootDirectory(args.targetPath, {
        mode: Number.parseInt(args.targetMode, 8),
        uid: Number(args.targetUid),
        gid: Number(args.targetGid)
      })
      writePrivilegedData(
        stream,
        request,
        1,
        1,
        'binding',
        String(entry.device),
        String(entry.inode)
      )
    } else if (operation === 'metadata-bound') {
      assertRootParentProof(fixture, args.targetPath, args, 'target', true)
      assertRootEntryProof(fixture, args.targetPath, args, 'target')
      fixture.chmodRootPath(
        args.targetPath,
        Number.parseInt(args.targetMode, 8),
        { uid: Number(args.targetUid), gid: Number(args.targetGid) }
      )
    } else if (operation === 'touch-bound') {
      assertRootParentProof(fixture, args.targetPath, args, 'target', true)
      assertRootEntryProof(fixture, args.targetPath, args, 'target')
      fixture.touchRootPath(args.targetPath)
    } else if (operation === 'rename-bound') {
      assertRootParentProof(fixture, args.sourcePath, args, 'source', true)
      const source = assertRootEntryProof(
        fixture,
        args.sourcePath,
        args,
        'source'
      )
      const targetParent = assertRootParentProof(
        fixture,
        args.targetPath,
        args,
        'target',
        true
      )
      requireFixtureProof(
        fixture.getRootEntry(args.targetPath) === null,
        'rename target must be absent'
      )
      requireFixtureProof(
        String(source.device) === String(targetParent.device),
        'rename target filesystem'
      )
      fixture.renameRootPath(args.sourcePath, args.targetPath)
    } else if (operation === 'remove-bound' || operation === 'remove-peer-bound') {
      assertRootRemovalProof(
        fixture,
        args.targetPath,
        args,
        'target',
        'sha256',
        'size'
      )
      if (operation === 'remove-peer-bound') {
        assertRootRemovalProof(
          fixture,
          args.peerPath,
          args,
          'peer',
          'peerSha256',
          'peerSize'
        )
      }
      fixture.removeRootPath(args.targetPath)
      if (operation === 'remove-peer-bound') fixture.removeRootPath(args.peerPath)
    } else if (operation === 'stage-handshake') {
      const challengePath = fixture.resolve(path.posix.join(args.rootPath, args.challengeName))
      const responsePath = fixture.resolve(path.posix.join(args.rootPath, args.responseName))
      requireFixtureProof(fixture.isStagingPath(args.rootPath), 'handshake root namespace')
      const rootMetadata = await fixture.statStagingPath(args.rootPath)
      requireFixtureProof(rootMetadata.type === 'directory', 'handshake root type')
      requireFixtureProof(args.rootMode === fixtureMode(rootMetadata), 'handshake root mode')
      requireFixtureProof(String(args.rootUid) === String(rootMetadata.uid), 'handshake root uid')
      requireFixtureProof(String(args.rootGid) === String(rootMetadata.gid), 'handshake root gid')
      const challengeBytes = await fs.promises.readFile(challengePath)
      fixture.stagingReads.push({ operation, path: args.rootPath, objectName: args.challengeName })
      requireFixtureProof(String(args.challengeSize) === String(challengeBytes.length), 'handshake challenge size')
      if (sha256(challengeBytes) !== args.challenge) throw new Error('stage challenge mismatch')
      const response = sha256(`${args.challenge}:root`)
      await fs.promises.writeFile(responsePath, response, { flag: 'wx', mode: 0o600 })
      await fs.promises.chmod(responsePath, 0o600)
      fixture.stagingWrites.push({ operation, path: args.rootPath, objectName: args.responseName })
      writePrivilegedData(
        stream,
        request,
        1,
        1,
        'handshake',
        response,
        String(rootMetadata.uid),
        String(rootMetadata.gid),
        fixtureMode(rootMetadata),
        args.rootPath,
        String(rootMetadata.device),
        String(rootMetadata.inode)
      )
    } else if (operation === 'stage-export' || operation === 'stage-export-range') {
      await assertStageRootProof(fixture, args)
      assertRootParentProof(fixture, args.sourcePath, args, 'source')
      const source = assertRootEntryProof(
        fixture,
        args.sourcePath,
        args,
        'source'
      )
      requireFixtureProof(source.type === 'file', 'export source type')
      let content = fixture.readRootBuffer(args.sourcePath)
      requireFixtureProof(
        String(args.expectedSize) === String(content.length),
        'export source size'
      )
      requireFixtureProof(
        content.length <= Number(args.maxSize),
        'export source max size'
      )
      if (operation === 'stage-export-range') {
        const offset = Number(args.offset)
        content = content.subarray(offset, offset + Number(args.maxBytes))
      }
      const stagePath = fixture.resolve(path.posix.join(args.rootPath, args.objectName))
      activeStagePath = stagePath
      await fs.promises.writeFile(stagePath, content, { flag: 'wx', mode: 0o600 })
      await fs.promises.chmod(stagePath, 0o600)
      fixture.stagingWrites.push({ operation, path: args.rootPath, objectName: args.objectName, size: content.length })
      record.stageReady = true
      if (operation === 'stage-export' &&
        args.sourcePath === '/root-only/cancel.bin') {
        await new Promise(resolve => {
          delayResolve = resolve
          delayTimer = options.scheduleFixtureTimer(
            resolve,
            Number(options.rootDownloadDelayMs ?? 5000)
          )
        })
        delayResolve = null
        if (cancelled) {
          await cancellationDone
          return
        }
      }
      writePrivilegedData(stream, request, 1, 1, 'digest', sha256(content), String(content.length))
    } else if (operation === 'stage-import') {
      const { content, objectPath } = await assertStageObjectProof(fixture, args)
      const stagePath = fixture.resolve(objectPath)
      fixture.stagingReads.push({ operation, path: args.rootPath, objectName: args.objectName, size: content.length })
      assertRootParentProof(fixture, args.targetPath, args, 'target', true)
      requireFixtureProof(args.mustBeAbsent === '1', 'import mustBeAbsent')
      requireFixtureProof(args.targetDevice === '0', 'import absent device')
      requireFixtureProof(args.targetInode === '0', 'import absent inode')
      requireFixtureProof(
        fixture.getRootEntry(args.targetPath) === null,
        'import target must be absent'
      )
      const entry = fixture.writeRootFile(args.targetPath, content, {
        mode: Number.parseInt(args.targetMode, 8),
        uid: Number(args.targetUid),
        gid: Number(args.targetGid)
      })
      await fs.promises.unlink(stagePath)
      fixture.stagingCleanups.push({ operation, path: args.rootPath, objectName: args.objectName })
      writePrivilegedData(stream, request, 1, 1, 'temp-claim', String(entry.device), String(entry.inode))
      writePrivilegedData(stream, request, 1, 1, 'moving', String(entry.device), String(entry.inode), String(args.rootGid || 0))
      writePrivilegedData(
        stream,
        request,
        1,
        1,
        'installed',
        args.sha256,
        args.size,
        String(entry.device),
        String(entry.inode),
        Number(entry.mode).toString(8),
        String(entry.uid),
        String(entry.gid)
      )
      writePrivilegedData(stream, request, 1, 1, 'import-cleanup', '1', 'complete')
    } else if (operation === 'stage-import-cleanup') {
      writePrivilegedData(stream, request, 1, 1, 'import-cleanup', '1', 'none')
    } else if (operation === 'stage-cleanup') {
      const { objectPath, missing } = await assertStageObjectProof(
        fixture,
        args,
        { allowAbsent: true }
      )
      const stagePath = fixture.resolve(objectPath)
      if (!missing) await fs.promises.rm(stagePath, { force: true })
      fixture.stagingCleanups.push({ operation, path: args.rootPath, objectName: args.objectName })
    } else if (operation === 'digest-cleanup') {
      fixture.stagingCleanups.push({ operation, path: args.rootPath, objectName: args.objectName })
    } else if (['sha256-bound', 'sha256-range-bound', 'sha256'].includes(operation)) {
      if (operation !== 'sha256') {
        await assertStageRootProof(fixture, args)
        await assertProtocolParentProof(fixture, args.path, args, 'source')
        const source = await assertProtocolEntryProof(
          fixture,
          args.path,
          args,
          'source'
        )
        const sourceContent = await readProtocolBuffer(fixture, args.path)
        requireFixtureProof(
          fixture.isStagingPath(args.path) ? source.isFile() : source.type === 'file',
          'digest source type'
        )
        requireFixtureProof(
          String(args.expectedSize) === String(sourceContent.length),
          'digest source size'
        )
        requireFixtureProof(
          sourceContent.length <= Number(args.maxSize),
          'digest source max size'
        )
      }
      let content = await readProtocolBuffer(fixture, args.path)
      if (operation === 'sha256-range-bound') {
        const offset = Number(args.offset)
        content = content.subarray(offset, offset + Number(args.maxBytes))
      }
      writePrivilegedData(stream, request, 1, 1, 'digest', sha256(content), String(content.length))
    } else {
      exitCode = 1
    }
  } catch (error) {
    if (cancelled) {
      await cancellationDone
      return
    }
    record.error = error?.stack || error?.message || String(error)
    exitCode = 1
  }
  if (shellState.activePrivilegedRequest === activeRequest) {
    shellState.activePrivilegedRequest = null
  }
  options.unregisterPrivilegedRequest?.(activeRequest)
  stream.write(privilegedFileMarker(request.token, 'end', String(exitCode)))
  finishShellCommand(
    stream,
    nonce,
    exitCode,
    options.scheduleFixtureTimer
  )
}

function runCommand (stream, command, state, sessionId, shellState, options) {
  const integration = command.match(/__e_nonce=[\s\S]*?([a-f0-9]{32})/)
  if (integration) {
    shellState.shellIntegrationNonce = integration[1]
    shellState.shellIntegrationActive = true
    state.shellIntegrationNonce = shellState.shellIntegrationNonce
    if (/^unset ELECTERM_SHELL_INTEGRATION;/.test(command)) {
      state.shellIntegrationRearms += 1
    }
    // The client intentionally discards the first OSC chunk while ending
    // output suppression. A real shell emits the next prompt separately.
    stream.write(osc633(shellState.shellIntegrationNonce, 'A'))
    options.scheduleFixtureTimer(() => {
      writeTrackedPrompt(stream, shellState.shellIntegrationNonce)
    }, 20)
    return
  }

  state.commands.push(command)
  state.commandEvents.push({ sessionId, command })
  const managed = options.managedPtyTasks
    ? parseManagedPtyCommand(command)
    : null
  const privileged = options.sftpFixture
    ? parsePrivilegedFileCommand(command)
    : null
  const nonce = shellState.shellIntegrationActive
    ? shellState.shellIntegrationNonce
    : ''
  if (nonce) {
    stream.write(
      osc633(nonce, 'E', command.replace(/\\/g, '\\\\').replace(/;/g, '\\x3b')) +
      osc633(nonce, 'C')
    )
  }
  if (command === 'su root') {
    shellState.identity = { uid: '0', username: 'root' }
    shellState.shellIntegrationActive = false
    state.effectiveIdentity = { ...shellState.identity }
    options.scheduleFixtureTimer(() => {
      if (!stream.destroyed) {
        stream.write('root shell active\r\nroot@fixture:# ')
      }
    }, 30)
    return
  }
  if (command === 'exit' && shellState.identity.uid === '0') {
    shellState.identity = {
      uid: String(options.loginUid || 1000),
      username: options.loginUsername || TEST_USERNAME
    }
    state.effectiveIdentity = { ...shellState.identity }
    stream.write('login shell active\r\n')
  } else if (managed) {
    writeManagedPtyResult(
      stream,
      managed,
      state,
      sessionId,
      shellState
    )
  } else if (privileged) {
    const handler = writePrivilegedFileResult(
      stream,
      privileged,
      state,
      sessionId,
      shellState,
      options,
      nonce
    )
    options.trackPrivilegedHandler(handler)
    handler.catch(() => finishShellCommand(
      stream,
      nonce,
      1,
      options.scheduleFixtureTimer
    ))
    return
  } else if (command === 'echo shellpilot-e2e') {
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

function attachShell (stream, state, sessionId, options) {
  let line = ''
  let lastWasCarriageReturn = false
  const inputDecoder = new StringDecoder('utf8')
  const shellState = {
    identity: {
      uid: String(options.loginUid || 1000),
      username: options.loginUsername || TEST_USERNAME
    },
    shellIntegrationNonce: '',
    shellIntegrationActive: false
  }
  state.effectiveIdentity = { ...shellState.identity }

  stream.on('error', () => {})
  options.scheduleFixtureTimer(() => {
    if (stream.destroyed) return
    state.shellCount += 1
    stream.write('ShellPilot E2E ready\r\n$ ')
  }, Number(options.initialPromptDelayMs ?? 250))
  const cancelActivePrivilegedRequest = () => {
    shellState.activePrivilegedRequest?.cancel?.()
  }
  stream.once('close', cancelActivePrivilegedRequest)
  stream.once('end', cancelActivePrivilegedRequest)
  stream.on('data', chunk => {
    const input = typeof chunk === 'string'
      ? chunk
      : inputDecoder.write(chunk)
    let echoed = ''
    const flushEcho = () => {
      if (!echoed) return
      stream.write(echoed)
      echoed = ''
    }
    for (const char of input) {
      const code = char.codePointAt(0)
      if (code === 3) {
        flushEcho()
        state.ctrlCCount += 1
        line = ''
        stream.write('^C')
        const cancellationStarted = shellState.activePrivilegedRequest?.cancel?.()
        if (cancellationStarted) {
          // The active bounded request emits its end marker and tracked prompt.
        } else if (shellState.shellIntegrationActive) {
          writeTrackedPrompt(stream, shellState.shellIntegrationNonce)
        } else {
          writePrompt(stream)
        }
        lastWasCarriageReturn = false
        continue
      }
      if (code === 13 || code === 10) {
        if (code === 10 && lastWasCarriageReturn) {
          lastWasCarriageReturn = false
          continue
        }
        flushEcho()
        lastWasCarriageReturn = code === 13
        stream.write('\r\n')
        runCommand(
          stream,
          line.trim(),
          state,
          sessionId,
          shellState,
          options
        )
        line = ''
        continue
      }
      lastWasCarriageReturn = false
      if (code === 8 || code === 127) {
        flushEcho()
        line = line.slice(0, -1)
        stream.write('\b \b')
        continue
      }
      line += char
      echoed += char
    }
    flushEcho()
  })
}

function sftpAttrs (stats, { fixture, remotePath } = {}) {
  const mode = fixture?.isStagingPath(remotePath)
    ? (stats.mode & 0xF000) | (stats.isDirectory() ? 0o700 : 0o600)
    : stats.mode
  return {
    mode,
    uid: stats.uid || 0,
    gid: stats.gid || 0,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  }
}

function sftpLongname (filename, stats) {
  const type = stats.isDirectory()
    ? 'd'
    : stats.isSymbolicLink()
      ? 'l'
      : '-'
  const permissionBits = [
    [0o400, 'r'], [0o200, 'w'], [0o100, 'x'],
    [0o040, 'r'], [0o020, 'w'], [0o010, 'x'],
    [0o004, 'r'], [0o002, 'w'], [0o001, 'x']
  ]
  const permissions = permissionBits
    .map(([bit, label]) => (stats.mode & bit) === bit ? label : '-')
    .join('')
  return `${type}${permissions} 1 ${stats.uid || 0} ${stats.gid || 0} ${stats.size} ${filename}`
}

function sftpStatusForError (error) {
  const status = utils.sftp.STATUS_CODE
  if (error?.code === 'ENOENT') return status.NO_SUCH_FILE
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return status.PERMISSION_DENIED
  return status.FAILURE
}

function openFlags (flags) {
  const mode = utils.sftp.OPEN_MODE
  const translated = utils.sftp.flagsToString(flags)
  if (translated) return translated
  if (flags & mode.APPEND) return flags & mode.READ ? 'a+' : 'a'
  if (flags & mode.TRUNC) return flags & mode.READ ? 'w+' : 'w'
  if (flags & mode.CREAT) return flags & mode.READ ? 'a+' : 'a'
  if (flags & mode.WRITE) return flags & mode.READ ? 'r+' : 'r+'
  return 'r'
}

function attachSftp (sftp, root, state, fixture) {
  const handles = new Map()
  let nextHandle = 1
  const status = utils.sftp.STATUS_CODE
  const makeHandle = value => {
    const handle = Buffer.alloc(4)
    handle.writeUInt32BE(nextHandle++)
    handles.set(handle.toString('hex'), value)
    return handle
  }
  const getHandle = handle => handles.get(handle.toString('hex'))
  const replyError = (reqid, error) => sftp.status(reqid, sftpStatusForError(error))
  const normalizeRemotePath = value => path.posix.normalize(
    '/' + String(value || '/').replace(/\\/g, '/')
  )
  const resolve = value => {
    const remotePath = normalizeRemotePath(value)
    if (fixture?.isRootOnlyPath(remotePath)) {
      state.rootOnlySftpDenials.push(remotePath)
      const error = new Error('Root-only fixture path requires OSC 698')
      error.code = 'EACCES'
      throw error
    }
    return resolveVirtualPath(root, remotePath)
  }
  const attrsFor = (stats, remotePath) => sftpAttrs(stats, {
    fixture,
    remotePath: normalizeRemotePath(remotePath)
  })
  const applyPathAttrs = async (localPath, attrs = {}) => {
    if (Number.isFinite(attrs.size)) await fs.promises.truncate(localPath, attrs.size)
    if (Number.isFinite(attrs.mode)) await fs.promises.chmod(localPath, attrs.mode)
    if (Number.isFinite(attrs.atime) || Number.isFinite(attrs.mtime)) {
      const current = await fs.promises.stat(localPath)
      await fs.promises.utimes(
        localPath,
        Number.isFinite(attrs.atime) ? attrs.atime : current.atime,
        Number.isFinite(attrs.mtime) ? attrs.mtime : current.mtime
      )
    }
  }
  const applyHandleAttrs = async (fd, attrs = {}) => {
    if (Number.isFinite(attrs.size)) await fs.promises.ftruncate(fd, attrs.size)
    if (Number.isFinite(attrs.mode)) await fs.promises.fchmod(fd, attrs.mode)
  }

  state.sftpSessions += 1
  sftp.on('REALPATH', (reqid, givenPath) => {
    const filename = !givenPath || givenPath === '.'
      ? '/home/shellpilot'
      : normalizeRemotePath(givenPath)
    state.sftpEvents.push({ event: 'REALPATH', path: filename })
    try {
      fs.stat(resolve(filename), (error, stats) => {
        if (error) return replyError(reqid, error)
        sftp.name(reqid, [{ filename, longname: sftpLongname(filename, stats), attrs: attrsFor(stats, filename) }])
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  for (const eventName of ['STAT', 'LSTAT']) {
    sftp.on(eventName, (reqid, filename) => {
      state.sftpEvents.push({ event: eventName, path: normalizeRemotePath(filename) })
      try {
        fs[eventName === 'STAT' ? 'stat' : 'lstat'](resolve(filename), (error, stats) => {
          if (error) return replyError(reqid, error)
          state.sftpEvents.push({
            event: `${eventName}_RESULT`,
            path: normalizeRemotePath(filename),
            mode: stats.mode,
            permissions: stats.mode & 0o7777
          })
          sftp.attrs(reqid, attrsFor(stats, filename))
        })
      } catch (error) {
        replyError(reqid, error)
      }
    })
  }
  sftp.on('OPENDIR', (reqid, dirname) => {
    state.sftpEvents.push({ event: 'OPENDIR', path: normalizeRemotePath(dirname) })
    try {
      const localPath = resolve(dirname)
      fs.readdir(localPath, { withFileTypes: true }, async (error, entries) => {
        if (error) return replyError(reqid, error)
        try {
          const records = []
          for (const entry of entries) {
            const stats = await fs.promises.lstat(path.join(localPath, entry.name))
            records.push({
              filename: entry.name,
              longname: sftpLongname(entry.name, stats),
              attrs: attrsFor(stats, path.posix.join(dirname, entry.name))
            })
          }
          sftp.handle(reqid, makeHandle({ type: 'dir', records, sent: false }))
        } catch (readError) {
          replyError(reqid, readError)
        }
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('READDIR', (reqid, handle) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'dir') return sftp.status(reqid, status.FAILURE)
    if (record.sent) return sftp.status(reqid, status.EOF)
    record.sent = true
    if (!record.records.length) return sftp.status(reqid, status.EOF)
    sftp.name(reqid, record.records)
  })
  sftp.on('OPEN', (reqid, filename, flags) => {
    state.sftpEvents.push({ event: 'OPEN', path: normalizeRemotePath(filename) })
    try {
      fs.open(resolve(filename), openFlags(flags), (error, fd) => {
        if (error) return replyError(reqid, error)
        sftp.handle(reqid, makeHandle({
          type: 'file',
          fd,
          remotePath: normalizeRemotePath(filename)
        }))
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('READ', (reqid, handle, offset, length) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    const buffer = Buffer.alloc(length)
    fs.read(record.fd, buffer, 0, length, offset, (error, bytesRead) => {
      if (error) return replyError(reqid, error)
      if (!bytesRead) return sftp.status(reqid, status.EOF)
      if (fixture?.isStagingPath(record.remotePath)) {
        fixture.stagingReads.push({
          operation: 'sftp-read',
          path: record.remotePath,
          offset,
          size: bytesRead
        })
      }
      sftp.data(reqid, buffer.subarray(0, bytesRead))
    })
  })
  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    fs.write(record.fd, data, 0, data.length, offset, error => {
      if (error) return replyError(reqid, error)
      state.sftpWrites += 1
      if (fixture?.isStagingPath(record.remotePath)) {
        fixture.stagingWrites.push({
          operation: 'sftp-write',
          path: record.remotePath,
          offset,
          size: data.length
        })
      }
      sftp.status(reqid, status.OK)
    })
  })
  sftp.on('FSTAT', (reqid, handle) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    fs.fstat(record.fd, (error, stats) => {
      if (error) return replyError(reqid, error)
      sftp.attrs(reqid, attrsFor(stats, record.remotePath))
    })
  })
  sftp.on('FSETSTAT', (reqid, handle, attrs) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    applyHandleAttrs(record.fd, attrs)
      .then(() => sftp.status(reqid, status.OK))
      .catch(error => replyError(reqid, error))
  })
  sftp.on('CLOSE', (reqid, handle) => {
    const key = handle.toString('hex')
    const record = handles.get(key)
    handles.delete(key)
    if (!record) return sftp.status(reqid, status.FAILURE)
    if (record.type !== 'file') return sftp.status(reqid, status.OK)
    fs.close(record.fd, error => {
      if (error) return replyError(reqid, error)
      sftp.status(reqid, status.OK)
    })
  })
  const pathOperation = (eventName, method, success) => {
    sftp.on(eventName, (reqid, filename, attrs) => {
      state.sftpEvents.push({
        event: eventName,
        path: normalizeRemotePath(filename)
      })
      try {
        fs[method](resolve(filename), ...(success?.args || []), error => {
          if (error) return replyError(reqid, error)
          success?.after?.(normalizeRemotePath(filename))
          sftp.status(reqid, status.OK)
        })
      } catch (error) {
        replyError(reqid, error)
      }
    })
  }
  sftp.on('MKDIR', (reqid, filename, attrs = {}) => {
    state.sftpEvents.push({
      event: 'MKDIR',
      path: normalizeRemotePath(filename),
      requestedMode: attrs.mode
    })
    try {
      const requestedMode = fixture?.isStagingPath(filename)
        ? 0o700
        : Number.isFinite(attrs.mode)
          ? attrs.mode & 0o7777
          : 0o777
      fs.mkdir(resolve(filename), {
        recursive: false,
        mode: requestedMode
      }, async error => {
        if (error) return replyError(reqid, error)
        try {
          await fs.promises.chmod(resolve(filename), requestedMode)
          sftp.status(reqid, status.OK)
        } catch (attrsError) {
          replyError(reqid, attrsError)
        }
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  pathOperation('RMDIR', 'rmdir', {
    after: remotePath => {
      if (fixture?.isStagingPath(remotePath)) {
        fixture.stagingCleanups.push({ operation: 'sftp-rmdir', path: remotePath })
      }
    }
  })
  pathOperation('REMOVE', 'unlink', {
    after: remotePath => {
      if (fixture?.isStagingPath(remotePath)) {
        fixture.stagingCleanups.push({ operation: 'sftp-remove', path: remotePath })
      }
    }
  })
  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    try {
      fs.rename(resolve(oldPath), resolve(newPath), error => {
        if (error) return replyError(reqid, error)
        state.sftpRenames += 1
        sftp.status(reqid, status.OK)
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('SETSTAT', (reqid, filename, attrs) => {
    try {
      const localPath = resolve(filename)
      applyPathAttrs(localPath, attrs)
        .then(() => sftp.status(reqid, status.OK))
        .catch(error => replyError(reqid, error))
    } catch (error) {
      replyError(reqid, error)
    }
  })
}

async function startLocalSshServer (options = {}) {
  const clients = new Set()
  const fixtureTimers = new Set()
  const activePrivilegedHandlers = new Set()
  const activePrivilegedRequests = new Set()
  const privilegedCleanupErrors = new Set()
  let nextConnectionId = 1
  const state = {
    authenticationCount: 0,
    authenticatedUsernames: [],
    acceptedCount: 0,
    readyCount: 0,
    shellCount: 0,
    ctrlCCount: 0,
    sftpSessions: 0,
    sftpWrites: 0,
    sftpRenames: 0,
    sftpEvents: [],
    rootOnlySftpDenials: [],
    shellIntegrationNonce: '',
    shellIntegrationRearms: 0,
    effectiveIdentity: null,
    managedPtyScripts: [],
    execCommands: [],
    cancelledExecCommands: [],
    commands: [],
    commandEvents: [],
    shellSessionIds: [],
    privilegedFileRequests: options.sftpFixture?.privilegedFileRequests || [],
    cancelledPrivilegedFileRequests: [],
    stagingReads: options.sftpFixture?.stagingReads || [],
    stagingWrites: options.sftpFixture?.stagingWrites || [],
    stagingCleanups: options.sftpFixture?.stagingCleanups || [],
    activePrivilegedHandlers: 0,
    activePrivilegedRequests: 0,
    activeFixtureTimers: 0,
    privilegedCleanupErrors: 0
  }
  const updateActiveCounts = () => {
    state.activePrivilegedHandlers = activePrivilegedHandlers.size
    state.activePrivilegedRequests = activePrivilegedRequests.size
    state.activeFixtureTimers = fixtureTimers.size
    state.privilegedCleanupErrors = privilegedCleanupErrors.size
  }
  const scheduleFixtureTimer = (callback, delay) => {
    const timer = setTimeout(() => {
      fixtureTimers.delete(timer)
      updateActiveCounts()
      callback()
    }, delay)
    fixtureTimers.add(timer)
    updateActiveCounts()
    return timer
  }
  const clearFixtureTimer = timer => {
    if (timer === undefined || timer === null) return
    clearTimeout(timer)
    fixtureTimers.delete(timer)
    updateActiveCounts()
  }
  const trackPrivilegedHandler = handler => {
    activePrivilegedHandlers.add(handler)
    updateActiveCounts()
    handler.finally(() => {
      activePrivilegedHandlers.delete(handler)
      updateActiveCounts()
    }).catch(() => {})
  }
  options = {
    ...options,
    removePrivilegedStagePath: options.removePrivilegedStagePath || (
      target => fs.promises.rm(target, { force: true })
    ),
    scheduleFixtureTimer,
    clearFixtureTimer,
    trackPrivilegedHandler,
    registerPrivilegedRequest: request => {
      activePrivilegedRequests.add(request)
      updateActiveCounts()
    },
    unregisterPrivilegedRequest: request => {
      activePrivilegedRequests.delete(request)
      updateActiveCounts()
    },
    recordPrivilegedCleanupError: error => {
      privilegedCleanupErrors.add(error)
      updateActiveCounts()
    }
  }
  const server = new Server({
    hostKeys: [HOST_KEY]
  }, client => {
    const sessionId = `local-ssh-${nextConnectionId++}`
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
        state.authenticatedUsernames.push(ctx.username)
        ctx.accept()
        return
      }
      ctx.reject(['password'])
    })
    client.on('ready', () => {
      state.readyCount += 1
      client.on('session', accept => {
        const session = accept()
        let cancelActiveExec = () => false
        session.on('env', acceptEnv => acceptEnv?.())
        session.on('pty', acceptPty => acceptPty())
        session.on('window-change', () => {})
        session.on('signal', (acceptSignal, rejectSignal, info) => {
          if (info?.name === 'TERM' && cancelActiveExec()) {
            acceptSignal?.()
            return
          }
          rejectSignal?.()
        })
        session.on('exec', (acceptExec, rejectExec, info) => {
          state.execCommands.push(info.command)
          const stream = acceptExec()
          const discovery = options.managedPtyTasks
            ? operationsDiscoveryOutput(info.command)
            : ''
          const result = discovery
            ? [discovery, 0]
            : /\$SHELL/.test(info.command)
              ? ['/bin/bash\n', 0]
              : options.execResults?.[info.command] || execResults[info.command]
          const delayMs = Math.max(
            0,
            Number(options.execDelayMsByCommand?.[info.command]) || 0
          )
          let settled = false
          let timer
          const finish = () => {
            if (settled) return
            settled = true
            cancelActiveExec = () => false
            if (result) {
              stream.write(result[0])
              stream.exit(result[1])
            } else {
              stream.stderr.write(`unsupported E2E exec: ${info.command}\n`)
              stream.exit(127)
            }
            stream.end()
          }
          const recordCancellation = () => {
            if (settled) return false
            settled = true
            clearFixtureTimer(timer)
            cancelActiveExec = () => false
            state.cancelledExecCommands.push(info.command)
            try {
              stream.exit('TERM', false, 'cancelled')
              stream.end()
            } catch {}
            return true
          }
          cancelActiveExec = recordCancellation
          stream.on('error', () => {})
          stream.once('close', recordCancellation)
          if (delayMs > 0) {
            timer = scheduleFixtureTimer(finish, delayMs)
          } else {
            finish()
          }
        })
        session.on('shell', acceptShell => {
          state.shellSessionIds.push(sessionId)
          attachShell(acceptShell(), state, sessionId, options)
        })
        if (options.sftpRoot) {
          session.on('sftp', acceptSftp => {
            attachSftp(
              acceptSftp(),
              options.sftpRoot,
              state,
              options.sftpFixture
            )
          })
        }
      })
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  let closePromise
  const close = async () => {
    if (closePromise) return closePromise
    closePromise = (async () => {
      const closeErrors = []
      for (const request of [...activePrivilegedRequests]) {
        try {
          request.cancel()
        } catch (error) {
          closeErrors.push(error)
        }
      }
      const handlerResults = await Promise.allSettled([
        ...activePrivilegedHandlers
      ])
      for (const result of handlerResults) {
        if (result.status === 'rejected') closeErrors.push(result.reason)
      }
      closeErrors.push(...privilegedCleanupErrors)
      for (const timer of [...fixtureTimers]) clearFixtureTimer(timer)
      for (const client of clients) {
        try {
          client.end()
        } catch (error) {
          closeErrors.push(error)
        }
      }
      try {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
        })
      } catch (error) {
        closeErrors.push(error)
      }
      if (closeErrors.length) {
        throw new AggregateError(
          closeErrors,
          'Local SSH fixture cleanup failed'
        )
      }
    })()
    return closePromise
  }

  return {
    host: '127.0.0.1',
    port: server.address().port,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    state,
    disconnectClients () {
      for (const client of clients) client.end()
    },
    close
  }
}

module.exports = {
  parsePrivilegedFileCommand,
  privilegedFileMarker,
  startLocalSshServer
}
