const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

const protocolModule =
  'src/client/components/sftp/privileged-file-protocol.js'

const bashExecutable = process.env.SHELLPILOT_TEST_BASH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash')
const bashAvailable = spawnSync(
  bashExecutable,
  ['--noprofile', '--norc', '-c', ':'],
  { encoding: 'utf8' }
).status === 0
const linuxRootOnly = process.platform !== 'linux' ||
  typeof process.getuid !== 'function' || process.getuid() !== 0
const linuxNobodyRaceUnavailable = linuxRootOnly ||
  spawnSync('id', ['-u', 'nobody']).status !== 0 ||
  spawnSync('runuser', ['-u', 'nobody', '--', 'true']).status !== 0 ||
  spawnSync('timeout', ['1', 'true']).status !== 0

function runBash (script) {
  return spawnSync(
    bashExecutable,
    ['--noprofile', '--norc'],
    { encoding: 'utf8', input: script }
  )
}

function quoteForBash (value) {
  const quote = String.fromCharCode(39)
  return quote + String(value).replaceAll(
    quote,
    `${quote}"${quote}"${quote}`
  ) + quote
}

function toBashPath (nativePath) {
  if (process.platform !== 'win32') return nativePath
  const result = runBash(`cygpath -u ${quoteForBash(nativePath)}`)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const allCapabilities = [
  'sh=1', 'cleanShell=1', 'printf=1', 'id=1', 'tr=1', 'stat=1',
  'base64=1', 'sha256=1', 'procFd=1',
  'noclobber=1', 'cat=1', 'gnuStat=1', 'gnuMv=1',
  'realpath=1', 'readlink=1', 'chown=1', 'chmod=1', 'rm=1',
  'rmdir=1', 'find=1', 'head=1', 'wc=1', 'gnuDd=1', 'mkfifo=1',
  'touch=1'
].join(',')
const allCapabilityObject = Object.fromEntries(
  allCapabilities.split(',').map(value => [value.split('=')[0], true])
)

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function fileMarker (token, phase, ...fields) {
  return `\u001b]698;SHELLPILOT_FILE;${token};${phase};${fields.join(';')}\u0007`
}

function startMarker (token, capabilities = allCapabilities) {
  return fileMarker(
    token,
    'start',
    encodeMarkerField('0'),
    encodeMarkerField('root'),
    encodeMarkerField(capabilities)
  )
}

function stageBinding (overrides = {}) {
  return {
    rootPath: '/stage/session',
    rootRealPath: '/stage/session',
    rootDevice: '2049',
    rootInode: '12345',
    rootUid: '1000',
    rootGid: '1000',
    rootMode: '700',
    objectName: 'operation-token',
    ...overrides
  }
}

function cleanupBinding (overrides = {}) {
  return stageBinding({
    sha256: 'c'.repeat(64),
    size: '12',
    ...overrides
  })
}

function parentRemotePath (remotePath) {
  const index = remotePath.lastIndexOf('/')
  return index <= 0 ? '/' : remotePath.slice(0, index)
}

function sourceStageBinding (overrides = {}) {
  const sourcePath = overrides.sourcePath || '/root/source'
  return stageBinding({
    sourcePath,
    sourceParentRealPath: parentRemotePath(sourcePath),
    sourceParentDevice: '3001',
    sourceParentInode: '3002',
    sourceDevice: '3003',
    sourceInode: '3004',
    expectedSize: '12',
    maxSize: '12',
    ...overrides
  })
}

function sourceEntryBinding (overrides = {}) {
  const remotePath = overrides.path || '/root/source'
  return {
    path: remotePath,
    sourceParentRealPath: parentRemotePath(remotePath),
    sourceParentDevice: '3001',
    sourceParentInode: '3002',
    sourceDevice: '3003',
    sourceInode: '3004',
    ...overrides
  }
}

function boundedDigestBinding (overrides = {}) {
  return {
    ...stageBinding(),
    ...sourceEntryBinding(),
    expectedSize: '12',
    maxSize: '12',
    ...overrides
  }
}

function targetEntryBinding (overrides = {}) {
  const targetPath = overrides.targetPath || '/root/target'
  return {
    targetPath,
    targetParentRealPath: parentRemotePath(targetPath),
    targetParentDevice: '4001',
    targetParentInode: '4002',
    targetParentUid: '0',
    targetParentMode: '755',
    ...overrides
  }
}

function renameBinding (overrides = {}) {
  return {
    sourcePath: '/root/source',
    sourceParentRealPath: '/root',
    sourceParentDevice: '4001',
    sourceParentInode: '4002',
    sourceParentUid: '0',
    sourceParentMode: '755',
    sourceDevice: '4001',
    sourceInode: '4003',
    sourceType: 'file',
    targetPath: '/root/target',
    targetParentRealPath: '/root',
    targetParentDevice: '4001',
    targetParentInode: '4002',
    targetParentUid: '0',
    targetParentMode: '755',
    ...overrides
  }
}

function targetStageBinding (overrides = {}) {
  const targetPath = overrides.targetPath || '/root/target'
  return stageBinding({
    targetPath,
    targetParentRealPath: parentRemotePath(targetPath),
    targetParentDevice: '4001',
    targetParentInode: '4002',
    targetParentUid: '0',
    targetParentMode: '755',
    targetDevice: '4003',
    targetInode: '4004',
    mustBeAbsent: '1',
    ...overrides
  })
}

function importCleanupBinding (overrides = {}) {
  const tempPath = overrides.tempPath || '/root/.shellpilot-operation-token.tmp'
  const targetPath = overrides.targetPath || '/root/target'
  return stageBinding({
    tempPath,
    tempParentRealPath: parentRemotePath(tempPath),
    tempParentDevice: '4001',
    tempParentInode: '4002',
    tempParentUid: '0',
    tempParentMode: '755',
    targetPath,
    targetParentRealPath: parentRemotePath(targetPath),
    targetParentDevice: '4001',
    targetParentInode: '4002',
    targetParentUid: '0',
    targetParentMode: '755',
    targetDevice: '4001',
    targetInode: '4004',
    targetType: 'file',
    sha256: sha256Text('safe'),
    size: '4',
    maxSize: '4',
    initialMode: '0',
    initialUid: '0',
    initialGid: '0',
    targetMode: '600',
    targetUid: '1000',
    targetGid: '1000',
    ...overrides
  })
}

function nativeSourceBinding (remotePath) {
  const parentPath = path.dirname(remotePath)
  const parentStat = fs.statSync(parentPath, { bigint: true })
  const entryStat = fs.lstatSync(remotePath, { bigint: true })
  return {
    sourceParentRealPath: fs.realpathSync(parentPath),
    sourceParentDevice: String(parentStat.dev),
    sourceParentInode: String(parentStat.ino),
    sourceDevice: String(entryStat.dev),
    sourceInode: String(entryStat.ino)
  }
}

function nativeTargetBinding (remotePath, absent = false) {
  const parentPath = path.dirname(remotePath)
  const parentStat = fs.statSync(parentPath, { bigint: true })
  const entryStat = absent ? null : fs.lstatSync(remotePath, { bigint: true })
  return {
    targetParentRealPath: fs.realpathSync(parentPath),
    targetParentDevice: String(parentStat.dev),
    targetParentInode: String(parentStat.ino),
    targetParentUid: String(parentStat.uid),
    targetParentMode: (parentStat.mode & 0o7777n).toString(8),
    targetDevice: String(entryStat?.dev ?? 0),
    targetInode: String(entryStat?.ino ?? 0)
  }
}

async function listNamesFromRealBash (prelude, token) {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-list-glob-'))
  try {
    fs.writeFileSync(path.join(nativeRoot, '.hidden'), 'hidden')
    fs.writeFileSync(path.join(nativeRoot, 'visible'), 'visible')
    const rootPath = toBashPath(nativeRoot)
    const request = createPrivilegedFileRequest({
      operation: 'list',
      args: { path: rootPath }
    })
    const command = buildPrivilegedFileCommand({ token, request })
    const outerPrelude = typeof prelude === 'function'
      ? prelude(rootPath)
      : prelude
    const result = runBash(`${outerPrelude}\n${command}`)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(result.stdout)
    return parser.result().entries.map(entry => entry.name)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
}

async function runRealProtocolOperation ({
  operation,
  args,
  token,
  umask = '022',
  prelude = '',
  epilogue = ''
}) {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const request = createPrivilegedFileRequest({ operation, args })
  const command = buildPrivilegedFileCommand({ token, request })
  const execution = runBash([
    `umask ${umask}`,
    prelude,
    command,
    '__sp_protocol_status=$?',
    epilogue,
    'exit "$__sp_protocol_status"'
  ].join('\n'))
  const parser = createPrivilegedFileParser({ token, request })
  parser.push(execution.stdout)
  return { execution, parser, result: parser.result() }
}

function sha256Text (value) {
  return createHash('sha256').update(value).digest('hex')
}

function stageImportCleanupFunctions (command) {
  const cleanupStart = command.indexOf('__sp_import_cleanup_exact_locations()')
  const cleanupEnd = command.indexOf('; __sp_importSignalled=', cleanupStart)
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart)
  return command.slice(cleanupStart, cleanupEnd)
}

function runTrackedImportCleanup ({
  cleanup,
  actualMode,
  trackedMode,
  targetMode,
  targetIdentityMatches,
  expectDeleted
}) {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-state-'))
  try {
    const deleteLog = path.join(nativeRoot, 'delete-log')
    const result = runBash([
      `cd -- ${quoteForBash(toBashPath(nativeRoot))}`,
      'printf safe > target',
      `chmod ${actualMode} target`,
      '__sp_importTempName=temp',
      '__sp_targetName=target',
      '__sp_importTempCreated=0',
      '__sp_importInstalled=1',
      '__sp_tempDevice="$(stat -c %d -- target)"',
      '__sp_tempInode="$(stat -c %i -- target)"',
      `__sp_expectedSha256=${sha256Text('safe')}`,
      '__sp_expectedSize=4',
      '__sp_actualUid="$(stat -c %u -- target)"',
      '__sp_actualGid="$(stat -c %g -- target)"',
      '__sp_actualMode="$(stat -c %a -- target)"',
      `__sp_targetUid=${targetIdentityMatches
        ? '"$__sp_actualUid"'
        : '"$((__sp_actualUid + 1))"'}`,
      `__sp_targetGid=${targetIdentityMatches
        ? '"$__sp_actualGid"'
        : '"$((__sp_actualGid + 1))"'}`,
      `__sp_targetMode=${targetMode}`,
      '__sp_importMetadataKnown=1',
      '__sp_importMetadataUid="$__sp_actualUid"',
      '__sp_importMetadataGid="$__sp_actualGid"',
      `__sp_importMetadataMode=${trackedMode}`,
      '__sp_gid_effective="$__sp_actualGid"',
      '__sp_targetParentRealPath=.',
      '__sp_targetParentDevice=1',
      '__sp_targetParentInode=2',
      '__sp_targetParentUid=0',
      '__sp_targetParentMode=700',
      '__sp_trusted_parent_path_matches() { return 0; }',
      '__sp_entry_matches() { [ ! -L "$1" ] && [ -f "$1" ]; }',
      '__sp_path_matches_fd() { return 0; }',
      '__sp_fd_entry_matches() { return 0; }',
      '__sp_bounded_digest() { dd bs=65536 iflag=count_bytes count="$2" <&3 2>/dev/null | sha256sum | cut -d" " -f1; }',
      `rm() { printf deleted > ${quoteForBash(toBashPath(deleteLog))}; command rm "$@"; }`,
      cleanup,
      '__sp_import_cleanup',
      '__sp_cleanup_status=$?',
      ...(expectDeleted
        ? [
            '[ "$__sp_cleanup_status" -eq 0 ]',
            '[ ! -e ./target ]',
            `[ -e ${quoteForBash(toBashPath(deleteLog))} ]`
          ]
        : [
            '[ "$__sp_cleanup_status" -ne 0 ]',
            '[ -f ./target ]',
            `[ ! -e ${quoteForBash(toBashPath(deleteLog))} ]`
          ])
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
}

function linuxStageFixtureToken (suffix) {
  return createHash('sha256')
    .update(`shellpilot-linux-stage-fixture:${suffix}`)
    .digest('hex')
    .slice(0, 48)
}

async function createLinuxStageFixture (nativeRoot, suffix) {
  const rootPath = path.join(nativeRoot, `stage-${suffix}`)
  fs.mkdirSync(rootPath, { mode: 0o700 })
  fs.chmodSync(rootPath, 0o700)
  const challengeName = `challenge-${suffix}`
  const responseName = `response-${suffix}`
  const challengeText = `challenge:${suffix}`
  fs.writeFileSync(path.join(rootPath, challengeName), challengeText, { mode: 0o600 })
  const rootStat = fs.statSync(rootPath, { bigint: true })
  const handshake = await runRealProtocolOperation({
    operation: 'stage-handshake',
    token: linuxStageFixtureToken(suffix),
    args: {
      rootPath,
      challengeName,
      responseName,
      challenge: sha256Text(challengeText).toUpperCase(),
      challengeSize: String(Buffer.byteLength(challengeText)),
      rootUid: String(rootStat.uid),
      rootGid: String(rootStat.gid),
      rootMode: '700'
    }
  })
  assert.equal(
    handshake.execution.status,
    0,
    handshake.execution.stdout + handshake.execution.stderr
  )
  assert.equal(handshake.result.kind, 'stage-handshake')
  const expectedResponse = sha256Text(`${sha256Text(challengeText)}:root`)
  const responsePath = path.join(rootPath, responseName)
  const responseStat = fs.lstatSync(responsePath)
  assert.equal(handshake.result.response, expectedResponse)
  assert.equal(fs.readFileSync(responsePath, 'utf8'), expectedResponse)
  assert.equal(responseStat.isFile(), true)
  assert.equal(responseStat.isSymbolicLink(), false)
  assert.equal(responseStat.size, 64)
  assert.equal(responseStat.mode & 0o7777, 0o600)
  assert.equal(String(responseStat.uid), String(rootStat.uid))
  assert.equal(String(responseStat.gid), String(rootStat.gid))
  return {
    rootPath,
    responseName,
    binding: {
      rootPath,
      rootRealPath: handshake.result.rootRealPath,
      rootDevice: handshake.result.rootDevice,
      rootInode: handshake.result.rootInode,
      rootUid: handshake.result.uid,
      rootGid: handshake.result.gid,
      rootMode: handshake.result.mode
    }
  }
}

test('linux stage fixture tokens satisfy the protocol token contract before platform skips', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  for (const suffix of ['l1', 'l2', 'l3']) {
    const token = linuxStageFixtureToken(suffix)
    assert.match(token, /^[a-f0-9]{48}$/)
    assert.doesNotThrow(() => buildPrivilegedFileCommand({
      token,
      request: { operation: 'probe', args: {} }
    }))
  }
})

test('linux bound import cleanup preserves a second exact hardlink created during digest', {
  skip: linuxRootOnly || !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-cleanup-race-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'cleanup-race')
    const targetParent = path.join(nativeRoot, 'target-parent')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    fs.chmodSync(targetParent, 0o700)
    const targetPath = path.join(targetParent, 'target')
    const tempPath = path.join(targetParent, 'temp')
    fs.writeFileSync(targetPath, 'safe', { mode: 0o600 })
    fs.chmodSync(targetPath, 0o600)
    const parentStat = fs.statSync(targetParent, { bigint: true })
    const targetStat = fs.statSync(targetPath, { bigint: true })
    const objectName = 'cleanup-hardlink-race'
    const scratchPath = `/tmp/.shellpilot-digest-${fixture.binding.rootDevice}-${fixture.binding.rootInode}-${objectName}`
    const operation = await runRealProtocolOperation({
      operation: 'stage-import-cleanup',
      token: linuxStageFixtureToken('cleanup-hardlink-race'),
      args: importCleanupBinding({
        ...fixture.binding,
        objectName,
        tempPath,
        tempParentRealPath: targetParent,
        tempParentDevice: String(parentStat.dev),
        tempParentInode: String(parentStat.ino),
        tempParentUid: String(parentStat.uid),
        tempParentMode: (parentStat.mode & 0o7777n).toString(8),
        targetPath,
        targetParentRealPath: targetParent,
        targetParentDevice: String(parentStat.dev),
        targetParentInode: String(parentStat.ino),
        targetParentUid: String(parentStat.uid),
        targetParentMode: (parentStat.mode & 0o7777n).toString(8),
        targetDevice: String(targetStat.dev),
        targetInode: String(targetStat.ino),
        sha256: sha256Text('safe'),
        size: '4',
        maxSize: '4',
        initialMode: (targetStat.mode & 0o7777n).toString(8),
        initialUid: String(targetStat.uid),
        initialGid: String(targetStat.gid),
        targetMode: (targetStat.mode & 0o7777n).toString(8),
        targetUid: String(targetStat.uid),
        targetGid: String(targetStat.gid)
      }),
      prelude: `( __sp_wait=0; while [ ! -p ${quoteForBash(`${scratchPath}/input`)} ] && [ "$__sp_wait" -lt 500 ]; do __sp_wait=$((__sp_wait + 1)); sleep 0.01; done; [ -p ${quoteForBash(`${scratchPath}/input`)} ] && ln -- ${quoteForBash(targetPath)} ${quoteForBash(tempPath)} ) &`
    })
    assert.notEqual(operation.execution.status, 0)
    assert.equal(operation.result.ok, false)
    assert.equal(fs.existsSync(targetPath), true)
    assert.equal(fs.existsSync(tempPath), true)
    assert.equal(fs.statSync(targetPath).ino, fs.statSync(tempPath).ino)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('privileged file protocol accepts only fixed operations and never interpolates raw paths', async () => {
  const {
    createPrivilegedFileProtocol,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const hostile = "/root/a'; touch /tmp/pwn; printf '中文\\n*"
  const request = createPrivilegedFileRequest({
    operation: 'lstat',
    args: { path: hostile }
  })
  const command = createPrivilegedFileProtocol().buildCommand({
    token: 'a'.repeat(48),
    request
  })

  assert.doesNotMatch(command, /touch \/tmp\/pwn/)
  assert.doesNotMatch(command, /中文/)
  const encodedHostile = Buffer.from(hostile).toString('base64')
  assert.equal(command.includes(`SHELLPILOT_ARG_PATH='${encodedHostile}'`), true)
  assert.match(command, /^command \/usr\/bin\/env -i /)
  assert.match(command, /PATH=\/usr\/bin:\/bin/)
  assert.match(command, /SHELLPILOT_TOKEN=/)
  assert.match(command, /SHELLPILOT_ARG_PATH=/)
  assert.match(command, / \/bin\/sh -c /)
  assert.doesNotMatch(
    command,
    /\$(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|GLOBIGNORE|CDPATH|IFS)\b/
  )
  assert.doesNotMatch(
    command.slice(0, command.indexOf(' /bin/sh -c ')),
    /\b(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|GLOBIGNORE|CDPATH|IFS)=/
  )
  assert.throws(
    () => createPrivilegedFileRequest({ operation: 'shell', args: {} }),
    /不支持的 root 文件操作/
  )
})

test('privileged file parser accepts split ordered list metadata', async () => {
  const { createPrivilegedFileProtocol } = await importModule(protocolModule)
  const token = 'b'.repeat(48)
  const protocol = createPrivilegedFileProtocol()
  const parser = protocol.createParser({
    token,
    request: { operation: 'list', args: { path: '/root' } }
  })
  const start = fileMarker(
    token,
    'start',
    encodeMarkerField('0'),
    encodeMarkerField('root'),
    encodeMarkerField(allCapabilities)
  )
  const entry = fileMarker(
    token,
    'data',
    '1',
    '1',
    'entry',
    encodeMarkerField("a\n'b"),
    encodeMarkerField('81a4;12;10;11;0;0')
  )

  parser.push(`noise${start.slice(0, 37)}`)
  parser.push(`${start.slice(37)}ignored${entry}${fileMarker(token, 'end', '0')}`)

  assert.deepEqual(parser.identity(), { uid: '0', username: 'root' })
  assert.equal(parser.started(), true)
  assert.equal(parser.ended(), true)
  assert.equal(parser.exitCode(), 0)
  assert.deepEqual(protocol.readResult(parser), {
    kind: 'list',
    capabilities: allCapabilityObject,
    entries: [{
      name: "a\n'b",
      mode: 0o100644,
      type: 'file',
      size: 12,
      atime: 10,
      mtime: 11,
      uid: 0,
      gid: 0
    }]
  })
})

test('list restores pathname expansion after inherited set -f', {
  skip: !bashAvailable
}, async () => {
  assert.deepEqual(
    await listNamesFromRealBash('set -f', '7'.repeat(48)),
    ['.hidden', 'visible']
  )
})

test('list clears inherited dotglob without duplicating hidden entries', {
  skip: !bashAvailable
}, async () => {
  assert.deepEqual(
    await listNamesFromRealBash('shopt -s dotglob', '8'.repeat(48)),
    ['.hidden', 'visible']
  )
})

test('list rejects non-directories and directory symlinks but accepts an empty directory', {
  skip: !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-list-target-'))
  try {
    const emptyPath = path.join(nativeRoot, 'empty')
    const filePath = path.join(nativeRoot, 'file')
    const missingPath = path.join(nativeRoot, 'missing')
    const linkPath = path.join(nativeRoot, 'link')
    fs.mkdirSync(emptyPath)
    fs.writeFileSync(filePath, 'not a directory')
    fs.symlinkSync(
      emptyPath,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    for (const [name, targetPath, token] of [
      ['missing', missingPath, 'a4'.repeat(24)],
      ['file', filePath, 'a5'.repeat(24)],
      ['symlink', linkPath, 'a6'.repeat(24)]
    ]) {
      const rejected = await runRealProtocolOperation({
        operation: 'list',
        token,
        args: { path: toBashPath(targetPath) }
      })
      assert.notEqual(rejected.execution.status, 0, name)
      assert.equal(rejected.parser.ended(), true, name)
      assert.notEqual(rejected.parser.exitCode(), 0, name)
    }

    const empty = await runRealProtocolOperation({
      operation: 'list',
      token: 'a7'.repeat(24),
      args: { path: toBashPath(emptyPath) }
    })
    assert.equal(empty.execution.status, 0, empty.execution.stderr)
    assert.equal(empty.parser.exitCode(), 0)
    assert.deepEqual(empty.result.entries, [])
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('list preserves multiple trailing newlines in the bound directory path', {
  skip: !bashAvailable || process.platform === 'win32'
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-list-newline-'))
  try {
    const rootPath = toBashPath(nativeRoot)
    const directoryPath = `${rootPath}/directory\n\n`
    const create = runBash([
      `mkdir -- ${quoteForBash(directoryPath)} || exit`,
      `: > ${quoteForBash(`${directoryPath}/entry`)} || exit`
    ].join('\n'))
    assert.equal(create.status, 0, create.stderr)

    const listed = await runRealProtocolOperation({
      operation: 'list',
      token: 'a9'.repeat(24),
      args: { path: directoryPath }
    })
    assert.equal(listed.execution.status, 0, listed.execution.stderr)
    assert.equal(listed.parser.exitCode(), 0)
    assert.deepEqual(listed.result.entries.map(entry => entry.name), ['entry'])
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('list rejects more than 20000 real directory entries before emitting data', {
  skip: !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-list-limit-'))
  try {
    const rootPath = toBashPath(nativeRoot)
    const populate = runBash([
      `cd -- ${quoteForBash(rootPath)} || exit`,
      '__sp_test_i=0',
      'while [ "$__sp_test_i" -lt 20001 ]; do',
      '  : > "$__sp_test_i" || exit',
      '  __sp_test_i=$((__sp_test_i + 1))',
      'done'
    ].join('\n'))
    assert.equal(populate.status, 0, populate.stderr)

    const rejected = await runRealProtocolOperation({
      operation: 'list',
      token: 'a8'.repeat(24),
      args: { path: rootPath }
    })
    assert.notEqual(rejected.execution.status, 0)
    assert.notEqual(rejected.parser.exitCode(), 0)
    assert.doesNotMatch(rejected.execution.stdout, /;data;/)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('list binds one real directory and propagates producer status before glob expansion', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: '81'.repeat(24),
    request: { operation: 'list', args: { path: '/root' } }
  })
  const bind = command.indexOf('__sp_listReal=')
  const producerCheck = command.indexOf('find . -mindepth 1')
  const firstGlob = command.indexOf('./.[!.]*')

  assert.equal(bind >= 0 && bind < producerCheck && producerCheck < firstGlob, true)
  assert.match(command, /__sp_listReal=.*realpath -- "\$__sp_path"/)
  assert.match(command, /\[ ! -L "\$__sp_path" \].*\[ -d "\$__sp_path" \]/)
  assert.match(command, /cd -- "\$__sp_path"/)
  assert.match(command, /__sp_requestedDevice=.*stat -c %d -- "\$__sp_path"/)
  assert.match(command, /__sp_requestedInode=.*stat -c %i -- "\$__sp_path"/)
  assert.match(command, /__sp_listPwd=.*pwd -P/)
  assert.match(command, /__sp_listPwd="\$\(pwd -P && printf \.\)" \|\| return \$\?/)
  assert.match(command, /__sp_pwdSentinel="\$\(printf "\\n\."\)" \|\| return \$\?/)
  assert.match(command, /case "\$__sp_listPwd" in \*"\$__sp_pwdSentinel"\)/)
  assert.match(command, /__sp_listPwd=\$\{__sp_listPwd%"\$__sp_pwdSentinel"\}/)
  assert.match(command, /__sp_listCwdReal=.*realpath -- \./)
  assert.match(command, /"\$__sp_listCwdReal" = "\$__sp_listPwd"/)
  assert.match(command, /__sp_listDevice=.*stat -c %d -- \./)
  assert.match(command, /__sp_listInode=.*stat -c %i -- \./)
  assert.doesNotMatch(command, /find "\$__sp_path"/)
  assert.match(command, /find \. -mindepth 1 -maxdepth 1 -print >\/dev\/null 2>&1 \|\| return/)
  assert.match(command, /find \. -mindepth 1 -maxdepth 1 -printf x 2>\/dev\/null; __sp_findStatus=\$\?/)
  assert.match(command, /head -c 20001/)
  assert.match(command, /__sp_preflightEntries=.*__sp_preflight%\?/)
  assert.match(command, /__sp_preflightCount=\$\{#__sp_preflightEntries\}/)
  assert.match(command, /"\$__sp_preflightCount" -le 20000/)
  assert.match(command, /"\$__sp_seq" -le "\$__sp_total".*"\$__sp_seq" -le 20000/)
  assert.match(command, /__sp_metadataBytes=0/)
  assert.match(command, /__sp_metadataBytes=.*#__sp_name64.*#__sp_stat64/)
  assert.match(command, /"\$__sp_metadataBytes" -le 4194304/)
  assert.match(command, /__sp_emit_entry[^;]+\|\| return/)
})

test('list ignores inherited GLOBIGNORE and startup environment pollution', {
  skip: !bashAvailable
}, async () => {
  assert.deepEqual(
    await listNamesFromRealBash(rootPath => [
      `export GLOBIGNORE=${quoteForBash(`${rootPath}/visible`)}`,
      'export BASH_ENV=/definitely/not/a/shellpilot/startup/file',
      'export ENV=/definitely/not/a/shellpilot/startup/file'
    ].join('\n'), '9'.repeat(48)),
    ['.hidden', 'visible']
  )
})

test('clean bootstrap bypasses an absolute-path env function', {
  skip: !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-env-function-'))
  try {
    const nativeLog = path.join(nativeRoot, 'env-function.log')
    fs.writeFileSync(nativeLog, '')
    const logPath = toBashPath(nativeLog)
    const names = await listNamesFromRealBash(rootPath => [
      `__test_env_log=${quoteForBash(logPath)}`,
      'function /usr/bin/env { printf "called\\n" >> "$__test_env_log"; if [ "$1" = -i ]; then shift; fi; command /usr/bin/env "$@"; }',
      'export -f /usr/bin/env 2>/dev/null || :',
      'stat () { command stat "$@"; }',
      'export -f stat',
      `export GLOBIGNORE=${quoteForBash(`${rootPath}/visible`)}`,
      'export BASHOPTS'
    ].join('\n'), 'b0'.repeat(24))
    assert.deepEqual(names, ['.hidden', 'visible'])
    assert.equal(fs.readFileSync(nativeLog, 'utf8'), '')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('ordinary env alias cannot replace the absolute clean bootstrap target', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-env-alias-'))
  try {
    const nativeLog = path.join(nativeRoot, 'env-alias.log')
    fs.writeFileSync(nativeLog, '')
    const logPath = toBashPath(nativeLog)
    const token = 'b1'.repeat(24)
    const request = createPrivilegedFileRequest({ operation: 'probe' })
    const command = buildPrivilegedFileCommand({ token, request })
    const result = runBash([
      'shopt -s expand_aliases',
      `alias env='printf called >> ${quoteForBash(logPath)}; false'`,
      command
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(result.stdout)
    assert.equal(parser.result().capabilities.cleanShell, true)
    assert.equal(fs.readFileSync(nativeLog, 'utf8'), '')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('probe ignores exported functions and reports its clean shell boundary', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-probe-env-'))
  try {
    const nativeLog = path.join(nativeRoot, 'outer-set.log')
    fs.writeFileSync(nativeLog, '')
    const logPath = toBashPath(nativeLog)
    const token = 'a0'.repeat(24)
    const request = createPrivilegedFileRequest({ operation: 'probe' })
    const command = buildPrivilegedFileCommand({ token, request })
    const result = runBash([
      `__test_set_log=${quoteForBash(logPath)}`,
      'set () { printf "called\\n" >> "$__test_set_log"; return 0; }',
      'export -f set',
      'export GLOBIGNORE=*',
      'export BASH_ENV=/definitely/not/a/shellpilot/startup/file',
      command
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(result.stdout)
    assert.equal(parser.result().capabilities.cleanShell, true)
    assert.equal(fs.readFileSync(nativeLog, 'utf8'), '')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('capabilities use functional probes before pathname wrappers', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = 'b2'.repeat(24)
  const request = createPrivilegedFileRequest({ operation: 'probe' })
  const command = buildPrivilegedFileCommand({ token, request })

  assert.doesNotMatch(command, /command -v/)
  assert.match(command, /__sp_base64_cap=.*base64.*base64 -d/)
  assert.match(command, /__sp_gnu_stat_cap=.*stat -c/)
  assert.match(command, /__sp_sha256_cap=.*(?:sha256sum|shasum)/)
  assert.match(command, /__sp_realpath_cap=.*realpath -- \/|realpath \/ /)
  assert.match(command, /__sp_find_cap=.*find /)
  assert.match(command, /__sp_head_cap=.*head /)
  assert.match(command, /__sp_wc_cap=.*wc /)
  assert.match(command, /__sp_proc_fd_cap=.*\/proc\/\$\$\/fd/)
  assert.match(command, /__sp_noclobber_cap=.*set -C/)
  assert.equal(command.indexOf('__sp_base64_cap=') < command.indexOf('realpath() {'), true)

  const execution = runBash(command)
  assert.equal(execution.status, 0, execution.stdout + execution.stderr)
  const parser = createPrivilegedFileParser({ token, request })
  parser.push(execution.stdout)
  const capabilities = parser.result().capabilities
  for (const name of [
    'cleanShell', 'printf', 'id', 'tr', 'base64', 'stat', 'gnuStat',
    'sha256', 'realpath', 'find', 'head', 'wc', 'procFd', 'noclobber'
  ]) {
    assert.equal(capabilities[name], true, name)
  }
})

test('list parser rejects forged success when a producer capability is false', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = 'b3'.repeat(24)
  const parser = createPrivilegedFileParser({
    token,
    request: { operation: 'list', args: { path: '/root' } }
  })
  parser.push(startMarker(token, 'sh=1,stat=1,find=0,head=1,wc=1'))
  assert.throws(
    () => parser.push(fileMarker(token, 'end', '0')),
    /缺少必要能力/
  )
  const missing = createPrivilegedFileParser({
    token,
    request: { operation: 'list', args: { path: '/root' } }
  })
  missing.push(startMarker(token, 'sh=1,stat=1'))
  assert.throws(
    () => missing.push(fileMarker(token, 'end', '0')),
    /缺少必要能力/
  )
})

test('parser rejects explicit false capabilities used by fixed operation bodies', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  for (const [operation, capability] of [
    ['stat', 'gnuStat'],
    ['readlink', 'readlink'],
    ['realpath', 'realpath'],
    ['rename-bound', 'gnuMv'],
    ['metadata-bound', 'chmod'],
    ['metadata-bound', 'chown'],
    ['remove-bound', 'rm'],
    ['touch-bound', 'touch'],
    ['sha256', 'sha256']
  ]) {
    const token = sha256Text(`${operation}:${capability}`).slice(0, 48)
    const parser = createPrivilegedFileParser({ token, request: { operation } })
    parser.push(startMarker(token, `sh=1,${capability}=0`))
    assert.throws(
      () => parser.push(fileMarker(token, 'end', '0')),
      /缺少必要能力/,
      `${operation}:${capability}`
    )
  }
})

test('privileged requests are deeply frozen and validate argument contracts', async () => {
  const { createPrivilegedFileRequest } = await importModule(protocolModule)
  const request = createPrivilegedFileRequest({
    operation: 'stat',
    args: { path: 12 }
  })

  assert.deepEqual(request, {
    operation: 'stat',
    args: { path: '12' }
  })
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.args), true)
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'probe',
      args: { Bad: 'x' }
    }),
    /参数名/
  )
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'probe',
      args: { ['a'.repeat(33)]: 'x' }
    }),
    /参数名/
  )
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'probe',
      args: { value: 'x'.repeat(1024 * 1024 + 1) }
    }),
    /参数过长/
  )
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'lstat',
      args: { path: '/root/a\u0000b' }
    }),
    /参数值无效/
  )
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'lstat',
      args: { path: '/root/\uD800' }
    }),
    /参数值无效/
  )
})

test('request constructor canonicalizes octal modes and SHA-256 fields', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = 'd4'.repeat(24)
  const upperSha256 = 'AB'.repeat(32)
  const mixedChallenge = 'aB'.repeat(32)

  for (const [input, canonical] of [
    ['0640', '640'],
    ['000', '0'],
    ['640', '640']
  ]) {
    const request = createPrivilegedFileRequest({
      operation: 'stage-import',
      args: targetStageBinding({
        targetPath: '/root/target',
        sha256: upperSha256,
        size: '0',
        targetMode: input,
        targetUid: '0',
        targetGid: '0'
      })
    })
    assert.equal(request.args.targetMode, canonical)
    assert.equal(request.args.sha256, upperSha256.toLowerCase())
    assert.equal(request.args.mustBeAbsent, '1')
    assert.doesNotThrow(() => buildPrivilegedFileCommand({ token, request }))
  }

  const handshake = createPrivilegedFileRequest({
    operation: 'stage-handshake',
    args: {
      rootPath: '/stage',
      challengeName: 'challenge',
      responseName: 'response',
      challenge: mixedChallenge,
      challengeSize: '48',
      rootUid: '0',
      rootGid: '0',
      rootMode: '0700'
    }
  })
  assert.equal(handshake.args.challenge, mixedChallenge.toLowerCase())
  assert.equal(handshake.args.rootMode, '700')
  assert.doesNotThrow(() => buildPrivilegedFileCommand({ token, request: handshake }))

  const noClobber = createPrivilegedFileRequest({
    operation: 'stage-import',
    args: targetStageBinding({
      targetPath: '/root/target',
      sha256: upperSha256,
      size: '0',
      targetMode: '600',
      targetUid: '0',
      targetGid: '0',
      mustBeAbsent: '1'
    })
  })
  assert.equal(noClobber.args.mustBeAbsent, '1')
  assert.match(buildPrivilegedFileCommand({ token, request: noClobber }), /mv -nT/)
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-import',
    args: { ...noClobber.args, mustBeAbsent: 'true' }
  }).args, /mustBeAbsent/)
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-import',
    args: { ...noClobber.args, mustBeAbsent: '0' }
  }), /mustBeAbsent|缺失目标/)
  const { mustBeAbsent, ...withoutNoClobber } = noClobber.args
  assert.equal(mustBeAbsent, '1')
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-import',
    args: withoutNoClobber
  }), /mustBeAbsent|缺少必要参数/)
})

test('stage-import-cleanup has an exact frozen dual-path proof contract', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const request = createPrivilegedFileRequest({
    operation: 'stage-import-cleanup',
    args: importCleanupBinding()
  })
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.args), true)
  assert.equal(request.args.sha256, sha256Text('safe'))
  assert.equal(request.args.initialMode, '0')

  const command = buildPrivilegedFileCommand({
    token: 'ae'.repeat(24),
    request
  })
  const digest = command.indexOf('__sp_bounded_digest')
  const finalScan = command.indexOf('__sp_import_residual_exact_count', digest)
  const unlink = command.indexOf('rm -f --', finalScan)
  const postcheck = command.indexOf('__sp_import_residual_exact_count', unlink)
  assert.ok(digest >= 0, 'cleanup must use the bounded digest helper')
  assert.ok(finalScan > digest, 'cleanup must rescan both paths after digest')
  assert.ok(unlink > finalScan, 'cleanup may unlink only after the final rescan')
  assert.ok(postcheck > unlink, 'cleanup must postcheck both paths after unlink')
  assert.match(command, /__sp_import_residual_exact_count.*-eq 1/s)
  assert.match(command, /__sp_import_residual_exact_count.*-eq 0/s)
  assert.match(
    command,
    /__sp_import_residual_parents_match.*__sp_import_residual_exact_count.*ExactCount" -eq 0.*__sp_emit_import_cleanup 1 none/s
  )

  for (const args of [
    { ...request.args, targetPath: '/root/../foreign' },
    { ...request.args, tempPath: '/root/other/.tmp' },
    { ...request.args, maxSize: '3' },
    { ...request.args, initialMode: '888' },
    { ...request.args, tempParentUid: '-1' },
    { ...request.args, injected: 'rm -rf /' }
  ]) {
    assert.throws(
      () => createPrivilegedFileRequest({
        operation: 'stage-import-cleanup',
        args
      }),
      /参数|绑定|mode|maxSize|合同|proof/
    )
  }
})

test('stage-import-cleanup success requires an authoritative cleanup marker', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = 'af'.repeat(24)
  const request = {
    operation: 'stage-import-cleanup',
    args: importCleanupBinding()
  }
  const createParser = () => {
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(startMarker(token))
    return parser
  }

  const missingStatus = createParser()
  assert.throws(
    () => missingStatus.push(fileMarker(token, 'end', '0')),
    /结束边界|cleanup/
  )

  const confirmed = createParser()
  confirmed.push(fileMarker(
    token,
    'data',
    '1',
    '1',
    'import-cleanup',
    encodeMarkerField('1'),
    encodeMarkerField('none')
  ))
  confirmed.push(fileMarker(token, 'end', '0'))
  assert.deepEqual(confirmed.result(), {
    kind: 'stage-import-cleanup',
    capabilities: allCapabilityObject,
    cleanupSucceeded: true,
    residualLocation: 'none'
  })
  assert.equal(Object.isFrozen(confirmed.result()), true)

  for (const values of [
    ['0', 'none'],
    ['1', 'target'],
    ['true', 'none']
  ]) {
    const invalid = createParser()
    assert.throws(
      () => invalid.push(fileMarker(
        token,
        'data',
        '1',
        '1',
        'import-cleanup',
        ...values.map(encodeMarkerField)
      )),
      /cleanup|数据类型|状态/
    )
  }

  const failed = createParser()
  failed.push(fileMarker(token, 'end', '1'))
  assert.deepEqual(failed.result(), {
    kind: 'stage-import-cleanup',
    capabilities: allCapabilityObject,
    ok: false
  })
})

test('request constructor immediately rejects script and every unknown argument', async () => {
  const { createPrivilegedFileRequest } = await importModule(protocolModule)
  for (const args of [
    { script: 'touch /tmp/pwn' },
    { shellCode: 'touch /tmp/pwn' },
    { path: '/allowed', command: 'touch /tmp/pwn' }
  ]) {
    assert.throws(
      () => createPrivilegedFileRequest({ operation: 'lstat', args }),
      /参数合同/
    )
  }
})

test('rename-bound fixes both parent and entry bindings around a no-clobber move', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const request = createPrivilegedFileRequest({
    operation: 'rename-bound',
    args: renameBinding()
  })
  const command = buildPrivilegedFileCommand({
    token: 'db'.repeat(24),
    request
  })

  assert.match(command, /mv -nT/)
  assert.doesNotMatch(command, /mv -fT|cp -a|rm -rf/)
  assert.match(command, /__sp_sourceDevice/)
  assert.match(command, /__sp_sourceInode/)
  assert.match(command, /__sp_sourceType/)
  assert.match(command, /__sp_sourceParentRealPath/)
  assert.match(command, /__sp_targetParentRealPath/)
  assert.match(command, /__sp_rollback_rename/)
})

test('rename-bound rollback never moves an unproven post-move target replacement', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'dd'.repeat(24),
    request: {
      operation: 'rename-bound',
      args: renameBinding()
    }
  })
  const start = command.indexOf('__sp_rollback_rename()')
  const end = command.indexOf(' };', start)
  assert.ok(start >= 0 && end > start)
  const rollback = command.slice(start, end)

  assert.match(
    rollback,
    /__sp_entry_matches "\$__sp_targetRef" "\$__sp_sourceDevice" "\$__sp_sourceInode" "\$__sp_sourceType"/
  )
  assert.match(rollback, /__sp_rename_parents_match/)
  assert.doesNotMatch(rollback, /__sp_wrongDevice|__sp_wrongInode/)
  assert.equal(
    rollback.indexOf('__sp_entry_matches "$__sp_targetRef"') <
      rollback.indexOf('mv -nT -- "$__sp_targetRef" "$__sp_sourceRef"'),
    true
  )
})

test('rename-bound rollback shell preserves a foreign inode and restores only the expected source inode', {
  skip: !bashAvailable
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'de'.repeat(24),
    request: { operation: 'rename-bound', args: renameBinding() }
  })
  const start = command.indexOf('__sp_rollback_rename()')
  const end = command.indexOf(' };', start)
  assert.ok(start >= 0 && end > start)
  const rollbackFunction = command.slice(start, end + 2)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rename-rollback-'))
  try {
    const sourcePath = toBashPath(path.join(nativeRoot, 'source'))
    const targetPath = toBashPath(path.join(nativeRoot, 'target'))
    const expectedPath = toBashPath(path.join(nativeRoot, 'expected'))
    fs.writeFileSync(path.join(nativeRoot, 'expected'), 'expected source')
    fs.writeFileSync(path.join(nativeRoot, 'target'), 'foreign target')
    const binding = runBash(
      `stat -c '%d;%i' -- ${quoteForBash(expectedPath)}`
    )
    assert.equal(binding.status, 0, binding.stderr)
    const [sourceDevice, sourceInode] = binding.stdout.trim().split(';')
    const common = [
      `__sp_sourceRef=${quoteForBash(sourcePath)}`,
      `__sp_targetRef=${quoteForBash(targetPath)}`,
      '__sp_sourceType=file',
      `__sp_sourceDevice=${quoteForBash(sourceDevice)}`,
      `__sp_sourceInode=${quoteForBash(sourceInode)}`,
      '__sp_entry_matches() { [ ! -L "$1" ] && [ -f "$1" ] && [ "$(stat -c %d -- "$1")" = "$2" ] && [ "$(stat -c %i -- "$1")" = "$3" ]; }',
      '__sp_rename_parents_match() { return 0; }',
      rollbackFunction
    ]
    const foreign = runBash([
      ...common,
      '__sp_rollback_rename',
      '[ ! -e "$__sp_sourceRef" ] && [ ! -L "$__sp_sourceRef" ]',
      '[ "$(cat -- "$__sp_targetRef")" = "foreign target" ]'
    ].join('\n'))
    assert.equal(foreign.status, 0, foreign.stdout + foreign.stderr)

    fs.rmSync(path.join(nativeRoot, 'target'))
    fs.renameSync(path.join(nativeRoot, 'expected'), path.join(nativeRoot, 'target'))
    const expected = runBash([
      ...common,
      '__sp_rollback_rename',
      '[ "$(cat -- "$__sp_sourceRef")" = "expected source" ]',
      '[ ! -e "$__sp_targetRef" ] && [ ! -L "$__sp_targetRef" ]'
    ].join('\n'))
    assert.equal(expected.status, 0, expected.stdout + expected.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux rename-bound rejects a same-type source replacement under its trusted parent', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rename-source-swap-'))
  try {
    fs.chmodSync(nativeRoot, 0o700)
    const sourcePath = path.join(nativeRoot, 'source')
    const originalPath = path.join(nativeRoot, 'original')
    const targetPath = path.join(nativeRoot, 'target')
    fs.writeFileSync(sourcePath, 'owned', { mode: 0o600 })
    const sourceBinding = nativeSourceBinding(sourcePath)
    const parentStat = fs.statSync(nativeRoot, { bigint: true })
    fs.renameSync(sourcePath, originalPath)
    fs.writeFileSync(sourcePath, 'foreign', { mode: 0o600 })

    const result = await runRealProtocolOperation({
      operation: 'rename-bound',
      token: 'df'.repeat(24),
      args: {
        sourcePath,
        ...sourceBinding,
        sourceParentUid: String(parentStat.uid),
        sourceParentMode: (parentStat.mode & 0o7777n).toString(8),
        sourceType: 'file',
        targetPath,
        targetParentRealPath: nativeRoot,
        targetParentDevice: String(parentStat.dev),
        targetParentInode: String(parentStat.ino),
        targetParentUid: String(parentStat.uid),
        targetParentMode: (parentStat.mode & 0o7777n).toString(8)
      }
    })

    assert.notEqual(result.execution.status, 0)
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'foreign')
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'owned')
    assert.equal(fs.existsSync(targetPath), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('bounded source producers require trusted sizes and expose only fixed range operations', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = 'dc'.repeat(24)
  const source = sourceStageBinding({
    expectedSize: '1048576',
    maxSize: '1073741824'
  })
  const fullExport = buildPrivilegedFileCommand({
    token,
    request: createPrivilegedFileRequest({
      operation: 'stage-export',
      args: source
    })
  })
  const rangeExport = buildPrivilegedFileCommand({
    token,
    request: createPrivilegedFileRequest({
      operation: 'stage-export-range',
      args: {
        ...source,
        offset: '983040',
        maxBytes: '65536'
      }
    })
  })
  const wholeDigest = buildPrivilegedFileCommand({
    token,
    request: createPrivilegedFileRequest({
      operation: 'sha256-bound',
      args: {
        ...boundedDigestBinding(),
        expectedSize: '1048576',
        maxSize: '1073741824'
      }
    })
  })
  const rangeDigest = buildPrivilegedFileCommand({
    token,
    request: createPrivilegedFileRequest({
      operation: 'sha256-range-bound',
      args: {
        ...boundedDigestBinding(),
        expectedSize: '1048576',
        maxSize: '1073741824',
        offset: '983040',
        maxBytes: '65536'
      }
    })
  })

  for (const command of [fullExport, rangeExport, wholeDigest, rangeDigest]) {
    assert.match(command, /__sp_expectedSize/)
    assert.match(command, /__sp_maxSize/)
    assert.match(command, /__sp_openSourceSize/)
    assert.match(command, /__sp_sourceDevice/)
    assert.match(command, /__sp_sourceInode/)
  }
  assert.match(fullExport, /count="\$__sp_windowSize"/)
  assert.doesNotMatch(fullExport, /cat <&4 >&3/)
  assert.match(rangeExport, /__sp_offset/)
  assert.match(rangeExport, /__sp_maxBytes/)
  assert.match(rangeExport, /65536/)
  assert.match(wholeDigest, /__sp_bounded_digest/)
  assert.match(rangeDigest, /__sp_bounded_digest/)
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-export-range',
    args: { ...source, offset: '0', maxBytes: '65537' }
  }), /maxBytes|范围|参数/)
})

test('bounded digest isolates both FIFO endpoints and independently meters hash input', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'df'.repeat(24),
    request: {
      operation: 'sha256-range-bound',
      args: boundedDigestBinding({ offset: '1', maxBytes: '4' })
    }
  })
  const helperStart = command.indexOf('__sp_bounded_digest()')
  const helperEnd = command.indexOf(' }; __sp_valid_name()', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  const helper = command.slice(helperStart, helperEnd)

  assert.match(helper, /__sp_scratchParent=\/tmp/)
  assert.match(helper, /stat -c %u -- "\$__sp_scratchParent".*= 0/)
  assert.match(helper, /& 01000/)
  assert.match(helper, /mkdir -- "\$__sp_scratch"/)
  assert.match(helper, /stat -c %u -- "\$__sp_scratch".*= 0/)
  assert.match(helper, /stat -c %a -- "\$__sp_scratch".*= 700/)
  assert.match(helper, /mkfifo -m 600 -- "\$__sp_inputFifo"/)
  assert.match(helper, /mkfifo -m 600 -- "\$__sp_hashFifo"/)
  assert.ok(helper.indexOf('mkdir -- "$__sp_scratch"') <
    helper.indexOf('mkfifo -m 600 -- "$__sp_inputFifo"'))
  assert.match(helper, /__sp_inputInode=.*stat -c %i -- "\$__sp_inputFifo"/)
  assert.ok(helper.indexOf('__sp_inputInode=') <
    helper.indexOf('exec 5<> "$__sp_inputFifo"'))
  assert.match(helper, /dd .*<&3 .*>&7 2> "\$__sp_producerReport"/)
  assert.match(helper, /dd .*<&6 .*>&4 2> "\$__sp_consumerReport"/)
  assert.match(helper, /__sp_sha256_stdin <&9/)
  assert.match(helper, /__sp_fd4="\/dev\/fd\/4"/)
  assert.doesNotMatch(helper, /\/proc\/\$\$\/fd/)
  assert.match(helper, /__sp_producerActualBytes.*__sp_digestCount/)
  assert.match(helper, /__sp_consumerActualBytes.*__sp_digestCount/)
  assert.match(helper, /__sp_scratch_matches.*rmdir -- "\$__sp_scratch"/)
  assert.doesNotMatch(helper, /rm -rf/)
  assert.doesNotMatch(helper, /\.\/\$__sp_objectName(?:\.count)?/)
})

test('bounded digest rejects independently short producer and consumer streams', {
  skip: linuxRootOnly
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-digest-fd-race-'))
  try {
    const rootPath = toBashPath(nativeRoot)
    const sourcePath = path.join(nativeRoot, 'source')
    fs.writeFileSync(sourcePath, 'abcdef')
    const token = 'ef'.repeat(24)
    const command = buildPrivilegedFileCommand({
      token,
      request: {
        operation: 'sha256-range-bound',
        args: boundedDigestBinding({ offset: '0', maxBytes: '4' })
      }
    })
    const helperStart = command.indexOf('__sp_bounded_digest()')
    const helperEnd = command.indexOf(' }; __sp_valid_name()', helperStart)
    const helper = command.slice(helperStart, helperEnd + 3)
    const common = [
      `cd -- ${quoteForBash(rootPath)}`,
      `__sp_token=${quoteForBash(token)}`,
      '__sp_rootDevice=1',
      '__sp_rootInode=2',
      '__sp_sha256_tool=sha256sum',
      '__sp_sha256_stdin() { __sp_hash="$(sha256sum)" || return $?; printf %s "$' + '{__sp_hash%% *}"; }',
      'realpath() { command realpath "$@" || return $?; printf .; }',
      '__sp_objectName=short-proof',
      `exec 3< ${quoteForBash(toBashPath(sourcePath))}`,
      helper
    ]
    const shortProducer = runBash([
      ...common,
      '__sp_bounded_digest 0 7 >/dev/null 2>&1; [ "$?" -ne 0 ]',
      `[ ! -e ${quoteForBash('/tmp/.shellpilot-digest-1-2-short-proof')} ]`
    ].join('\n'))
    assert.equal(shortProducer.status, 0,
      shortProducer.stdout + shortProducer.stderr)

    const shortConsumer = runBash([
      ...common,
      'dd() { case " $* " in *" skip="*) command dd "$@" ;; *) command dd bs=65536 iflag=count_bytes count=2 ;; esac; }',
      '__sp_bounded_digest 0 4 >/dev/null 2>&1; [ "$?" -ne 0 ]',
      `[ ! -e ${quoteForBash('/tmp/.shellpilot-digest-1-2-short-proof')} ]`
    ].join('\n'))
    assert.equal(shortConsumer.status, 0,
      shortConsumer.stdout + shortConsumer.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux root scratch blocks pre-open FIFO replacement and extra endpoints', {
  skip: linuxNobodyRaceUnavailable
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-root-fifo-race-'))
  try {
    const token = 'f0'.repeat(24)
    const objectName = 'race-proof'
    const scratchPath = `/tmp/.shellpilot-digest-1-2-${objectName}`
    const sourcePath = path.join(nativeRoot, 'source')
    const raceLog = path.join(nativeRoot, 'race-log')
    fs.writeFileSync(sourcePath, 'root-only-fifo')
    const command = buildPrivilegedFileCommand({
      token,
      request: {
        operation: 'sha256-range-bound',
        args: boundedDigestBinding({ offset: '0', maxBytes: '14' })
      }
    })
    const helperStart = command.indexOf('__sp_bounded_digest()')
    const helperEnd = command.indexOf(' }; __sp_valid_name()', helperStart)
    const helper = command.slice(helperStart, helperEnd + 3)
    const raced = runBash([
      `__sp_token=${quoteForBash(token)}`,
      '__sp_rootDevice=1',
      '__sp_rootInode=2',
      `__sp_objectName=${quoteForBash(objectName)}`,
      `__sp_raceLog=${quoteForBash(toBashPath(raceLog))}`,
      '__sp_sha256_tool=sha256sum',
      '__sp_sha256_stdin() { __sp_hash="$(sha256sum)" || return $?; printf %s "$' + '{__sp_hash%% *}"; }',
      'realpath() { command realpath "$@" || return $?; printf .; }',
      '__sp_mkfifoCount=0',
      'mkfifo() { command mkfifo "$@" || return $?; __sp_mkfifoCount=$((__sp_mkfifoCount + 1)); __sp_fifoPath=""; for __sp_fifoArg do __sp_fifoPath="$__sp_fifoArg"; done; if [ "$__sp_mkfifoCount" -eq 1 ]; then runuser -u nobody -- sh -c \'rm -f -- "$1" && mkfifo -m 600 -- "$1"\' sh "$__sp_fifoPath" >/dev/null 2>&1; printf "replace=%s\\n" "$?" >> "$__sp_raceLog"; else timeout 1 runuser -u nobody -- sh -c \'dd if="$1" of=/dev/null bs=1 count=1 status=none\' sh "$__sp_inputFifo" >/dev/null 2>&1; printf "reader=%s\\n" "$?" >> "$__sp_raceLog"; timeout 1 runuser -u nobody -- sh -c \'printf x > "$1"\' sh "$__sp_inputFifo" >/dev/null 2>&1; printf "writer=%s\\n" "$?" >> "$__sp_raceLog"; fi; return 0; }',
      `exec 3< ${quoteForBash(toBashPath(sourcePath))}`,
      helper,
      '__sp_result="$(__sp_bounded_digest 0 14)"',
      '__sp_status=$?',
      'exec 3<&-',
      '[ "$__sp_status" -eq 0 ]',
      `[ "$__sp_result" = ${quoteForBash(createHash('sha256').update('root-only-fifo').digest('hex'))} ]`,
      `grep -Eq '^replace=[1-9][0-9]*$' ${quoteForBash(toBashPath(raceLog))}`,
      `grep -Eq '^reader=[1-9][0-9]*$' ${quoteForBash(toBashPath(raceLog))}`,
      `grep -Eq '^writer=[1-9][0-9]*$' ${quoteForBash(toBashPath(raceLog))}`,
      `[ ! -e ${quoteForBash(scratchPath)} ]`
    ].join('\n'))
    assert.equal(raced.status, 0, raced.stdout + raced.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('bound pathname mutations require trusted parent proofs and import through a private no-clobber temp', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const token = 'e0'.repeat(24)
  const renameCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'rename-bound',
      args: renameBinding({
        sourceParentUid: '0',
        sourceParentMode: '755',
        targetParentUid: '0',
        targetParentMode: '755'
      })
    }
  })
  const importCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0',
        targetParentUid: '0',
        targetParentMode: '755'
      })
    }
  })
  const mkdirCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'mkdir-bound',
      args: targetEntryBinding({
        targetMode: '700',
        targetUid: '0',
        targetGid: '0',
        targetParentUid: '0',
        targetParentMode: '755'
      })
    }
  })

  for (const command of [renameCommand, importCommand, mkdirCommand]) {
    assert.match(command, /__sp_targetParentUid/)
    assert.match(command, /__sp_targetParentMode/)
    assert.match(command, /& 022/)
  }
  assert.match(renameCommand, /__sp_sourceParentUid/)
  assert.match(renameCommand, /__sp_sourceParentMode/)
  assert.match(importCommand, /mv -nT.*__sp_importTempName/)
  assert.match(importCommand, /exec 4> "\.\/\$__sp_importTempName"/)
  assert.doesNotMatch(importCommand, /exec 4> "\.\/\$__sp_targetName"/)
  assert.match(importCommand, /set -C/)
  const installIndex = importCommand.indexOf(
    'mv -nT -- "./$__sp_importTempName" "./$__sp_targetName"'
  )
  const zeroModeIndex = importCommand.indexOf('chmod -- 0 "$__sp_fd4"')
  const chownIndex = importCommand.indexOf(
    'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4"'
  )
  const finalModeIndex = importCommand.indexOf(
    'chmod -- "$__sp_targetMode" "$__sp_fd4"'
  )
  assert.ok(zeroModeIndex > 0 && zeroModeIndex < installIndex)
  assert.ok(chownIndex > installIndex && chownIndex < finalModeIndex)
  assert.ok(
    importCommand.indexOf('__sp_finalDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")"') >
      chownIndex
  )
  assert.ok(
    importCommand.lastIndexOf('__sp_finalDigest="$(__sp_bounded_digest 0 "$__sp_expectedSize")"') >
      finalModeIndex
  )
})

test('remove-bound accepts a fixed non-root parent and requires exact file content proof', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'ea'.repeat(24),
    request: {
      operation: 'remove-bound',
      args: {
        targetPath: '/root/file',
        targetParentRealPath: '/root',
        targetParentDevice: '4001',
        targetParentInode: '4002',
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'file',
        targetMode: '640',
        targetUid: '1000',
        targetGid: '1000',
        sha256: 'a'.repeat(64),
        size: '12'
      }
    }
  })

  assert.match(command, /__sp_parent_path_matches .*__sp_targetParentDevice.*__sp_targetParentInode/)
  assert.doesNotMatch(command, /__sp_trusted_parent_fd \. .*__sp_targetParentUid/)
  assert.match(command, /__sp_bounded_digest 0 "\$__sp_expectedSize"/)
  assert.match(command, /"\$__sp_expectedSha256"/)
  assert.match(command, /"\$__sp_expectedSize"/)
  const removeIndex = command.indexOf('rm -- "./$__sp_boundName"')
  const finalParentCheck = command.lastIndexOf(
    '__sp_parent_path_matches "$__sp_targetParentRealPath"'
  )
  assert.ok(removeIndex > 0 && finalParentCheck > 0 && finalParentCheck < removeIndex)
  assert.throws(() => buildPrivilegedFileCommand({
    token: 'eb'.repeat(24),
    request: {
      operation: 'remove-bound',
      args: {
        targetPath: '/root/file',
        targetParentRealPath: '/root',
        targetParentDevice: '4001',
        targetParentInode: '4002',
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'file',
        targetMode: '640',
        targetUid: '1000',
        targetGid: '1000'
      }
    }
  }), /sha256|size|参数合同|缺少必要参数/i)
})

test('stage-import trap cleanup preserves same-inode content changed after chmod', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'ee'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanup = stageImportCleanupFunctions(command)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-proof-'))
  try {
    const target = path.join(nativeRoot, 'target')
    const deleteLog = path.join(nativeRoot, 'delete-log')
    fs.writeFileSync(target, 'evil', { mode: 0o600 })
    const stat = fs.statSync(target, { bigint: true })
    const result = runBash([
      `cd -- ${quoteForBash(toBashPath(nativeRoot))}`,
      '__sp_importTempName=temp',
      '__sp_targetName=target',
      '__sp_importTempCreated=0',
      '__sp_importInstalled=1',
      `__sp_tempDevice=${stat.dev}`,
      `__sp_tempInode=${stat.ino}`,
      `__sp_expectedSha256=${sha256Text('safe')}`,
      '__sp_expectedSize=4',
      `__sp_targetUid=${stat.uid}`,
      `__sp_targetGid=${stat.gid}`,
      `__sp_targetMode=${(stat.mode & 0o7777n).toString(8)}`,
      '__sp_importMetadataKnown=1',
      `__sp_importMetadataUid=${stat.uid}`,
      `__sp_importMetadataGid=${stat.gid}`,
      `__sp_importMetadataMode=${(stat.mode & 0o7777n).toString(8)}`,
      '__sp_gid_effective=0',
      '__sp_targetParentRealPath=.',
      '__sp_targetParentDevice=1',
      '__sp_targetParentInode=2',
      '__sp_targetParentUid=0',
      '__sp_targetParentMode=700',
      '__sp_trusted_parent_path_matches() { return 0; }',
      '__sp_path_matches_fd() { return 0; }',
      '__sp_fd_entry_matches() { return 0; }',
      '__sp_bounded_digest() { dd bs=65536 iflag=count_bytes count="$2" <&3 2>/dev/null | sha256sum | cut -d" " -f1; }',
      `rm() { printf deleted > ${quoteForBash(toBashPath(deleteLog))}; command rm "$@"; }`,
      cleanup,
      '__sp_import_cleanup',
      '__sp_cleanup_status=$?',
      '[ "$__sp_cleanup_status" -ne 0 ]',
      '[ -f ./target ]',
      `[ ! -e ${quoteForBash(toBashPath(deleteLog))} ]`
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(fs.readFileSync(target, 'utf8'), 'evil')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage-import records metadata only after each successful transition', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e0'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '640',
        targetUid: '1',
        targetGid: '2'
      })
    }
  })
  const initialProof = command.indexOf('__sp_importMetadataMode=600')
  const lockedDown = command.indexOf('__sp_importMetadataMode=0', initialProof + 1)
  const chown = command.indexOf(
    'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4"'
  )
  const chownRecorded = command.indexOf(
    '__sp_importMetadataUid="$__sp_targetUid"', chown
  )
  const chmod = command.indexOf('chmod -- "$__sp_targetMode" "$__sp_fd4"')
  const chmodRecorded = command.indexOf(
    '__sp_importMetadataMode="$__sp_targetMode"', chmod
  )

  assert.ok(initialProof > command.indexOf('stat -L -c %g -- "$__sp_fd4"'))
  assert.ok(lockedDown > command.indexOf('chmod -- 0 "$__sp_fd4"'))
  assert.ok(chownRecorded > chown)
  assert.ok(chmodRecorded > chmod)
})

test('stage-import trap cleanup removes the exact target after chown failure', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e1'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '1',
        targetGid: '1'
      })
    }
  })
  runTrackedImportCleanup({
    cleanup: stageImportCleanupFunctions(command),
    actualMode: '000',
    trackedMode: '"$__sp_actualMode"',
    targetMode: '600',
    targetIdentityMatches: false,
    expectDeleted: true
  })
})

test('stage-import trap cleanup removes the exact target after chmod failure', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e2'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  runTrackedImportCleanup({
    cleanup: stageImportCleanupFunctions(command),
    actualMode: '000',
    trackedMode: '"$__sp_actualMode"',
    targetMode: '600',
    targetIdentityMatches: true,
    expectDeleted: true
  })
})

test('stage-import trap cleanup preserves metadata changed from its tracked state', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e3'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  runTrackedImportCleanup({
    cleanup: stageImportCleanupFunctions(command),
    actualMode: '600',
    trackedMode: '0',
    targetMode: '"$__sp_actualMode"',
    targetIdentityMatches: true,
    expectDeleted: false
  })
})

test('stage-import moving cleanup refuses two exact hardlink locations', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e4'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanup = stageImportCleanupFunctions(command)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-moving-'))
  try {
    const result = runBash([
      `cd -- ${quoteForBash(toBashPath(nativeRoot))}`,
      'printf safe > temp',
      'chmod 600 temp',
      'ln temp target',
      '__sp_importTempName=temp',
      '__sp_targetName=target',
      '__sp_importTempCreated=1',
      '__sp_importInstalled=0',
      '__sp_importMoving=1',
      '__sp_importClaimMayExist=0',
      '__sp_tempDevice="$(stat -c %d -- temp)"',
      '__sp_tempInode="$(stat -c %i -- temp)"',
      `__sp_expectedSha256=${sha256Text('safe')}`,
      '__sp_expectedSize=4',
      '__sp_importMetadataKnown=1',
      '__sp_importMetadataUid="$(stat -c %u -- temp)"',
      '__sp_importMetadataGid="$(stat -c %g -- temp)"',
      '__sp_importMetadataMode=600',
      '__sp_targetParentRealPath=.',
      '__sp_targetParentDevice=1',
      '__sp_targetParentInode=2',
      '__sp_targetParentUid=0',
      '__sp_targetParentMode=700',
      '__sp_trusted_parent_path_matches() { return 0; }',
      '__sp_path_matches_fd() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ]; }',
      '__sp_fd_entry_matches() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ -f "$1" ]; }',
      '__sp_entry_matches() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ -f "$1" ]; }',
      '__sp_bounded_digest() { dd bs=65536 iflag=count_bytes count="$2" <&3 2>/dev/null | sha256sum | cut -d" " -f1; }',
      cleanup,
      '__sp_import_cleanup_candidate() { rm -f -- "$1"; }',
      '__sp_import_cleanup',
      '__sp_cleanup_status=$?',
      '[ "$__sp_cleanup_status" -ne 0 ]',
      '[ -f temp ] && [ -f target ]',
      '[ "$(stat -c %i -- temp)" = "$(stat -c %i -- target)" ]'
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage-import moving cleanup rescans both paths after digest before unlink', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e5'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanup = stageImportCleanupFunctions(command)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-rescan-'))
  try {
    const statusPath = path.join(nativeRoot, 'cleanup-status')
    const result = runBash([
      `cd -- ${quoteForBash(toBashPath(nativeRoot))}`,
      'printf safe > temp',
      'chmod 600 temp',
      '__sp_importTempName=temp',
      '__sp_targetName=target',
      '__sp_importTempCreated=1',
      '__sp_importInstalled=0',
      '__sp_importMoving=1',
      '__sp_importClaimMayExist=0',
      '__sp_tempDevice="$(stat -c %d -- temp)"',
      '__sp_tempInode="$(stat -c %i -- temp)"',
      `__sp_expectedSha256=${sha256Text('safe')}`,
      '__sp_expectedSize=4',
      '__sp_importMetadataKnown=1',
      '__sp_importMetadataUid="$(stat -c %u -- temp)"',
      '__sp_importMetadataGid="$(stat -c %g -- temp)"',
      '__sp_importMetadataMode=600',
      '__sp_targetParentRealPath=.',
      '__sp_targetParentDevice=1',
      '__sp_targetParentInode=2',
      '__sp_targetParentUid=0',
      '__sp_targetParentMode=700',
      '__sp_trusted_parent_path_matches() { return 0; }',
      '__sp_path_matches_fd() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ]; }',
      '__sp_fd_entry_matches() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ -f "$1" ]; }',
      '__sp_entry_matches() { [ "$(stat -L -c %d -- "$1")" = "$2" ] && [ "$(stat -L -c %i -- "$1")" = "$3" ] && [ -f "$1" ]; }',
      '__sp_bounded_digest() { ln temp target || return 1; dd bs=65536 iflag=count_bytes count="$2" <&3 2>/dev/null | sha256sum | cut -d" " -f1; }',
      cleanup,
      '__sp_import_cleanup',
      '__sp_cleanup_status=$?',
      `printf %s "$__sp_cleanup_status" > ${quoteForBash(toBashPath(statusPath))}`
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.notEqual(fs.readFileSync(statusPath, 'utf8'), '0')
    assert.equal(fs.existsSync(path.join(nativeRoot, 'temp')), true)
    assert.equal(fs.existsSync(path.join(nativeRoot, 'target')), true)
    assert.equal(
      fs.statSync(path.join(nativeRoot, 'temp')).ino,
      fs.statSync(path.join(nativeRoot, 'target')).ino
    )
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage-import synchronous cleanup makes uniqueness proof adjacent to unlink', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e6'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanup = stageImportCleanupFunctions(command)
  const candidateStart = cleanup.indexOf('__sp_import_cleanup_candidate()')
  const candidateEnd = cleanup.indexOf('; __sp_import_cleanup()', candidateStart)
  const candidate = cleanup.slice(candidateStart, candidateEnd)
  const digest = candidate.indexOf('__sp_bounded_digest')
  const finalScan = candidate.indexOf(
    '__sp_import_cleanup_exact_locations',
    digest
  )
  const unlink = candidate.indexOf('rm -f --', finalScan)
  const postcheck = candidate.indexOf(
    '__sp_import_cleanup_exact_locations',
    unlink
  )
  assert.ok(digest >= 0)
  assert.ok(finalScan > digest)
  assert.ok(unlink > finalScan)
  assert.ok(postcheck > unlink)
  assert.match(candidate, /ExactCount.*-eq 1/)
  assert.match(candidate, /ExactCount.*-eq 0/)
})

test('digest cleanup identity is stable across PTY request tokens', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const args = boundedDigestBinding({ objectName: 'download-stable-scratch-id' })
  const digest = buildPrivilegedFileCommand({
    token: 'ec'.repeat(24),
    request: { operation: 'sha256-bound', args }
  })
  const cleanup = buildPrivilegedFileCommand({
    token: 'ed'.repeat(24),
    request: {
      operation: 'digest-cleanup',
      args: stageBinding({ objectName: args.objectName })
    }
  })

  for (const command of [digest, cleanup]) {
    assert.match(command, /\.shellpilot-digest-\$__sp_rootDevice-\$__sp_rootInode-\$__sp_objectName/)
    assert.doesNotMatch(command, /\.shellpilot-digest-\$__sp_token-/)
  }
})

test('linux digest cleanup removes a residual created by a different request token', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-digest-retry-'))
  const objectName = `download-${'ef'.repeat(24)}`
  let scratch
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'digest-retry')
    scratch = `/tmp/.shellpilot-digest-${fixture.binding.rootDevice}-${fixture.binding.rootInode}-${objectName}`
    fs.mkdirSync(scratch, { mode: 0o700 })
    fs.chmodSync(scratch, 0o700)
    const cleaned = await runRealProtocolOperation({
      operation: 'digest-cleanup',
      token: 'f0'.repeat(24),
      args: { ...fixture.binding, objectName }
    })
    assert.equal(cleaned.execution.status, 0, cleaned.execution.stderr)
    assert.equal(fs.existsSync(scratch), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
    if (scratch && fs.existsSync(scratch)) fs.rmdirSync(scratch)
  }
})

test('metadata-bound is the only deferred directory metadata operation', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'e1'.repeat(24),
    request: {
      operation: 'metadata-bound',
      args: {
        targetPath: '/root/copied',
        targetParentRealPath: '/root',
        targetParentDevice: '1',
        targetParentInode: '2',
        targetParentUid: '0',
        targetParentMode: '755',
        targetDevice: '1',
        targetInode: '3',
        targetType: 'directory',
        targetMode: '750',
        targetUid: '21',
        targetGid: '22'
      }
    }
  })
  assert.match(command, /__sp_entry_matches/)
  assert.match(
    command,
    /__sp_fd_entry_matches "\$__sp_fd5" "\$__sp_targetDevice" "\$__sp_targetInode" "\$__sp_targetType"/
  )
  assert.doesNotMatch(
    command,
    /__sp_entry_matches "\$__sp_fd5" "\$__sp_targetDevice"/
  )
  assert.equal(
    command.lastIndexOf('chown -- "$__sp_targetUid') <
      command.lastIndexOf('chmod -- "$__sp_targetMode'),
    true
  )
})

test('new bound mutation and digest commands have valid outer and inner shell syntax', {
  skip: !bashAvailable
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const requests = [
    { operation: 'sha256-bound', args: boundedDigestBinding() },
    {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    },
    {
      operation: 'stage-import-cleanup',
      args: importCleanupBinding()
    },
    { operation: 'rename-bound', args: renameBinding() },
    { operation: 'digest-cleanup', args: stageBinding() },
    {
      operation: 'touch-bound',
      args: targetEntryBinding({
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'file'
      })
    },
    {
      operation: 'metadata-bound',
      args: targetEntryBinding({
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'directory',
        targetMode: '750',
        targetUid: '21',
        targetGid: '22'
      })
    }
  ]
  for (const request of requests) {
    const command = buildPrivilegedFileCommand({
      token: 'e2'.repeat(24),
      request
    })
    const outer = spawnSync(
      bashExecutable,
      ['--noprofile', '--norc', '-n'],
      { encoding: 'utf8', input: command }
    )
    assert.equal(outer.status, 0, `${request.operation}: ${outer.stderr}`)
    const extracted = runBash(
      `set -- ${command}\n` + 'printf \'%s\' "$' + '{!#}"'
    )
    assert.equal(extracted.status, 0, `${request.operation}: ${extracted.stderr}`)
    const inner = spawnSync(
      bashExecutable,
      ['--noprofile', '--norc', '-n'],
      { encoding: 'utf8', input: extracted.stdout }
    )
    assert.equal(inner.status, 0, `${request.operation}: ${inner.stderr}`)
  }
})

test('privileged command builder exposes every fixed operation and fails closed on arguments', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileProtocol,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = 'c'.repeat(48)
  const cases = [
    ['probe', {}, ':'],
    ['list', { path: '/x' }, './.[!.]* ./..?* ./*'],
    ['list-bound', sourceEntryBinding({ path: '/root/source' }),
      '__sp_entry_matches "./$__sp_boundName"'],
    ['lstat', { path: '/x' }, '__sp_lstatParentReal'],
    ['lstat-bound', {
      path: '/root/source',
      sourceParentRealPath: '/root',
      sourceParentDevice: '3001',
      sourceParentInode: '3002'
    }, '__sp_bind_entry_parent "$__sp_path"'],
    ['stat', { path: '/x' }, '__sp_emit_stat "$__sp_path" stat'],
    ['readlink', { path: '/x' }, '__sp_emit_text "$(readlink -- "$__sp_path")"'],
    ['realpath', { path: '/x' }, '__sp_emit_text "$(realpath -- "$__sp_path")"'],
    ['rename-bound', renameBinding(), 'mv -nT -- "$__sp_sourceRef"'],
    ['mkdir-bound', targetEntryBinding({
      targetMode: '700', targetUid: '0', targetGid: '0'
    }), 'mkdir -- "./$__sp_boundName"'],
    ['metadata-bound', targetEntryBinding({
      targetDevice: '4003',
      targetInode: '4004',
      targetType: 'directory',
      targetMode: '750',
      targetUid: '21',
      targetGid: '22'
    }), 'chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd5"'],
    ['touch-bound', targetEntryBinding({
      targetDevice: '4003',
      targetInode: '4004',
      targetType: 'file'
    }), 'touch -c -- "$__sp_fd5"'],
    ['remove-bound', {
      targetPath: '/root/target',
      targetParentRealPath: '/root',
      targetParentDevice: '4001',
      targetParentInode: '4002',
      targetDevice: '4003',
      targetInode: '4004',
      targetType: 'file',
      targetMode: '640',
      targetUid: '21',
      targetGid: '22',
      sha256: 'd'.repeat(64),
      size: '12'
    }, '__sp_entry_matches "./$__sp_boundName"'],
    ['digest-cleanup', stageBinding(), '__sp_digestScratch'],
    ['sha256', { path: '/x' }, '__sp_run_operation() { return 1; }'],
    ['sha256-bound', boundedDigestBinding(), '__sp_bounded_digest'],
    ['sha256-range-bound', boundedDigestBinding({
      offset: '0', maxBytes: '12'
    }), '__sp_bounded_digest']
  ]

  for (const [operation, args, source] of cases) {
    const command = buildPrivilegedFileCommand({
      token,
      request: createPrivilegedFileRequest({ operation, args })
    })
    assert.equal(command.includes(source), true, operation)
    assert.match(command, /698;SHELLPILOT_FILE/)
    assert.doesNotMatch(command, /\beval\b|xargs[^;]*\bsh\b/, operation)
    assert.doesNotMatch(command, /\bdo;/, operation)
  }

  const stageCases = [
    ['stage-handshake', {
      rootPath: '/stage',
      challengeName: 'challenge-token',
      responseName: 'response-token',
      challenge: 'a'.repeat(64),
      challengeSize: '48',
      rootUid: '1000',
      rootGid: '1000',
      rootMode: '700'
    }, /challenge|response/],
    ['stage-export', sourceStageBinding({
      sourcePath: '/root/secret'
    }), /exec 3>/],
    ['stage-export-range', sourceStageBinding({
      sourcePath: '/root/secret', offset: '0', maxBytes: '12'
    }), /iflag=skip_bytes,count_bytes/],
    ['stage-import', targetStageBinding({
      targetPath: '/root/target',
      sha256: 'b'.repeat(64),
      size: '12',
      targetMode: '600',
      targetUid: '0',
      targetGid: '0'
    }), /exec 4> "\.\/\$__sp_importTempName"/],
    ['stage-import-cleanup', importCleanupBinding(),
      /__sp_import_residual_exact_count/],
    ['stage-cleanup', cleanupBinding(), /rm -f/]
  ]
  for (const [operation, args, source] of stageCases) {
    const command = buildPrivilegedFileCommand({
      token,
      request: createPrivilegedFileRequest({ operation, args })
    })
    assert.match(command, source, operation)
    for (const value of Object.values(args)) {
      if (!value) continue
      assert.equal(command.includes(Buffer.from(value).toString('base64')), true)
    }
  }

  assert.equal(Object.isFrozen(createPrivilegedFileProtocol()), true)
  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: { operation: 'rename-bound', args: { sourcePath: '/a' } }
    }),
    /缺少必要参数/
  )
  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: { operation: 'probe', args: { path: '/not-allowed' } }
    }),
    /参数合同/
  )
  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: { operation: 'lstat', args: { path: '' } }
    }),
    /缺少必要参数/
  )
})

test('privileged protocol rejects every legacy unbound mutation operation', async () => {
  const { createPrivilegedFileRequest } = await importModule(protocolModule)
  const cases = [
    ['mkdir', { path: '/root/x' }],
    ['touch', { path: '/root/x' }],
    ['rename', { source: '/root/a', target: '/root/b' }],
    ['rm', { path: '/root/x' }],
    ['rmdir', { path: '/root/x' }],
    ['chmod', { path: '/root/x', mode: '600' }],
    ['chown', { path: '/root/x', uid: '0', gid: '0' }],
    ['copy-entry', { source: '/root/a', target: '/root/b' }],
    ['remove-entry', { path: '/root/x' }],
    ['remove-empty-directory', { path: '/root/x' }]
  ]
  for (const [operation, args] of cases) {
    assert.throws(
      () => createPrivilegedFileRequest({ operation, args }),
      /不支持/
    )
  }
})

test('bound creators and digest workers install interruption cleanup before claims', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const token = 'ac'.repeat(24)
  const imported = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'b'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  assert.match(imported, /__sp_importTempName="\.shellpilot-\$__sp_objectName\.tmp"/)
  assert.match(imported, /trap .* 0 HUP INT TERM/)
  assert.match(imported, /mv -nT -- "\.\/\$__sp_importTempName" "\.\/\$__sp_targetName"/)
  assert.doesNotMatch(imported, /exec 4> "\.\/\$__sp_targetName"/)
  assert.ok(imported.indexOf('trap ') < imported.indexOf('exec 4> "./$__sp_importTempName"'))

  const mkdir = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'mkdir-bound',
      args: targetEntryBinding({
        targetMode: '700', targetUid: '0', targetGid: '0'
      })
    }
  })
  assert.match(mkdir, /trap .* 0 HUP INT TERM/)
  assert.ok(mkdir.indexOf('trap ') < mkdir.indexOf('mkdir -- "./$__sp_boundName"'))
  assert.match(mkdir, /__sp_cleanup_created_directory/)

  const digest = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'sha256-bound',
      args: boundedDigestBinding()
    }
  })
  assert.match(digest, /trap .* 0 HUP INT TERM/)
  assert.match(digest, /kill "\$__sp_producerPid"/)
  assert.match(digest, /kill "\$__sp_consumerPid"/)
  assert.match(digest, /wait .*__sp_producerPid/)
  assert.match(digest, /wait .*__sp_consumerPid/)
  assert.ok(
    digest.indexOf('trap __sp_digest_trap') <
      digest.indexOf('mkfifo -m 600 -- "$__sp_inputFifo"')
  )
  assert.ok(
    digest.indexOf('trap __sp_digest_trap') <
      digest.indexOf('mkdir -- "$__sp_scratch"')
  )

  const digestCleanup = buildPrivilegedFileCommand({
    token,
    request: { operation: 'digest-cleanup', args: stageBinding() }
  })
  assert.match(digestCleanup, /stat -c %u -- \/tmp.*= 0/)
  assert.match(digestCleanup, /digestTmpMode.*& 01000/)
})

test('stage-import signal cleanup is constant-time and defers proof I/O', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'ad'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'b'.repeat(64),
        size: String(8 * 1024 * 1024),
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const signalStart = command.indexOf('__sp_import_signal_trap()')
  const signalEnd = command.indexOf('; __sp_import_exit_trap()', signalStart)
  assert.ok(signalStart >= 0 && signalEnd > signalStart)
  const signalHandler = command.slice(signalStart, signalEnd)
  const exitStart = command.indexOf('__sp_import_exit_trap()')
  const exitEnd = command.indexOf('; trap __sp_import_exit_trap 0', exitStart)
  assert.ok(exitStart >= 0 && exitEnd > exitStart)
  const exitHandler = command.slice(exitStart, exitEnd)
  const finalizeStart = command.indexOf('__sp_import_finalize()')
  const finalizeEnd = command.indexOf('; __sp_importSignalled=', finalizeStart)
  assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart)
  const finalizer = command.slice(finalizeStart, finalizeEnd)

  assert.match(command, /trap __sp_import_signal_trap HUP INT TERM/)
  assert.match(command, /trap __sp_import_exit_trap 0/)
  assert.match(signalHandler, /__sp_importSignalled=1/)
  assert.match(signalHandler, /exec 3<&- 4>&- 5<&-/)
  assert.match(signalHandler,
    /__sp_importTempCreated.*= 0.*__sp_importInstalled.*= 0.*__sp_importMoving.*= 0.*__sp_importClaimMayExist/)
  assert.doesNotMatch(signalHandler, /__sp_import_cleanup|__sp_bounded_digest|sha256/)
  assert.match(command, /__sp_import_exit_trap\(\).*__sp_importSignalled.*-ne 1.*__sp_import_cleanup/)
  assert.match(exitHandler, /__sp_import_cleanup/)
  assert.doesNotMatch(exitHandler, /__sp_emit_install/)
  assert.match(finalizer, /__sp_importCleanupStatus.*-eq 0/)
  assert.match(command,
    /__sp_import_emit_residual\(\).*__sp_importInstalled.*__sp_emit_install/)
  const tempClaimIndex = command.indexOf(
    '__sp_emit_temp_claim "$__sp_tempDevice" "$__sp_tempInode"'
  )
  const copyIndex = command.indexOf(
    'dd bs=65536 iflag=count_bytes',
    tempClaimIndex
  )
  assert.ok(tempClaimIndex >= 0 && tempClaimIndex < copyIndex)
  assert.match(finalizer, /__sp_emit_import_cleanup/)
  assert.ok(command.indexOf('__sp_import_finalize "$__sp_status"') <
    command.indexOf(';end;%s'))
  assert.match(command, /__sp_importTempName="\.shellpilot-\$__sp_objectName\.tmp"/)
})

test('stage-import publishes an exact moving claim before the no-clobber move', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'b7'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '640',
        targetUid: '7',
        targetGid: '8'
      })
    }
  })
  const moving = command.indexOf(
    '__sp_emit_moving "$__sp_tempDevice" "$__sp_tempInode"'
  )
  const defer = command.lastIndexOf(
    'trap __sp_import_defer_signal HUP INT TERM',
    moving
  )
  const movingState = command.indexOf('__sp_importMoving=1', moving)
  const restore = command.indexOf(
    'trap __sp_import_signal_trap HUP INT TERM',
    movingState
  )
  const pending = command.indexOf('__sp_importSignalPending', restore)
  const move = command.indexOf(
    'mv -nT -- "./$__sp_importTempName" "./$__sp_targetName"'
  )

  assert.ok(moving >= 0 && moving < move)
  assert.ok(defer >= 0 && defer < moving)
  assert.ok(moving < movingState && movingState < restore)
  assert.ok(restore < pending && pending < move)
  assert.match(command, /__sp_importMoving=1/)
  assert.match(command,
    /__sp_import_emit_residual\(\).*__sp_importMoving.*import_cleanup 0 moving/)
})

test('stage-import defers a signal until the moving marker and state agree', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'b9'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: sha256Text('safe'),
        size: '4',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const trapsStart = command.indexOf('__sp_importSignalled=0')
  const trapsEnd = command.indexOf('; umask 077', trapsStart)
  const transitionStart = command.indexOf(
    '__sp_importSignalPending=0',
    command.indexOf('chmod -- 0 "$__sp_fd4"')
  )
  const transitionEnd = command.indexOf('; mv -nT', transitionStart)
  assert.ok(trapsStart >= 0 && trapsEnd > trapsStart)
  assert.ok(transitionStart >= 0 && transitionEnd > transitionStart)

  const result = runBash([
    '__sp_importTempCreated=1',
    '__sp_importInstalled=0',
    '__sp_importMoving=0',
    '__sp_importClaimMayExist=0',
    '__sp_importTempClaimEmitted=1',
    '__sp_importTargetClaimEmitted=0',
    '__sp_tempDevice=1',
    '__sp_tempInode=2',
    '__sp_importMetadataKnown=1',
    '__sp_importMetadataMode=0',
    '__sp_importMetadataUid=0',
    '__sp_importMetadataGid=0',
    '__sp_expectedSha256=' + sha256Text('safe'),
    '__sp_expectedSize=4',
    '__sp_import_cleanup() { :; }',
    '__sp_emit_import_cleanup() { printf "cleanup:%s:%s\\n" "$1" "$2"; }',
    '__sp_emit_install() { printf installed; }',
    '__sp_import_emit_residual() { printf "residual-moving:%s\\n" "$__sp_importMoving"; }',
    '__sp_emit_moving() { printf moving-marker; kill -TERM $$; return 0; }',
    command.slice(trapsStart, trapsEnd),
    command.slice(transitionStart, transitionEnd),
    'exit 99'
  ].join('\n'))
  assert.notEqual(result.status, 99, result.stdout + result.stderr)
  assert.match(result.stdout, /moving-marker/)
  assert.match(result.stdout, /residual-moving:1/)
  assert.doesNotMatch(result.stdout, /cleanup:1:none/)
})

test('stage-import parser preserves a frozen moving claim and enforces its state order', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = 'b8'.repeat(24)
  const request = {
    operation: 'stage-import',
    args: targetStageBinding({
      sha256: 'b'.repeat(64),
      size: '12',
      targetMode: '640',
      targetUid: '7',
      targetGid: '8'
    })
  }
  const temp = ['temp-claim', ['4003', '4004']]
  const moving = ['moving', ['4003', '4004', '9']]
  const cleanup = ['import-cleanup', ['0', 'moving']]

  function parseImport (markers, exitCode = 1) {
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(startMarker(token, allCapabilities))
    for (const [kind, values] of markers) {
      parser.push(fileMarker(
        token,
        'data',
        '1',
        '1',
        kind,
        ...values.map(encodeMarkerField)
      ))
    }
    parser.push(fileMarker(token, 'end', String(exitCode)))
    return parser.result()
  }

  const result = parseImport([temp, moving, cleanup])
  assert.deepEqual(result.movingClaim, {
    tempPath: '/root/.shellpilot-operation-token.tmp',
    targetPath: '/root/target',
    tempDevice: '4003',
    tempInode: '4004',
    tempType: 'file',
    tempParentRealPath: '/root',
    tempParentDevice: '4001',
    tempParentInode: '4002',
    tempParentUid: 0,
    tempParentMode: 0o755,
    targetParentRealPath: '/root',
    targetParentDevice: '4001',
    targetParentInode: '4002',
    targetParentUid: 0,
    targetParentMode: 0o755,
    sha256: 'b'.repeat(64),
    size: 12,
    initialMode: 0,
    initialUid: 0,
    initialGid: 9,
    targetMode: 0o640,
    targetUid: 7,
    targetGid: 8
  })
  assert.equal(result.cleanupSucceeded, false)
  assert.equal(result.residualLocation, 'moving')
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.movingClaim), true)

  for (const markers of [
    [moving, cleanup],
    [temp, ['moving', ['4003', '4999', '9']], cleanup],
    [temp, moving, moving, cleanup],
    [temp, moving, ['import-cleanup', ['0', 'temp']]],
    [temp, moving, ['installed', [
      'b'.repeat(64), '12', '4003', '4999', '640', '7', '8'
    ]], ['import-cleanup', ['1', 'complete']]],
    [temp, ['installed', [
      'b'.repeat(64), '12', '4003', '4004', '640', '7', '8'
    ]], ['import-cleanup', ['1', 'complete']]],
    [temp, ['import-cleanup', ['0', 'temp']], moving]
  ]) {
    assert.throws(() => parseImport(markers), /stage-import|数据|顺序|结束边界/)
  }
})

test('linux stage-import signal returns before a slow full-proof cleanup', {
  skip: process.platform !== 'linux' || !bashAvailable
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'ae'.repeat(24),
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'b'.repeat(64),
        size: String(8 * 1024 * 1024),
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const trapStart = command.indexOf('__sp_importSignalled=0')
  const trapEnd = command.indexOf('; umask 077', trapStart)
  assert.ok(trapStart >= 0 && trapEnd > trapStart)
  const cleanupLog = path.join(os.tmpdir(), `sp-signal-cleanup-${process.pid}`)
  fs.rmSync(cleanupLog, { force: true })
  const startedAt = Date.now()
  const result = spawnSync(bashExecutable, ['--noprofile', '--norc'], {
    encoding: 'utf8',
    timeout: 3000,
    input: [
      `__sp_cleanup_log=${quoteForBash(cleanupLog)}`,
      '__sp_import_cleanup() { printf called > "$__sp_cleanup_log"; sleep 10; }',
      command.slice(trapStart, trapEnd),
      '( sleep 0.05; kill -TERM $$ ) &',
      'sleep 10'
    ].join('\n')
  })
  assert.notEqual(result.error?.code, 'ETIMEDOUT', result.stderr)
  assert.ok(Date.now() - startedAt < 2500)
  assert.equal(fs.existsSync(cleanupLog), false)
})

test('privileged parser normalizes every fixed result shape', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = 'd'.repeat(48)

  function parse (operation, kind, values = [], exitCode = 0) {
    const request = operation === 'stage-import'
      ? {
          operation,
          args: targetStageBinding({
            sha256: 'b'.repeat(64),
            size: '12',
            targetMode: '600',
            targetUid: '0',
            targetGid: '0'
          })
        }
      : operation === 'stage-import-cleanup'
        ? { operation, args: importCleanupBinding() }
        : { operation }
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(startMarker(token, allCapabilities))
    if (kind) {
      parser.push(fileMarker(
        token,
        'data',
        '1',
        '1',
        kind,
        ...values.map(encodeMarkerField)
      ))
    }
    parser.push(fileMarker(token, 'end', String(exitCode)))
    return parser.result()
  }

  function parseImport (markers, exitCode) {
    const request = {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'b'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
    const parser = createPrivilegedFileParser({ token, request })
    parser.push(startMarker(token, allCapabilities))
    for (const [kind, values] of markers) {
      parser.push(fileMarker(
        token,
        'data',
        '1',
        '1',
        kind,
        ...values.map(encodeMarkerField)
      ))
    }
    parser.push(fileMarker(token, 'end', String(exitCode)))
    return parser.result()
  }

  assert.deepEqual(parse('probe'), {
    kind: 'probe',
    capabilities: allCapabilityObject,
    ok: true
  })
  assert.deepEqual(parse('touch-bound'), {
    kind: 'touch-bound',
    capabilities: allCapabilityObject,
    ok: true
  })
  assert.deepEqual(parse('digest-cleanup'), {
    kind: 'digest-cleanup',
    capabilities: allCapabilityObject,
    ok: true
  })
  assert.deepEqual(parse('stage-import-cleanup', 'import-cleanup', [
    '1', 'none'
  ]), {
    kind: 'stage-import-cleanup',
    capabilities: allCapabilityObject,
    cleanupSucceeded: true,
    residualLocation: 'none'
  })
  assert.deepEqual(parse('stat', 'metadata', ['41ed;4;1;2;3;4']), {
    kind: 'stat',
    capabilities: allCapabilityObject,
    metadata: {
      mode: 0o40755,
      type: 'directory',
      size: 4,
      atime: 1,
      mtime: 2,
      uid: 3,
      gid: 4
    }
  })
  assert.deepEqual(parse('readlink', 'text', ["target\n'"]), {
    kind: 'readlink',
    capabilities: allCapabilityObject,
    text: "target\n'"
  })
  assert.deepEqual(parse('stage-handshake', 'handshake', [
    'a'.repeat(64), '1000', '1001', '700', '/real/stage', '2049', '12345'
  ]), {
    kind: 'stage-handshake',
    capabilities: Object.fromEntries(
      allCapabilities.split(',').map(value => [value.split('=')[0], true])
    ),
    response: 'a'.repeat(64),
    uid: '1000',
    gid: '1001',
    mode: '700',
    rootRealPath: '/real/stage',
    rootDevice: '2049',
    rootInode: '12345'
  })
  for (const operation of [
    'stage-export', 'stage-export-range', 'sha256', 'sha256-bound',
    'sha256-range-bound'
  ]) {
    assert.deepEqual(parse(operation, 'digest', ['b'.repeat(64), '12']), {
      kind: operation,
      capabilities: allCapabilityObject,
      sha256: 'b'.repeat(64),
      size: 12
    })
  }
  const installed = parseImport([
    ['temp-claim', ['4003', '4004']],
    ['moving', ['4003', '4004', '0']],
    ['installed', [
      'b'.repeat(64), '12', '4003', '4004', '600', '0', '0'
    ]],
    ['import-cleanup', ['1', 'complete']]
  ], 0)
  assert.deepEqual(installed, {
    kind: 'stage-import',
    capabilities: allCapabilityObject,
    sha256: 'b'.repeat(64),
    size: 12,
    targetDevice: '4003',
    targetInode: '4004',
    tempClaim: {
      tempPath: '/root/.shellpilot-operation-token.tmp',
      tempDevice: '4003',
      tempInode: '4004',
      tempType: 'file',
      tempParentRealPath: '/root',
      tempParentDevice: '4001',
      tempParentInode: '4002'
    },
    movingClaim: {
      tempPath: '/root/.shellpilot-operation-token.tmp',
      targetPath: '/root/target',
      tempDevice: '4003',
      tempInode: '4004',
      tempType: 'file',
      tempParentRealPath: '/root',
      tempParentDevice: '4001',
      tempParentInode: '4002',
      tempParentUid: 0,
      tempParentMode: 0o755,
      targetParentRealPath: '/root',
      targetParentDevice: '4001',
      targetParentInode: '4002',
      targetParentUid: 0,
      targetParentMode: 0o755,
      sha256: 'b'.repeat(64),
      size: 12,
      initialMode: 0,
      initialUid: 0,
      initialGid: 0,
      targetMode: 0o600,
      targetUid: 0,
      targetGid: 0
    },
    targetClaim: {
      targetPath: '/root/target',
      targetDevice: '4003',
      targetInode: '4004',
      targetType: 'file',
      targetParentRealPath: '/root',
      targetParentDevice: '4001',
      targetParentInode: '4002',
      sha256: 'b'.repeat(64),
      size: 12,
      mode: 0o600,
      uid: 0,
      gid: 0
    },
    cleanupSucceeded: true,
    residualLocation: 'complete'
  })
  assert.equal(Object.isFrozen(installed), true)
  assert.equal(Object.isFrozen(installed.tempClaim), true)
  assert.equal(Object.isFrozen(installed.movingClaim), true)
  assert.equal(Object.isFrozen(installed.targetClaim), true)
  const failedInstalled = parseImport([
    ['temp-claim', ['4003', '4004']],
    ['moving', ['4003', '4004', '0']],
    ['installed', [
      'b'.repeat(64), '12', '4003', '4004', '600', '0', '0'
    ]],
    ['import-cleanup', ['0', 'target']]
  ], 1)
  assert.deepEqual(failedInstalled, {
    ...installed,
    cleanupSucceeded: false,
    residualLocation: 'target',
    ok: false
  })
  assert.equal(Object.isFrozen(failedInstalled), true)
  assert.equal(Object.isFrozen(failedInstalled.tempClaim), true)
  assert.equal(Object.isFrozen(failedInstalled.movingClaim), true)
  assert.equal(Object.isFrozen(failedInstalled.targetClaim), true)
  assert.deepEqual(parseImport([
    ['import-cleanup', ['1', 'none']]
  ], 1), {
    kind: 'stage-import',
    capabilities: allCapabilityObject,
    cleanupSucceeded: true,
    residualLocation: 'none',
    ok: false
  })
  assert.throws(() => parseImport([
    ['installed', [
      'b'.repeat(64), '12', '4003', '4004', '600', '0', '0'
    ]],
    ['import-cleanup', ['1', 'complete']]
  ], 0), /temp claim|cleanup 状态/)
  assert.deepEqual(parse('mkdir-bound', 'binding', ['4003', '4004']), {
    kind: 'mkdir-bound',
    capabilities: allCapabilityObject,
    device: '4003',
    inode: '4004'
  })
})

test('stage parser rejects forged success when a required capability is false', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = '4'.repeat(48)
  const cases = [
    ['stage-handshake', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
      'procFd', 'noclobber', 'gnuStat', 'realpath', 'chown'
    ], [
      'handshake', 'a'.repeat(64), '1000', '1001', '700',
      '/real/stage', '2049', '12345'
    ]],
    ['stage-export', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
      'procFd', 'noclobber', 'gnuDd', 'gnuStat', 'realpath', 'chown',
      'chmod', 'rm'
    ], [
      'digest', 'b'.repeat(64), '12'
    ]],
    ['stage-import', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
      'procFd', 'noclobber', 'cat', 'gnuStat', 'gnuMv', 'realpath',
      'chown', 'chmod', 'rm'
    ], ['installed', 'b'.repeat(64), '12', '4003', '4004', '600', '0', '0']],
    ['stage-cleanup', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
      'noclobber', 'gnuStat', 'realpath', 'rm'
    ], null]
  ]

  for (const [operation, required, data] of cases) {
    for (const capability of required) {
      const request = operation === 'stage-import'
        ? {
            operation,
            args: targetStageBinding({
              sha256: 'b'.repeat(64),
              size: '12',
              targetMode: '600',
              targetUid: '0',
              targetGid: '0'
            })
          }
        : { operation }
      const parser = createPrivilegedFileParser({ token, request })
      parser.push(startMarker(
        token,
        allCapabilities.replace(`${capability}=1`, `${capability}=0`)
      ))
      if (operation === 'stage-import') {
        parser.push(fileMarker(
          token,
          'data',
          '1',
          '1',
          'temp-claim',
          encodeMarkerField('4003'),
          encodeMarkerField('4004')
        ))
        parser.push(fileMarker(
          token,
          'data',
          '1',
          '1',
          'moving',
          encodeMarkerField('4003'),
          encodeMarkerField('4004'),
          encodeMarkerField('0')
        ))
      }
      if (data) {
        parser.push(fileMarker(
          token,
          'data',
          '1',
          '1',
          data[0],
          ...data.slice(1).map(encodeMarkerField)
        ))
      }
      if (operation === 'stage-import') {
        parser.push(fileMarker(
          token,
          'data',
          '1',
          '1',
          'import-cleanup',
          encodeMarkerField('1'),
          encodeMarkerField('complete')
        ))
      }
      assert.throws(
        () => parser.push(fileMarker(token, 'end', '0')),
        /能力/,
        `${operation}:${capability}`
      )
    }
  }
})

test('stage export never calls an exported outer set function', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-stage-env-'))
  try {
    const nativeSource = path.join(nativeRoot, 'source')
    const nativeStage = path.join(nativeRoot, 'stage')
    const nativeLog = path.join(nativeRoot, 'outer-set.log')
    fs.writeFileSync(nativeSource, 'source')
    fs.mkdirSync(nativeStage)
    fs.writeFileSync(nativeLog, '')
    const sourcePath = toBashPath(nativeSource)
    const rootPath = toBashPath(nativeStage)
    const logPath = toBashPath(nativeLog)
    const metadata = runBash([
      `cd -- ${quoteForBash(rootPath)} || exit $?`,
      `printf "%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n" "$(stat -c %d -- .)" "$(stat -c %i -- .)" "$(id -u)" "$(id -g)" "$(stat -c %d -- ${quoteForBash(toBashPath(nativeRoot))})" "$(stat -c %i -- ${quoteForBash(toBashPath(nativeRoot))})" "$(stat -c %d -- ${quoteForBash(sourcePath)})" "$(stat -c %i -- ${quoteForBash(sourcePath)})"`
    ].join('\n'))
    assert.equal(metadata.status, 0, metadata.stderr)
    const [rootDevice, rootInode, rootUid, rootGid,
      sourceParentDevice, sourceParentInode, sourceDevice, sourceInode] =
      metadata.stdout.trim().split('\n')
    const request = createPrivilegedFileRequest({
      operation: 'stage-export',
      args: sourceStageBinding({
        rootPath,
        rootRealPath: rootPath,
        rootDevice,
        rootInode,
        rootUid,
        rootGid,
        sourcePath,
        sourceParentRealPath: toBashPath(nativeRoot),
        sourceParentDevice,
        sourceParentInode,
        sourceDevice,
        sourceInode,
        expectedSize: '6',
        maxSize: '6'
      })
    })
    const command = buildPrivilegedFileCommand({
      token: '0'.repeat(48),
      request
    })
    const result = runBash([
      `__test_set_log=${quoteForBash(logPath)}`,
      'set () { printf "called\\n" >> "$__test_set_log"; return 0; }',
      'export -f set',
      'stat () { if [ "$1" = -c ] && [ "$2" = %a ] && [ "$3" = -- ] && [ "$4" = . ]; then printf "700\\n"; else command stat "$@"; fi; }',
      'export -f stat',
      command
    ].join('\n'))
    assert.match(result.stdout, /;end;[0-9]+/)
    assert.equal(fs.readFileSync(nativeLog, 'utf8'), '')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage request rejects a non-canonical root path', async () => {
  const { createPrivilegedFileRequest } = await importModule(protocolModule)
  const common = {
    challengeName: 'challenge-token',
    responseName: 'response-token',
    challenge: 'a'.repeat(64),
    challengeSize: '48',
    rootUid: '1000',
    rootGid: '1000',
    rootMode: '700'
  }
  assert.throws(
    () => createPrivilegedFileRequest({
      operation: 'stage-handshake',
      args: { ...common, rootPath: '/stage/session/' }
    }),
    /rootPath/
  )
})

test('lstat emits a trusted missing result only for an absent path', {
  skip: !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lstat-missing-'))
  try {
    const bashRoot = toBashPath(nativeRoot)
    const canonicalRoot = runBash(
      `cd -- ${quoteForBash(bashRoot)} && pwd -P`
    ).stdout.trim()
    const missingPath = `${canonicalRoot}/absent`
    const missing = await runRealProtocolOperation({
      operation: 'lstat',
      token: '3'.repeat(48),
      args: { path: missingPath }
    })
    assert.equal(missing.execution.status, 0, missing.execution.stderr)
    assert.equal(missing.parser.exitCode(), 0)
    assert.equal(missing.result.kind, 'lstat')
    assert.equal(missing.result.missing, true)
    assert.equal(missing.result.capabilities.stat, true)
    assert.equal(missing.result.capabilities.gnuStat, true)
    assert.equal(missing.result.capabilities.realpath, true)

    const absentParent = await runRealProtocolOperation({
      operation: 'lstat',
      token: '31'.repeat(24),
      args: { path: `${missingPath}/child` }
    })
    assert.notEqual(absentParent.execution.status, 0,
      'an unresolved parent must not become trusted missing')

    const loopPath = path.join(nativeRoot, 'loop')
    fs.symlinkSync('loop', loopPath, 'dir')
    const loop = await runRealProtocolOperation({
      operation: 'lstat',
      token: '32'.repeat(24),
      args: { path: `${canonicalRoot}/loop/child` }
    })
    assert.notEqual(loop.execution.status, 0,
      'an ELOOP parent must not become trusted missing')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('bound manifest operations reject replaced directories and entries', {
  skip: !bashAvailable
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-bound-manifest-'))
  try {
    const nativeDirectory = path.join(nativeRoot, 'source')
    const nativeFile = path.join(nativeDirectory, 'file')
    fs.mkdirSync(nativeDirectory)
    fs.writeFileSync(nativeFile, 'trusted')
    const bashRoot = toBashPath(nativeRoot)
    const canonicalRoot = runBash(
      `cd -- ${quoteForBash(bashRoot)} && pwd -P`
    ).stdout.trim()
    const bashDirectory = `${canonicalRoot}/source`
    const bashFile = `${bashDirectory}/file`
    const metadata = runBash([
      `cd -- ${quoteForBash(bashRoot)} || exit $?`,
      'printf "%s\\n%s\\n" "$(stat -c %d -- .)" "$(stat -c %i -- .)"',
      `printf "%s\\n%s\\n" "$(stat -c %d -- ${quoteForBash(bashDirectory)})" "$(stat -c %i -- ${quoteForBash(bashDirectory)})"`,
      `printf "%s\\n%s\\n" "$(stat -c %d -- ${quoteForBash(bashFile)})" "$(stat -c %i -- ${quoteForBash(bashFile)})"`
    ].join('\n'))
    assert.equal(metadata.status, 0, metadata.stderr)
    const [rootDevice, rootInode, directoryDevice, directoryInode,
      fileDevice, fileInode] = metadata.stdout.trim().split('\n')

    const listed = await runRealProtocolOperation({
      operation: 'list-bound',
      token: '35'.repeat(24),
      args: {
        path: bashDirectory,
        sourceParentRealPath: canonicalRoot,
        sourceParentDevice: rootDevice,
        sourceParentInode: rootInode,
        sourceDevice: directoryDevice,
        sourceInode: directoryInode
      }
    })
    assert.equal(listed.execution.status, 0, listed.execution.stderr)
    assert.deepEqual(listed.result.entries.map(entry => entry.name), ['file'])

    const replacedDirectory = await runRealProtocolOperation({
      operation: 'list-bound',
      token: '36'.repeat(24),
      args: {
        path: bashDirectory,
        sourceParentRealPath: canonicalRoot,
        sourceParentDevice: rootDevice,
        sourceParentInode: rootInode,
        sourceDevice: directoryDevice,
        sourceInode: String(BigInt(directoryInode) + 1n)
      }
    })
    assert.notEqual(replacedDirectory.execution.status, 0)

    const boundEntry = await runRealProtocolOperation({
      operation: 'lstat-bound',
      token: '37'.repeat(24),
      args: {
        path: bashFile,
        sourceParentRealPath: bashDirectory,
        sourceParentDevice: directoryDevice,
        sourceParentInode: directoryInode
      }
    })
    assert.equal(boundEntry.execution.status, 0, boundEntry.execution.stderr)
    assert.equal(boundEntry.result.metadata.inode, fileInode)

    const protectedRemoval = await runRealProtocolOperation({
      operation: 'remove-bound',
      token: '38'.repeat(24),
      args: {
        targetPath: bashFile,
        targetParentRealPath: bashDirectory,
        targetParentDevice: directoryDevice,
        targetParentInode: directoryInode,
        targetDevice: fileDevice,
        targetInode: String(BigInt(fileInode) + 1n),
        targetType: 'file',
        targetMode: (fs.statSync(nativeFile).mode & 0o7777).toString(8),
        targetUid: String(fs.statSync(nativeFile).uid),
        targetGid: String(fs.statSync(nativeFile).gid),
        sha256: sha256Text('trusted'),
        size: String(Buffer.byteLength('trusted'))
      }
    })
    assert.notEqual(protectedRemoval.execution.status, 0)
    assert.equal(fs.readFileSync(nativeFile, 'utf8'), 'trusted')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('remove-bound preserves unknown content and removes only its exact empty directory', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-empty-dir-'))
  try {
    const bashRoot = toBashPath(nativeRoot)
    const canonicalRoot = runBash(
      `cd -- ${quoteForBash(bashRoot)} && pwd -P`
    ).stdout.trim()
    const nonemptyNative = path.join(nativeRoot, 'nonempty')
    const emptyNative = path.join(nativeRoot, 'empty')
    fs.mkdirSync(nonemptyNative)
    fs.mkdirSync(emptyNative)
    fs.writeFileSync(path.join(nonemptyNative, 'foreign'), 'preserve')

    const nonemptyBinding = nativeTargetBinding(nonemptyNative)
    nonemptyBinding.targetParentRealPath = canonicalRoot
    const nonempty = await runRealProtocolOperation({
      operation: 'remove-bound',
      token: '33'.repeat(24),
      args: {
        targetPath: `${canonicalRoot}/nonempty`,
        targetParentRealPath: nonemptyBinding.targetParentRealPath,
        targetParentDevice: nonemptyBinding.targetParentDevice,
        targetParentInode: nonemptyBinding.targetParentInode,
        targetDevice: nonemptyBinding.targetDevice,
        targetInode: nonemptyBinding.targetInode,
        targetType: 'directory',
        targetMode: (fs.statSync(nonemptyNative).mode & 0o7777).toString(8),
        targetUid: String(fs.statSync(nonemptyNative).uid),
        targetGid: String(fs.statSync(nonemptyNative).gid),
        sha256: '0'.repeat(64),
        size: '0'
      }
    })
    assert.notEqual(nonempty.execution.status, 0)
    assert.equal(fs.readFileSync(path.join(nonemptyNative, 'foreign'), 'utf8'), 'preserve')

    const emptyBinding = nativeTargetBinding(emptyNative)
    emptyBinding.targetParentRealPath = canonicalRoot
    const empty = await runRealProtocolOperation({
      operation: 'remove-bound',
      token: '34'.repeat(24),
      args: {
        targetPath: `${canonicalRoot}/empty`,
        targetParentRealPath: emptyBinding.targetParentRealPath,
        targetParentDevice: emptyBinding.targetParentDevice,
        targetParentInode: emptyBinding.targetParentInode,
        targetDevice: emptyBinding.targetDevice,
        targetInode: emptyBinding.targetInode,
        targetType: 'directory',
        targetMode: (fs.statSync(emptyNative).mode & 0o7777).toString(8),
        targetUid: String(fs.statSync(emptyNative).uid),
        targetGid: String(fs.statSync(emptyNative).gid),
        sha256: '0'.repeat(64),
        size: '0'
      }
    })
    assert.equal(empty.execution.status, 0, empty.execution.stderr)
    assert.equal(empty.result.ok, true)
    assert.equal(fs.existsSync(emptyNative), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage handshake command verifies the exact 64-byte response content', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: '5'.repeat(48),
    request: createPrivilegedFileRequest({
      operation: 'stage-handshake',
      args: {
        rootPath: '/stage/session',
        challengeName: 'challenge-token',
        responseName: 'response-token',
        challenge: 'a'.repeat(64),
        challengeSize: '48',
        rootUid: '1000',
        rootGid: '1000',
        rootMode: '700'
      }
    })
  })

  assert.equal(command.includes(
    '[ "$(stat -c %s -- "./$__sp_responseName")" = 64 ]'
  ), true)
  assert.equal(command.includes(
    '__sp_expectedResponseDigest="$(__sp_sha256_text "$__sp_response")"'
  ), true)
  assert.equal(command.includes(
    '__sp_actualResponseDigest="$(__sp_bounded_digest 0 64)"'
  ), true)
})

test('stage handshake command has valid outer and inner shell syntax', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: '4'.repeat(48),
    request: createPrivilegedFileRequest({
      operation: 'stage-handshake',
      args: {
        rootPath: '/stage/session',
        challengeName: 'challenge-token',
        responseName: 'response-token',
        challenge: 'a'.repeat(64),
        challengeSize: '48',
        rootUid: '1000',
        rootGid: '1000',
        rootMode: '700'
      }
    })
  })
  const outer = spawnSync(
    bashExecutable,
    ['--noprofile', '--norc', '-n'],
    { encoding: 'utf8', input: command }
  )
  assert.equal(outer.status, 0, outer.stderr)
  const extracted = runBash(
    `set -- ${command}\n` + 'printf \'%s\' "$' + '{!#}"'
  )
  assert.equal(extracted.status, 0, extracted.stderr)
  assert.equal(extracted.stdout.includes('__sp_expectedResponseDigest='), true)
  const inner = spawnSync(
    bashExecutable,
    ['--noprofile', '--norc', '-n'],
    { encoding: 'utf8', input: extracted.stdout }
  )
  assert.equal(inner.status, 0, inner.stderr)
})

test('stage handshake shell rejects direct and intermediate directory symlinks', {
  skip: !bashAvailable
}, async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const common = {
    challengeName: 'challenge-token',
    responseName: 'response-token',
    challenge: 'a'.repeat(64),
    challengeSize: '48',
    rootUid: '1000',
    rootGid: '1000',
    rootMode: '700'
  }
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-stage-link-'))
  try {
    const nativeReal = path.join(nativeRoot, 'real')
    const nativeChild = path.join(nativeReal, 'child')
    const nativeLink = path.join(nativeRoot, 'link')
    fs.mkdirSync(nativeChild, { recursive: true })
    fs.symlinkSync(nativeReal, nativeLink, process.platform === 'win32' ? 'junction' : 'dir')
    fs.writeFileSync(path.join(nativeChild, 'challenge-token'), 'challenge')
    const bashLink = toBashPath(nativeLink)
    const identity = runBash('printf "%s\\n%s\\n" "$(id -u)" "$(id -g)"')
    assert.equal(identity.status, 0, identity.stderr)
    const [rootUid, rootGid] = identity.stdout.trim().split('\n')
    const challenge = createHash('sha256').update('challenge').digest('hex')
    const response = createHash('sha256').update(`${challenge}:root`).digest('hex')

    for (const rootPath of [bashLink, `${bashLink}/child`]) {
      const command = buildPrivilegedFileCommand({
        token: '6'.repeat(48),
        request: createPrivilegedFileRequest({
          operation: 'stage-handshake',
          args: {
            ...common,
            rootPath,
            challenge,
            rootUid,
            rootGid
          }
        })
      })
      const result = runBash([
        `sha256sum () { if [ "$1" = -- ] && [ "$2" = ./response-token ]; then printf '%s  *%s\\n' ${quoteForBash(response)} "$2"; else command sha256sum "$@"; fi; }`,
        'stat () {',
        '  if [ "$1" = -c ] && [ "$2" = %a ] && [ "$3" = -- ]; then',
        '    case "$4" in .) printf "700\\n"; return 0 ;; ./response-token) printf "600\\n"; return 0 ;; esac',
        '  fi',
        '  command stat "$@"',
        '}',
        command
      ].join('\n'))
      assert.notEqual(result.status, 0, `${rootPath}\n${result.stdout}${result.stderr}`)
      assert.equal(result.stdout.includes(';end;0\u0007'), false)
    }
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('privileged parser rejects its namespace wrong token and ignores other namespaces', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const { createPtyTaskOutputParser } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'
  )
  const token = 'e'.repeat(48)
  const request = { operation: 'list' }
  const parser = createPrivilegedFileParser({ token, request })

  assert.throws(
    () => parser.push(fileMarker('f'.repeat(48), 'start', 'bad', 'bad', 'bad')),
    /token/
  )
  parser.push(`\u001b]697;SHELLPILOT_OPS;${token};start;bad;bad\u0007`)
  assert.equal(parser.started(), false)
  parser.push(startMarker(token))
  assert.throws(() => parser.push(startMarker(token)), /开始边界/)
  parser.push(fileMarker(
    token, 'data', '1', '2', 'entry',
    encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')
  ))
  assert.throws(() => parser.push(fileMarker(token, 'end', '0')), /结束边界/)

  const dataFirst = createPrivilegedFileParser({ token, request })
  assert.throws(() => dataFirst.push(fileMarker(
    token, 'data', '1', '1', 'entry',
    encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')
  )), /数据边界/)

  for (const markers of [
    [
      fileMarker(token, 'data', '2', '2', 'entry', encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0'))
    ],
    [
      fileMarker(token, 'data', '1', '2', 'entry', encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')),
      fileMarker(token, 'data', '1', '2', 'entry', encodeMarkerField('b'), encodeMarkerField('81a4;1;1;1;0;0'))
    ],
    [
      fileMarker(token, 'data', '1', '2', 'entry', encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')),
      fileMarker(token, 'data', '2', '3', 'entry', encodeMarkerField('b'), encodeMarkerField('81a4;1;1;1;0;0'))
    ]
  ]) {
    const ordered = createPrivilegedFileParser({ token, request })
    ordered.push(startMarker(token))
    assert.throws(() => markers.forEach(marker => ordered.push(marker)), /顺序/)
  }

  const complete = createPrivilegedFileParser({ token, request })
  assert.throws(() => complete.result(), /尚未完整/)
  complete.push(startMarker(token))
  complete.push(fileMarker(token, 'end', '0'))
  assert.throws(() => complete.push(fileMarker(token, 'end', '0')), /结束边界/)
  assert.throws(() => complete.push(fileMarker(
    token, 'data', '1', '1', 'entry',
    encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')
  )), /数据边界/)

  const opsParser = createPtyTaskOutputParser({ token })
  opsParser.push(startMarker(token))
  assert.equal(opsParser.started(), false)
})

test('privileged parser bounds markers entries and cumulative trusted metadata', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = '1'.repeat(48)

  const oversized = createPrivilegedFileParser({
    token,
    request: { operation: 'list' }
  })
  assert.throws(
    () => oversized.push(
      `\u001b]698;SHELLPILOT_FILE;${token};start;${'A'.repeat(2048)}`
    ),
    /边界过长/
  )
  const oversizedUtf8 = createPrivilegedFileParser({
    token,
    request: { operation: 'list' }
  })
  assert.throws(
    () => oversizedUtf8.push(
      `\u001b]698;SHELLPILOT_FILE;${token};${'中'.repeat(700)}\u0007`
    ),
    /边界过长/
  )

  const tooMany = createPrivilegedFileParser({
    token,
    request: { operation: 'list' }
  })
  tooMany.push(startMarker(token))
  assert.throws(() => tooMany.push(fileMarker(
    token, 'data', '1', '20001', 'entry',
    encodeMarkerField('a'), encodeMarkerField('81a4;1;1;1;0;0')
  )), /数据类型|目录项/)

  const cumulative = createPrivilegedFileParser({
    token,
    request: { operation: 'list' }
  })
  cumulative.push(startMarker(token))
  const total = 3100
  const name = 'n'.repeat(1400)
  const metadata = encodeMarkerField('81a4;1;1;1;0;0')
  assert.throws(() => {
    for (let sequence = 1; sequence <= total; sequence += 1) {
      cumulative.push(fileMarker(
        token, 'data', String(sequence), String(total), 'entry',
        encodeMarkerField(name), metadata
      ))
    }
  }, /元数据过大/)
})

test('parser incrementally scans giant untrusted chunks before retaining data', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/privileged-file-protocol.js'),
    'utf8'
  )
  assert.doesNotMatch(source, /pending\s*\+=\s*String\(chunk/)

  const token = 'd1'.repeat(24)
  const parser = createPrivilegedFileParser({ token, request: { operation: 'probe' } })
  parser.push('ordinary-output'.repeat(600000))
  parser.push(startMarker(token))
  parser.push(fileMarker(token, 'end', '0'))
  assert.equal(parser.result().ok, true)

  const oversized = createPrivilegedFileParser({
    token,
    request: { operation: 'probe' }
  })
  assert.throws(
    () => oversized.push(
      `noise\u001b]698;SHELLPILOT_FILE;${token};start;${'A'.repeat(5 * 1024 * 1024)}`
    ),
    /边界过长/
  )
})

test('privileged parser rejects malformed encodings identities capabilities and exit codes', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = '2'.repeat(48)

  for (const [uid64, user64, capabilities64] of [
    ['***=', encodeMarkerField('root'), encodeMarkerField('sh=1')],
    ['/w==', encodeMarkerField('root'), encodeMarkerField('sh=1')],
    [encodeMarkerField('9007199254740992'), encodeMarkerField('root'), encodeMarkerField('sh=1')],
    [encodeMarkerField('0'), encodeMarkerField('bad\nname'), encodeMarkerField('sh=1')],
    [encodeMarkerField('0'), encodeMarkerField('root'), encodeMarkerField('sh=yes')],
    [encodeMarkerField('0'), encodeMarkerField('root'), encodeMarkerField('sh=1,sh=0')],
    [encodeMarkerField('0'), encodeMarkerField('root'), '/w==']
  ]) {
    const parser = createPrivilegedFileParser({ token, request: { operation: 'probe' } })
    assert.throws(
      () => parser.push(fileMarker(token, 'start', uid64, user64, capabilities64)),
      /Base64|UTF-8|身份|能力/
    )
  }

  for (const exitCode of ['-1', '01', '1.5', 'NaN', 'Infinity', '256']) {
    const parser = createPrivilegedFileParser({ token, request: { operation: 'probe' } })
    parser.push(startMarker(token))
    assert.throws(() => parser.push(fileMarker(token, 'end', exitCode)), /结束边界/)
  }
})

test('privileged parser rejects malformed kinds field counts and stat numbers', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = '3'.repeat(48)

  function rejectData (operation, kind, values, pattern = /无效/) {
    const parser = createPrivilegedFileParser({ token, request: { operation } })
    parser.push(startMarker(token))
    assert.throws(() => parser.push(fileMarker(
      token, 'data', '1', '1', kind, ...values.map(encodeMarkerField)
    )), pattern)
  }

  rejectData('list', 'unknown', ['a', '81a4;1;1;1;0;0'], /数据类型/)
  rejectData('list', 'entry', ['a', '81a4;1;1;1;0;0', 'extra'], /数据类型/)
  rejectData('list', 'entry', ['/slash', '81a4;1;1;1;0;0'], /文件名/)
  rejectData('list', 'entry', ['.', '41ed;1;1;1;0;0'], /文件名/)
  rejectData('list', 'entry', ['..', '41ed;1;1;1;0;0'], /文件名/)
  rejectData('stat', 'metadata', ['nothex;1;1;1;0;0'], /mode/)
  rejectData('stat', 'metadata', ['100081a4;1;1;1;0;0'], /mode/)
  rejectData('stat', 'metadata', ['81a4;-1;1;1;0;0'], /size/)
  rejectData('stat', 'metadata', ['81a4;Infinity;1;1;0;0'], /size/)
  rejectData('stat', 'metadata', ['81a4;1;NaN;1;0;0'], /atime/)
  rejectData('stat', 'metadata', ['81a4;1;1;Infinity;0;0'], /mtime/)
  rejectData('stat', 'metadata', ['81a4;1;1;1;-1;0'], /uid/)
  rejectData('stat', 'metadata', ['81a4;1;1;1;0;1.5'], /gid/)
  rejectData('stage-handshake', 'handshake', [
    'bad', '0', '0', '700', '/real', '1', '2'
  ], /握手/)
  rejectData('stage-export', 'digest', ['bad', '1'], /SHA-256/)
  rejectData('sha256', 'digest', ['a'.repeat(64), '-1'], /size/)

  const missing = createPrivilegedFileParser({ token, request: { operation: 'stat' } })
  missing.push(startMarker(token))
  assert.throws(() => missing.push(fileMarker(token, 'end', '0')), /结束边界/)
})

test('staging shell bodies fail closed before emitting trusted results', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const token = '4'.repeat(48)
  const importCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        targetPath: '/root/target',
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const readlinkCommand = buildPrivilegedFileCommand({
    token,
    request: { operation: 'readlink', args: { path: '/root/link' } }
  })

  assert.match(importCommand, /__sp_tempDigest=.*\|\|/)
  assert.match(importCommand, /"\$__sp_tempDigest" = "\$__sp_expectedSha256"/)
  assert.match(importCommand, /"\$__sp_tempSize" = "\$__sp_expectedSize"/)
  assert.match(readlinkCommand, /__sp_emit_text\(\).*\[ -n "\$__sp_value" \] \|\| return 1/)
  assert.match(readlinkCommand, /__sp_hash=.*\|\| return \$\?/)
})

test('shell transport preserves trailing newlines with fixed sentinels', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const token = '5'.repeat(48)
  const pathCommand = buildPrivilegedFileCommand({
    token,
    request: { operation: 'lstat', args: { path: '/root/trailing\n' } }
  })
  const textCommand = buildPrivilegedFileCommand({
    token,
    request: { operation: 'readlink', args: { path: '/root/link' } }
  })

  assert.match(pathCommand, /__sp_decode\(\).*printf \./)
  assert.match(pathCommand, /__sp_path=\$\{__sp_path%\?\}/)
  assert.match(textCommand, /readlink\(\) \{ command readlink "\$@".*printf \./)
  assert.match(textCommand, /__sp_value=\$\{1%\?\}.*__sp_value=\$\{__sp_value%\?\}/)
})

test('staging operations bind one safe object to the handshaken root inode', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const token = '6'.repeat(48)
  const binding = {
    rootPath: '/home/hik/.shellpilot-privileged-transfers/session',
    rootRealPath: '/home/hik/.shellpilot-privileged-transfers/session',
    rootDevice: '2049',
    rootInode: '12345',
    rootUid: '1000',
    rootGid: '1000',
    rootMode: '700',
    objectName: 'operation-token'
  }
  const exportCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-export',
      args: sourceStageBinding({ ...binding, sourcePath: '/root/secret' })
    }
  })
  const importCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        ...binding,
        targetPath: '/root/target',
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanupCommand = buildPrivilegedFileCommand({
    token,
    request: { operation: 'stage-cleanup', args: cleanupBinding(binding) }
  })

  for (const command of [exportCommand, importCommand, cleanupCommand]) {
    assert.match(command, /cd -- "\$__sp_rootPath"/)
    assert.match(command, /stat -c %d -- \./)
    assert.match(command, /stat -c %i -- \./)
    assert.match(command, /"\$__sp_rootDevice"/)
    assert.match(command, /"\$__sp_rootInode"/)
    assert.match(command, /procFd=.*noclobber=/)
  }
  assert.match(exportCommand, /exec 3> "\.\/\$__sp_objectName"/)
  assert.match(exportCommand, /\/proc\/\$\$\/fd\/3/)
  assert.match(exportCommand, /__sp_bind_entry_parent "\$__sp_sourcePath"/)
  assert.match(exportCommand, /exec 4< "\.\/\$__sp_boundName"/)
  assert.match(exportCommand, /\/proc\/\$\$\/fd\/4/)
  assert.match(exportCommand, /dd .*<&4 2>&1 >&3/)
  assert.match(exportCommand, /__sp_copyActualBytes=.*__sp_parse_dd_report_text/)
  assert.match(exportCommand, /count="\$__sp_windowSize"/)
  assert.match(exportCommand, /stat -L -c %i -- "\$__sp_fd4"/)
  assert.doesNotMatch(exportCommand, /cp -a -- "\$__sp_sourcePath" "\$__sp_stagePath"/)
  assert.equal(
    exportCommand.indexOf('__sp_digest=') <
      exportCommand.indexOf('chown -- "$__sp_rootUid:$__sp_rootGid"'),
    true
  )
  assert.match(importCommand, /exec 5< "\.\/\$__sp_objectName"/)
  assert.match(importCommand, /__sp_bind_entry_parent "\$__sp_targetPath"/)
  assert.match(importCommand, /__sp_targetName="\$__sp_boundName"/)
  assert.match(importCommand, /cd -- "\$__sp_boundParent"/)
  assert.match(importCommand, /stat -c %d -- \./)
  assert.match(importCommand, /stat -c %i -- \./)
  assert.match(importCommand, /__sp_targetParentTrusted=1/)
  assert.match(importCommand, /__sp_trusted_parent_fd/)
  assert.match(importCommand, /0\$5 & 022/)
  assert.match(importCommand, /__sp_import_cleanup/)
  assert.match(importCommand, /__sp_importTempName/)
  assert.match(importCommand, /umask 077.*set -C.*exec 4> "\.\/\$__sp_importTempName"/)
  assert.match(importCommand, /stat -L -c %a -- "\$__sp_fd4".*= 600/)
  assert.match(importCommand, /dd .*count="\$__sp_expectedSize" <&5 2>&1 >&4/)
  assert.match(importCommand, /"\$__sp_expectedSize"/)
  assert.match(
    importCommand,
    /mv -nT -- "\.\/\$__sp_importTempName" "\.\/\$__sp_targetName"/
  )
  assert.doesNotMatch(importCommand, /mv -fT/)
  const installIndex = importCommand.indexOf(
    'exec 4> "./$__sp_importTempName"'
  )
  assert.equal(
    importCommand.indexOf('chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4"') >
      installIndex,
    true
  )
  assert.equal(importCommand.lastIndexOf('exec 4>&-') > installIndex, true)
  assert.match(importCommand, /__sp_path_matches_fd "\.\/\$__sp_targetName" "\$__sp_tempDevice" "\$__sp_tempInode"/)
  assert.match(importCommand, /__sp_parent_path_matches\(\).*realpath -- "\$1"/)
  assert.match(importCommand, /__sp_import_cleanup\(\).*__sp_path_matches_fd/)
  assert.equal(
    importCommand.lastIndexOf('__sp_trusted_parent_path_matches "$__sp_targetParentRealPath"') >
      installIndex,
    true
  )
  assert.match(importCommand, /__sp_finalDigest=.*__sp_bounded_digest 0 "\$__sp_expectedSize"/)
  assert.match(importCommand, /__sp_finalMode=.*stat -L -c %a -- "\$__sp_fd4"/)
  assert.match(importCommand, /__sp_tempDevice.*__sp_tempInode/)
  assert.match(cleanupCommand, /rm -f -- "\.\/\$__sp_objectName"/)
  assert.doesNotMatch(cleanupCommand, /rm -rf/)

  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: {
        operation: 'stage-cleanup',
        args: cleanupBinding({ ...binding, objectName: '../escape' })
      }
    }),
    /objectName/
  )
  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: { operation: 'stage-cleanup', args: { path: '/stage/free' } }
    }),
    /参数合同|缺少必要参数/
  )
  for (const targetPath of ['/root/target/', '/root/./target', '/root/a/../target']) {
    assert.throws(
      () => buildPrivilegedFileCommand({
        token,
        request: {
          operation: 'stage-import',
          args: targetStageBinding({
            ...binding,
            targetPath,
            sha256: 'a'.repeat(64),
            size: '12',
            targetMode: '600',
            targetUid: '0',
            targetGid: '0'
          })
        }
      }),
      /targetPath|绑定/
    )
  }
})

test('bounded range export and digest read only the requested real source window', {
  skip: !bashAvailable || process.platform === 'win32'
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-range-real-'))
  try {
    const nativeStage = path.join(nativeRoot, 'stage')
    const nativeSource = path.join(nativeRoot, 'source')
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')
    fs.mkdirSync(nativeStage, { mode: 0o700 })
    fs.writeFileSync(nativeSource, content, { mode: 0o600 })
    const rootPath = toBashPath(nativeStage)
    const sourcePath = toBashPath(nativeSource)
    const metadata = runBash([
      `chmod 700 -- ${quoteForBash(rootPath)}`,
      `printf "%s\n%s\n%s\n%s\n" "$(stat -c %d -- ${quoteForBash(rootPath)})" "$(stat -c %i -- ${quoteForBash(rootPath)})" "$(id -u)" "$(id -g)"`
    ].join('\n'))
    assert.equal(metadata.status, 0, metadata.stderr)
    const [rootDevice, rootInode, rootUid, rootGid] =
      metadata.stdout.trim().split('\n')
    const rootBinding = {
      rootPath,
      rootRealPath: rootPath,
      rootDevice,
      rootInode,
      rootUid,
      rootGid,
      rootMode: '700'
    }
    const sourceBinding = nativeSourceBinding(nativeSource)
    sourceBinding.sourceParentRealPath = toBashPath(path.dirname(nativeSource))
    const common = {
      ...rootBinding,
      sourcePath,
      ...sourceBinding,
      expectedSize: String(content.length),
      maxSize: String(content.length),
      offset: '7',
      maxBytes: '11'
    }
    const exported = await runRealProtocolOperation({
      operation: 'stage-export-range',
      token: '67'.repeat(24),
      args: { ...common, objectName: 'range-export' }
    })
    assert.equal(exported.execution.status, 0, exported.execution.stderr)
    const expected = content.subarray(7, 18)
    assert.equal(exported.result.size, expected.length)
    assert.equal(exported.result.sha256, sha256Text(expected))
    assert.deepEqual(fs.readFileSync(path.join(nativeStage, 'range-export')), expected)

    const cleaned = await runRealProtocolOperation({
      operation: 'stage-cleanup',
      token: '68'.repeat(24),
      args: {
        ...rootBinding,
        objectName: 'range-export',
        sha256: exported.result.sha256,
        size: String(exported.result.size)
      }
    })
    assert.equal(cleaned.execution.status, 0, cleaned.execution.stderr)
    const digested = await runRealProtocolOperation({
      operation: 'sha256-range-bound',
      token: '69'.repeat(24),
      args: {
        ...rootBinding,
        objectName: 'range-digest',
        path: sourcePath,
        ...sourceBinding,
        expectedSize: String(content.length),
        maxSize: String(content.length),
        offset: '7',
        maxBytes: '11'
      }
    })
    assert.equal(digested.execution.status, 0, digested.execution.stderr)
    assert.equal(digested.result.size, expected.length)
    assert.equal(digested.result.sha256, sha256Text(expected))
    assert.equal(fs.existsSync(path.join(nativeStage, 'range-digest')), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('mkdir-bound revalidates its canonical parent around every created-entry mutation', async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: '68'.repeat(24),
    request: {
      operation: 'mkdir-bound',
      args: targetEntryBinding({
        targetPath: '/root/new-directory',
        targetMode: '700',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const parentCheck = '__sp_trusted_parent_path_matches "$__sp_targetParentRealPath"'
  const checks = command.split(parentCheck).length - 1

  assert.ok(checks >= 4)
  assert.ok(command.indexOf(parentCheck) < command.indexOf('mkdir -- "./$__sp_boundName"'))
  assert.ok(command.indexOf('umask 077') < command.indexOf('mkdir -- "./$__sp_boundName"'))
  assert.match(command, /stat -L -c %a -- "\$__sp_fd5"\)" = 700/)
  assert.ok(command.lastIndexOf(parentCheck) > command.indexOf('chmod -- "$__sp_targetMode"'))
  assert.match(command, /__sp_cleanup_created_directory/)
  const mkdirIndex = command.indexOf('mkdir -- "./$__sp_boundName"')
  const claimedIndex = command.indexOf('__sp_mkdirClaimed=1')
  const bindIndex = command.indexOf('exec 5< "./$__sp_boundName"')
  assert.match(command, /__sp_mkdirClaimed=0/)
  assert.ok(mkdirIndex < claimedIndex && claimedIndex < bindIndex)
  assert.match(
    command,
    /__sp_mkdir_cleanup\(\).*__sp_mkdirClaimed.*__sp_createdDevice.*__sp_createdInode.*__sp_cleanup_created_directory/
  )
})

for (const scenario of [
  { name: 'raced creator EEXIST', claimed: '0' },
  { name: 'create before inode proof replacement', claimed: '1' }
]) {
  test(`mkdir-bound cleanup preserves a foreign root-owned directory after ${scenario.name}`, async () => {
    const { buildPrivilegedFileCommand } = await importModule(protocolModule)
    const command = buildPrivilegedFileCommand({
      token: '6a'.repeat(24),
      request: {
        operation: 'mkdir-bound',
        args: targetEntryBinding({
          targetPath: '/root/new-directory',
          targetMode: '700',
          targetUid: '0',
          targetGid: '0'
        })
      }
    })
    const cleanupStart = command.indexOf('__sp_mkdir_cleanup()')
    const cleanupEnd = command.indexOf(' };', cleanupStart)
    assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart)
    const cleanup = command.slice(cleanupStart, cleanupEnd + 2)
    const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mkdir-cleanup-'))
    try {
      const foreign = path.join(nativeRoot, 'foreign')
      const deleteLog = path.join(nativeRoot, 'delete-log')
      fs.mkdirSync(foreign, { mode: 0o700 })
      const result = runBash([
        `cd -- ${quoteForBash(toBashPath(nativeRoot))}`,
        `__sp_mkdirClaimed=${scenario.claimed}`,
        '__sp_createdDevice=',
        '__sp_createdInode=',
        '__sp_boundName=foreign',
        '__sp_targetParentDevice=1',
        '__sp_targetParentInode=2',
        '__sp_targetParentUid=0',
        '__sp_targetParentMode=700',
        '__sp_trusted_parent_fd() { return 0; }',
        '__sp_cleanup_created_directory() { return 0; }',
        'stat() { case "$*" in *"%u"*) printf 0 ;; *"%a"*) printf 700 ;; *) return 1 ;; esac; }',
        `rmdir() { printf deleted > ${quoteForBash(toBashPath(deleteLog))}; command rmdir "$@"; }`,
        cleanup,
        '__sp_mkdir_cleanup',
        '__sp_cleanup_status=$?',
        '[ "$__sp_cleanup_status" -ne 0 ]',
        '[ -d ./foreign ]',
        `[ ! -e ${quoteForBash(toBashPath(deleteLog))} ]`
      ].join('\n'))
      assert.equal(result.status, 0, result.stdout + result.stderr)
    } finally {
      fs.rmSync(nativeRoot, { recursive: true, force: true })
    }
  })
}

test('linux mkdir-bound fails when its canonical parent is replaced after creation', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mkdir-parent-race-'))
  try {
    const targetParent = path.join(nativeRoot, 'target-parent')
    const movedParent = path.join(nativeRoot, 'bound-parent')
    const targetPath = path.join(targetParent, 'created')
    const movedTarget = path.join(movedParent, 'created')
    const foreignSentinel = path.join(targetParent, 'foreign')
    const raceLog = path.join(nativeRoot, 'parent-raced')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const result = await runRealProtocolOperation({
      operation: 'mkdir-bound',
      token: '69'.repeat(24),
      prelude: [
        '(',
        '  __sp_test_i=0',
        `  while [ ! -d ${quoteForBash(targetPath)} ] && [ "$__sp_test_i" -lt 1000000 ]; do __sp_test_i=$((__sp_test_i + 1)); done`,
        `  if [ -d ${quoteForBash(targetPath)} ]; then mv -- ${quoteForBash(targetParent)} ${quoteForBash(movedParent)} && mkdir -- ${quoteForBash(targetParent)} && printf foreign > ${quoteForBash(foreignSentinel)} && printf raced > ${quoteForBash(raceLog)}; fi`,
        ') >/dev/null 2>&1 &',
        '__sp_test_pid=$!'
      ].join('\n'),
      epilogue: 'wait "$__sp_test_pid"',
      args: {
        targetPath,
        targetMode: '700',
        targetUid: '0',
        targetGid: '0',
        ...nativeTargetBinding(targetPath, true)
      }
    })

    assert.notEqual(result.execution.status, 0)
    assert.equal(fs.readFileSync(raceLog, 'utf8'), 'raced')
    assert.equal(fs.readFileSync(foreignSentinel, 'utf8'), 'foreign')
    assert.equal(fs.existsSync(movedTarget), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage cleanup requires content proof and binds deletion to one opened inode', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = '7'.repeat(48)
  const args = cleanupBinding()

  assert.throws(() => buildPrivilegedFileCommand({
    token,
    request: createPrivilegedFileRequest({
      operation: 'stage-cleanup',
      args: stageBinding()
    })
  }), /缺少必要参数|sha256|size/i)
  const request = createPrivilegedFileRequest({
    operation: 'stage-cleanup',
    args
  })
  const command = buildPrivilegedFileCommand({ token, request })
  assert.match(command, /exec 3< "\.\/\$__sp_objectName"/)
  assert.match(command, /__sp_bounded_digest 0 "\$__sp_expectedSize"/)
  assert.match(command, /stat -L -c %s -- "\$__sp_fd3"/)
  assert.match(command, /"\$__sp_expectedSha256"/)
  assert.match(command, /"\$__sp_expectedSize"/)
  assert.match(command, /__sp_path_matches_fd "\.\/\$__sp_objectName"/)
  assert.equal(
    command.lastIndexOf('__sp_path_matches_fd "./$__sp_objectName"') <
      command.lastIndexOf('rm -f -- "./$__sp_objectName"'),
    true
  )
  assert.doesNotMatch(command, /rm -rf/)
})

test('proof reads and import copies are bounded to their declared byte counts', async () => {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const token = 'bd'.repeat(24)
  const handshake = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-handshake',
      args: {
        rootPath: '/stage/session',
        challengeName: 'challenge',
        responseName: 'response',
        challenge: 'a'.repeat(64),
        challengeSize: '48',
        rootUid: '1000',
        rootGid: '1000',
        rootMode: '700'
      }
    }
  })
  const imported = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    }
  })
  const cleanup = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-cleanup',
      args: cleanupBinding()
    }
  })
  const removed = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'remove-bound',
      args: {
        targetPath: '/root/file',
        targetParentRealPath: '/root',
        targetParentDevice: '4001',
        targetParentInode: '4002',
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'file',
        targetMode: '600',
        targetUid: '1000',
        targetGid: '1000',
        sha256: 'a'.repeat(64),
        size: '12'
      }
    }
  })

  assert.doesNotMatch(handshake, /__sp_sha256_raw "\.\/\$__sp_(?:challenge|response)Name"/)
  assert.match(handshake, /__sp_bounded_digest 0 "\$__sp_challengeSize"/)
  assert.match(handshake, /__sp_bounded_digest 0 64/)
  assert.doesNotMatch(imported, /cat <&3 >&4/)
  assert.match(imported, /dd .*iflag=count_bytes.*count="\$__sp_expectedSize"/)
  assert.match(imported, /__sp_copyActualBytes=.*__sp_parse_dd_report_text/)
  assert.match(imported, /__sp_copyActualBytes" = "\$__sp_expectedSize"/)
  assert.match(imported, /__sp_bounded_digest 0 "?\$__sp_expectedSize"?/)
  assert.doesNotMatch(imported, /__sp_sha256_raw "\$__sp_fd[346]"/)
  assert.match(cleanup, /__sp_bounded_digest 0 "?\$__sp_expectedSize"?/)
  assert.doesNotMatch(cleanup, /__sp_sha256_raw "\$__sp_fd3"/)
  assert.match(removed, /__sp_bounded_digest 0 "?\$__sp_expectedSize"?/)
  assert.doesNotMatch(removed, /__sp_sha256_raw "\$__sp_fd5"/)

  const overTransferLimit = String((8 * 1024 * 1024 * 1024) + 1)
  for (const request of [
    {
      operation: 'stage-import',
      args: targetStageBinding({
        sha256: 'a'.repeat(64),
        size: overTransferLimit,
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      })
    },
    {
      operation: 'stage-cleanup',
      args: cleanupBinding({ size: overTransferLimit })
    },
    {
      operation: 'remove-bound',
      args: {
        targetPath: '/root/file',
        targetParentRealPath: '/root',
        targetParentDevice: '4001',
        targetParentInode: '4002',
        targetDevice: '4003',
        targetInode: '4004',
        targetType: 'file',
        targetMode: '600',
        targetUid: '1000',
        targetGid: '1000',
        sha256: 'a'.repeat(64),
        size: overTransferLimit
      }
    }
  ]) {
    assert.throws(
      () => createPrivilegedFileRequest(request),
      /size|上限|无效/
    )
  }
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-cleanup',
    args: cleanupBinding({ size: '9007199254740992' })
  }), /size|无效/)
  assert.throws(() => createPrivilegedFileRequest({
    operation: 'stage-handshake',
    args: {
      rootPath: '/stage/session',
      challengeName: 'challenge',
      responseName: 'response',
      challenge: 'a'.repeat(64),
      challengeSize: '129',
      rootUid: '1000',
      rootGid: '1000',
      rootMode: '700'
    }
  }), /challengeSize|128/)
})

test('bounded digest returns without consuming a concurrently growing tail', {
  skip: linuxRootOnly
}, async () => {
  const { buildPrivilegedFileCommand } = await importModule(protocolModule)
  const command = buildPrivilegedFileCommand({
    token: 'be'.repeat(24),
    request: {
      operation: 'sha256-range-bound',
      args: boundedDigestBinding({ objectName: 'growing-source-proof' })
    }
  })
  const helperStart = command.indexOf('__sp_bounded_digest()')
  const helperEnd = command.indexOf('; __sp_valid_name()', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  const helper = command.slice(helperStart, helperEnd)
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-growing-digest-'))
  try {
    const source = toBashPath(path.join(nativeRoot, 'source'))
    const result = runBash([
      `printf fixed > ${quoteForBash(source)}`,
      `exec 3< ${quoteForBash(source)}`,
      '__sp_rootDevice=1',
      '__sp_rootInode=2',
      '__sp_objectName=growing-source-proof',
      '__sp_sha256_tool=sha256sum',
      '__sp_sha256_stdin() { __sp_hash="$(sha256sum)" || return $?; printf %s "$' + '{__sp_hash%% *}"; }',
      helper,
      `( while :; do printf tail >> ${quoteForBash(source)}; done ) &`,
      '__sp_writer=$!',
      '( sleep 2; kill "$__sp_writer" 2>/dev/null || : ) &',
      '__sp_watchdog=$!',
      '__sp_digest="$(__sp_bounded_digest 0 5)"',
      '__sp_status=$?',
      'kill "$__sp_writer" 2>/dev/null || :',
      'wait "$__sp_writer" 2>/dev/null || :',
      'kill "$__sp_watchdog" 2>/dev/null || :',
      'wait "$__sp_watchdog" 2>/dev/null || :',
      '[ "$__sp_status" -eq 0 ]',
      `[ "$__sp_digest" = ${quoteForBash(sha256Text('fixed'))} ]`
    ].join('\n'))
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('stage cleanup proof preserves mismatches links special entries and replacements', {
  skip: !bashAvailable || process.platform === 'win32'
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cleanup-proof-'))
  try {
    const rootPath = toBashPath(nativeRoot)
    const metadata = runBash([
      `chmod 700 -- ${quoteForBash(rootPath)}`,
      `printf '%s\n' "$(realpath -- ${quoteForBash(rootPath)})"`,
      `stat -c '%d;%i;%u;%g;%a' -- ${quoteForBash(rootPath)}`
    ].join('\n'))
    assert.equal(metadata.status, 0, metadata.stderr)
    const [rootRealPath, statLine] = metadata.stdout.trim().split('\n')
    const [rootDevice, rootInode, rootUid, rootGid, rootMode] = statLine.split(';')
    const binding = {
      rootPath,
      rootRealPath,
      rootDevice,
      rootInode,
      rootUid,
      rootGid,
      rootMode
    }
    const trusted = Buffer.from('trusted cleanup bytes')
    const trustedProof = {
      sha256: sha256Text(trusted),
      size: String(trusted.length)
    }
    const runCleanup = (objectName, proof, token) => runRealProtocolOperation({
      operation: 'stage-cleanup',
      token,
      args: { ...binding, objectName, ...proof }
    })

    const mismatchPath = path.join(nativeRoot, 'mismatch-object')
    fs.writeFileSync(mismatchPath, trusted)
    const digestMismatch = await runCleanup(
      'mismatch-object',
      { ...trustedProof, sha256: 'f'.repeat(64) },
      '81'.repeat(24)
    )
    assert.notEqual(digestMismatch.execution.status, 0)
    assert.deepEqual(fs.readFileSync(mismatchPath), trusted)
    const sizeMismatch = await runCleanup(
      'mismatch-object',
      { ...trustedProof, size: String(trusted.length + 1) },
      '82'.repeat(24)
    )
    assert.notEqual(sizeMismatch.execution.status, 0)
    assert.deepEqual(fs.readFileSync(mismatchPath), trusted)

    const linkPath = path.join(nativeRoot, 'link-object')
    fs.symlinkSync('mismatch-object', linkPath)
    const linkRejected = await runCleanup(
      'link-object',
      trustedProof,
      '83'.repeat(24)
    )
    assert.notEqual(linkRejected.execution.status, 0)
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true)

    const directoryPath = path.join(nativeRoot, 'directory-object')
    fs.mkdirSync(directoryPath)
    const directoryRejected = await runCleanup(
      'directory-object',
      { sha256: sha256Text(''), size: '0' },
      '84'.repeat(24)
    )
    assert.notEqual(directoryRejected.execution.status, 0)
    assert.equal(fs.statSync(directoryPath).isDirectory(), true)

    const replacementPath = path.join(nativeRoot, 'replacement-object')
    fs.writeFileSync(replacementPath, 'foreign replacement')
    const replacementRejected = await runCleanup(
      'replacement-object',
      trustedProof,
      '85'.repeat(24)
    )
    assert.notEqual(replacementRejected.execution.status, 0)
    assert.equal(fs.readFileSync(replacementPath, 'utf8'), 'foreign replacement')

    const correctPath = path.join(nativeRoot, 'correct-object')
    fs.writeFileSync(correctPath, trusted)
    const cleaned = await runCleanup('correct-object', trustedProof, '86'.repeat(24))
    assert.equal(cleaned.execution.status, 0, cleaned.execution.stderr)
    assert.equal(fs.existsSync(correctPath), false)
    const missing = await runCleanup('missing-object', trustedProof, '87'.repeat(24))
    assert.equal(missing.execution.status, 0, missing.execution.stderr)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux staging handshake export import and cleanup preserve content metadata for an absent target', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linux-stage-ok-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'l1')
    const objectName = 'export-object'
    const content = 'root payload\nwith trailing newline\n'
    const sourcePath = path.join(nativeRoot, 'source')
    fs.writeFileSync(sourcePath, content, { mode: 0o600 })
    const exported = await runRealProtocolOperation({
      operation: 'stage-export',
      token: 'e1'.repeat(24),
      args: {
        ...fixture.binding,
        objectName,
        sourcePath,
        ...nativeSourceBinding(sourcePath),
        expectedSize: String(Buffer.byteLength(content)),
        maxSize: String(Buffer.byteLength(content))
      }
    })
    assert.equal(exported.execution.status, 0, exported.execution.stderr)
    assert.equal(exported.result.sha256, sha256Text(content))
    assert.equal(exported.result.size, Buffer.byteLength(content))
    const stagedPath = path.join(fixture.rootPath, objectName)
    assert.equal(fs.readFileSync(stagedPath, 'utf8'), content)
    assert.equal(fs.statSync(stagedPath).mode & 0o7777, 0o600)

    const targetParent = path.join(nativeRoot, 'target-parent')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const targetPath = path.join(targetParent, 'installed')
    const imported = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'e2'.repeat(24),
      umask: '000',
      args: {
        ...fixture.binding,
        objectName,
        targetPath,
        sha256: sha256Text(content).toUpperCase(),
        size: String(Buffer.byteLength(content)),
        targetMode: '0640',
        targetUid: '0',
        targetGid: '0',
        mustBeAbsent: '1',
        ...nativeTargetBinding(targetPath, true)
      }
    })
    assert.equal(imported.execution.status, 0, imported.execution.stderr)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), content)
    const installedStat = fs.statSync(targetPath, { bigint: true })
    assert.equal(String(installedStat.ino), imported.result.targetInode)
    assert.equal(Number(installedStat.mode & 0o7777n), 0o640)
    assert.equal(installedStat.uid, 0n)
    assert.equal(installedStat.gid, 0n)
    assert.deepEqual(
      fs.readdirSync(targetParent).filter(name => name.startsWith('.shellpilot-')),
      []
    )

    const noClobberPath = path.join(targetParent, 'no-clobber')
    fs.writeFileSync(noClobberPath, 'foreign', { mode: 0o600 })
    const noClobberInode = fs.statSync(noClobberPath, { bigint: true }).ino
    const noClobber = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'e4'.repeat(24),
      args: {
        ...fixture.binding,
        objectName,
        targetPath: noClobberPath,
        sha256: sha256Text(content),
        size: String(Buffer.byteLength(content)),
        targetMode: '600',
        targetUid: '0',
        targetGid: '0',
        mustBeAbsent: '1',
        ...nativeTargetBinding(noClobberPath, true)
      }
    })
    assert.notEqual(noClobber.execution.status, 0)
    assert.equal(fs.readFileSync(noClobberPath, 'utf8'), 'foreign')
    assert.equal(fs.statSync(noClobberPath, { bigint: true }).ino, noClobberInode)

    const cleaned = await runRealProtocolOperation({
      operation: 'stage-cleanup',
      token: 'e3'.repeat(24),
      args: cleanupBinding({
        ...fixture.binding,
        objectName,
        sha256: sha256Text(content),
        size: String(Buffer.byteLength(content))
      })
    })
    assert.equal(cleaned.execution.status, 0, cleaned.execution.stderr)
    assert.equal(fs.existsSync(stagedPath), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux stage import rejects a canonical parent replacement after installation', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-import-parent-race-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'parent-race')
    const content = Buffer.alloc(32 * 1024 * 1024, 0x61)
    const objectName = 'parent-race-object'
    fs.writeFileSync(path.join(fixture.rootPath, objectName), content, { mode: 0o600 })
    const targetParent = path.join(nativeRoot, 'target-parent')
    const movedParent = path.join(nativeRoot, 'bound-parent')
    const targetPath = path.join(targetParent, 'installed')
    const movedTarget = path.join(movedParent, 'installed')
    const foreignSentinel = path.join(targetParent, 'foreign')
    const raceLog = path.join(nativeRoot, 'parent-raced')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const result = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'e5'.repeat(24),
      prelude: [
        '(',
        '  __sp_test_i=0',
        `  while [ ! -f ${quoteForBash(targetPath)} ] && [ "$__sp_test_i" -lt 1000000 ]; do __sp_test_i=$((__sp_test_i + 1)); done`,
        `  if [ -f ${quoteForBash(targetPath)} ]; then mv -- ${quoteForBash(targetParent)} ${quoteForBash(movedParent)} && mkdir -- ${quoteForBash(targetParent)} && printf foreign > ${quoteForBash(foreignSentinel)} && printf raced > ${quoteForBash(raceLog)}; fi`,
        ') >/dev/null 2>&1 &',
        '__sp_test_pid=$!'
      ].join('\n'),
      epilogue: 'wait "$__sp_test_pid"',
      args: {
        ...fixture.binding,
        objectName,
        targetPath,
        sha256: sha256Text(content),
        size: String(content.length),
        targetMode: '600',
        targetUid: '0',
        targetGid: '0',
        mustBeAbsent: '1',
        ...nativeTargetBinding(targetPath, true)
      }
    })

    assert.notEqual(result.execution.status, 0)
    assert.equal(fs.readFileSync(raceLog, 'utf8'), 'raced')
    assert.equal(fs.readFileSync(foreignSentinel, 'utf8'), 'foreign')
    assert.equal(fs.existsSync(movedTarget), false)
    assert.equal(fs.existsSync(targetPath), false)
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux stage import rejects digest mismatch special entries and final-path replacements', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linux-stage-reject-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'l2')
    const targetParent = path.join(nativeRoot, 'target-parent')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const targetPath = path.join(targetParent, 'installed')
    const baseArgs = {
      ...fixture.binding,
      targetPath,
      sha256: sha256Text('trusted'),
      size: '7',
      targetMode: '600',
      targetUid: '0',
      targetGid: '0',
      mustBeAbsent: '1',
      ...nativeTargetBinding(targetPath, true)
    }

    fs.writeFileSync(path.join(fixture.rootPath, 'digest-object'), 'different')
    const mismatch = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f1'.repeat(24),
      args: { ...baseArgs, objectName: 'digest-object' }
    })
    assert.notEqual(mismatch.execution.status, 0)
    assert.equal(fs.existsSync(targetPath), false)
    assert.deepEqual(fs.readdirSync(targetParent), [])

    fs.chmodSync(targetParent, 0o777)
    const untrustedToken = 'fa'.repeat(24)
    const untrustedMismatch = await runRealProtocolOperation({
      operation: 'stage-import',
      token: untrustedToken,
      args: { ...baseArgs, objectName: 'digest-object' }
    })
    assert.notEqual(untrustedMismatch.execution.status, 0)
    assert.equal(fs.existsSync(targetPath), false)
    assert.deepEqual(fs.readdirSync(targetParent), [])
    fs.chmodSync(targetParent, 0o700)

    fs.symlinkSync('digest-object', path.join(fixture.rootPath, 'link-object'))
    fs.mkdirSync(path.join(fixture.rootPath, 'directory-object'))
    const fifoPath = path.join(fixture.rootPath, 'fifo-object')
    assert.equal(spawnSync('mkfifo', [fifoPath]).status, 0)
    for (const objectName of ['link-object', 'directory-object', 'fifo-object']) {
      const rejected = await runRealProtocolOperation({
        operation: 'stage-import',
        token: sha256Text(objectName).slice(0, 48),
        args: { ...baseArgs, objectName }
      })
      assert.notEqual(rejected.execution.status, 0, objectName)
      assert.equal(fs.existsSync(targetPath), false)
    }
    const linkCleanup = await runRealProtocolOperation({
      operation: 'stage-cleanup',
      token: 'f0'.repeat(24),
      args: cleanupBinding({
        ...fixture.binding,
        objectName: 'link-object',
        sha256: sha256Text('different'),
        size: '9'
      })
    })
    assert.notEqual(linkCleanup.execution.status, 0)
    assert.equal(fs.lstatSync(path.join(fixture.rootPath, 'link-object')).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(path.join(fixture.rootPath, 'digest-object'), 'utf8'), 'different')

    const directoryTarget = path.join(targetParent, 'directory-target')
    fs.mkdirSync(directoryTarget)
    const directoryRejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f2'.repeat(24),
      args: {
        ...baseArgs,
        objectName: 'digest-object',
        targetPath: directoryTarget,
        ...nativeTargetBinding(directoryTarget, true)
      }
    })
    assert.notEqual(directoryRejected.execution.status, 0)
    assert.equal(fs.statSync(directoryTarget).isDirectory(), true)

    const symlinkTarget = path.join(targetParent, 'symlink-target')
    fs.symlinkSync('installed', symlinkTarget)
    const symlinkTargetRejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f6'.repeat(24),
      args: {
        ...baseArgs,
        objectName: 'digest-object',
        targetPath: symlinkTarget,
        ...nativeTargetBinding(symlinkTarget, true)
      }
    })
    assert.notEqual(symlinkTargetRejected.execution.status, 0)
    assert.equal(fs.readlinkSync(symlinkTarget), 'installed')

    const symlinkParent = path.join(nativeRoot, 'target-parent-link')
    fs.symlinkSync(targetParent, symlinkParent)
    const symlinkParentRejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f7'.repeat(24),
      args: {
        ...baseArgs,
        objectName: 'digest-object',
        targetPath: path.join(symlinkParent, 'through-link'),
        targetParentRealPath: symlinkParent,
        targetParentDevice: baseArgs.targetParentDevice,
        targetParentInode: baseArgs.targetParentInode,
        targetDevice: '0',
        targetInode: '0',
        mustBeAbsent: '1'
      }
    })
    assert.notEqual(symlinkParentRejected.execution.status, 0)
    assert.equal(fs.existsSync(path.join(targetParent, 'through-link')), false)

    const replacementToken = 'f3'.repeat(24)
    const replacementName = `.shellpilot-${replacementToken}-digest-object.tmp`
    const replacementPath = path.join(targetParent, replacementName)
    fs.writeFileSync(replacementPath, 'foreign inode', { mode: 0o600 })
    const replacementInode = fs.statSync(replacementPath, { bigint: true }).ino
    const replacementRejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: replacementToken,
      args: { ...baseArgs, objectName: 'digest-object' }
    })
    assert.notEqual(replacementRejected.execution.status, 0)
    assert.equal(fs.readFileSync(replacementPath, 'utf8'), 'foreign inode')
    assert.equal(fs.statSync(replacementPath, { bigint: true }).ino, replacementInode)
    assert.equal(fs.existsSync(targetPath), false)

    fs.rmSync(replacementPath)
    const raceObject = path.join(fixture.rootPath, 'race-object')
    fs.writeFileSync(raceObject, Buffer.alloc(32 * 1024 * 1024, 0x61), { mode: 0o600 })
    const raceToken = 'f5'.repeat(24)
    const raceLog = path.join(nativeRoot, 'race-replaced')
    const raced = await runRealProtocolOperation({
      operation: 'stage-import',
      token: raceToken,
      prelude: [
        '(',
        '  __sp_test_i=0',
        `  while [ ! -e ${quoteForBash(targetPath)} ] && [ "$__sp_test_i" -lt 10000 ]; do __sp_test_i=$((__sp_test_i + 1)); sleep 0.001; done`,
        `  if [ -e ${quoteForBash(targetPath)} ]; then rm -f -- ${quoteForBash(targetPath)}; printf foreign > ${quoteForBash(targetPath)}; printf replaced > ${quoteForBash(raceLog)}; fi`,
        ') >/dev/null 2>&1 &'
      ].join('\n'),
      args: {
        ...baseArgs,
        objectName: 'race-object',
        sha256: sha256Text(Buffer.alloc(32 * 1024 * 1024, 0x61)),
        size: String(32 * 1024 * 1024)
      }
    })
    assert.notEqual(raced.execution.status, 0)
    assert.equal(fs.readFileSync(raceLog, 'utf8'), 'replaced')
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'foreign')

    fs.rmSync(targetPath)
    const targetRaceToken = 'fb'.repeat(24)
    const targetRacePath = path.join(targetParent, 'raced-target')
    const targetRaceLog = path.join(nativeRoot, 'target-raced')
    const targetRaced = await runRealProtocolOperation({
      operation: 'stage-import',
      token: targetRaceToken,
      prelude: [
        `printf foreign > ${quoteForBash(targetRacePath)}`,
        `printf raced > ${quoteForBash(targetRaceLog)}`
      ].join('\n'),
      args: {
        ...baseArgs,
        objectName: 'race-object',
        targetPath: targetRacePath,
        sha256: sha256Text(Buffer.alloc(32 * 1024 * 1024, 0x61)),
        size: String(32 * 1024 * 1024),
        ...nativeTargetBinding(targetRacePath, true)
      }
    })
    assert.notEqual(targetRaced.execution.status, 0)
    assert.equal(fs.readFileSync(targetRaceLog, 'utf8'), 'raced')
    assert.equal(fs.readFileSync(targetRacePath, 'utf8'), 'foreign')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux stage import metadata failure removes only its proven final target', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linux-stage-metadata-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'l3')
    const objectName = 'metadata-object'
    const content = 'verified before metadata'
    fs.writeFileSync(path.join(fixture.rootPath, objectName), content, { mode: 0o600 })
    const targetParent = path.join(nativeRoot, 'target-parent')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const targetPath = path.join(targetParent, 'installed')
    const rejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f4'.repeat(24),
      umask: '000',
      args: {
        ...fixture.binding,
        objectName,
        targetPath,
        sha256: sha256Text(content),
        size: String(Buffer.byteLength(content)),
        targetMode: '777',
        targetUid: '4294967296',
        targetGid: '0',
        mustBeAbsent: '1',
        ...nativeTargetBinding(targetPath, true)
      }
    })
    assert.notEqual(rejected.execution.status, 0)
    assert.equal(fs.existsSync(targetPath), false)
    assert.deepEqual(
      fs.readdirSync(targetParent).filter(name => name.startsWith('.shellpilot-')),
      []
    )
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})
