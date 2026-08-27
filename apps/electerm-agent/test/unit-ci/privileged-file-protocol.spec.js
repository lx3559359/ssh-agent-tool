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
  'find=1', 'head=1', 'wc=1'
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
  prelude = ''
}) {
  const {
    buildPrivilegedFileCommand,
    createPrivilegedFileParser,
    createPrivilegedFileRequest
  } = await importModule(protocolModule)
  const request = createPrivilegedFileRequest({ operation, args })
  const command = buildPrivilegedFileCommand({ token, request })
  const execution = runBash(`umask ${umask}\n${prelude}\n${command}`)
  const parser = createPrivilegedFileParser({ token, request })
  parser.push(execution.stdout)
  return { execution, parser, result: parser.result() }
}

function sha256Text (value) {
  return createHash('sha256').update(value).digest('hex')
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
    ['rename', 'gnuMv'],
    ['chmod', 'chmod'],
    ['chown', 'chown'],
    ['rm', 'rm'],
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
    operation: 'rename',
    args: { source: 12, target: null }
  })

  assert.deepEqual(request, {
    operation: 'rename',
    args: { source: '12', target: '' }
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
      args: {
        ...stageBinding(),
        targetPath: '/root/target',
        sha256: upperSha256,
        size: '0',
        targetMode: input,
        targetUid: '0',
        targetGid: '0'
      }
    })
    assert.equal(request.args.targetMode, canonical)
    assert.equal(request.args.sha256, upperSha256.toLowerCase())
    assert.doesNotThrow(() => buildPrivilegedFileCommand({ token, request }))
  }

  const handshake = createPrivilegedFileRequest({
    operation: 'stage-handshake',
    args: {
      rootPath: '/stage',
      challengeName: 'challenge',
      responseName: 'response',
      challenge: mixedChallenge,
      rootUid: '0',
      rootGid: '0',
      rootMode: '0700'
    }
  })
  assert.equal(handshake.args.challenge, mixedChallenge.toLowerCase())
  assert.equal(handshake.args.rootMode, '700')
  assert.doesNotThrow(() => buildPrivilegedFileCommand({ token, request: handshake }))
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
    ['lstat', { path: '/x' }, '__sp_emit_stat "$__sp_path" lstat'],
    ['stat', { path: '/x' }, '__sp_emit_stat "$__sp_path" stat'],
    ['readlink', { path: '/x' }, '__sp_emit_text "$(readlink -- "$__sp_path")"'],
    ['realpath', { path: '/x' }, '__sp_emit_text "$(realpath -- "$__sp_path")"'],
    ['mkdir', { path: '/x' }, 'mkdir -- "$__sp_path"'],
    ['touch', { path: '/x' }, '( umask 077; : > "$__sp_path" )'],
    ['rename', { source: '/a', target: '/b' }, 'mv -- "$__sp_source" "$__sp_target"'],
    ['rm', { path: '/x' }, 'rm -- "$__sp_path"'],
    ['rmdir', { path: '/x' }, 'rm -rf -- "$__sp_path"'],
    ['chmod', { path: '/x', mode: '600' }, 'chmod -- "$__sp_mode" "$__sp_path"'],
    ['chown', { path: '/x', uid: '1', gid: '2' }, 'chown -- "$__sp_uid:$__sp_gid" "$__sp_path"'],
    ['copy-entry', { source: '/a', target: '/b' }, 'cp -a -- "$__sp_source" "$__sp_target"'],
    ['remove-entry', { path: '/x' }, 'rm -rf -- "$__sp_path"'],
    ['sha256', { path: '/x' }, '__sp_emit_sha256 "$__sp_path"']
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
      rootUid: '1000',
      rootGid: '1000',
      rootMode: '700'
    }, /challenge|response/],
    ['stage-export', stageBinding({
      sourcePath: '/root/secret'
    }), /exec 3>/],
    ['stage-import', stageBinding({
      targetPath: '/root/target',
      sha256: 'b'.repeat(64),
      size: '12',
      targetMode: '600',
      targetUid: '0',
      targetGid: '0'
    }), /mv -fT/],
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
      request: { operation: 'rename', args: { source: '/a' } }
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

test('privileged parser normalizes every fixed result shape', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = 'd'.repeat(48)

  function parse (operation, kind, values = [], exitCode = 0) {
    const parser = createPrivilegedFileParser({ token, request: { operation } })
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

  assert.deepEqual(parse('probe'), {
    kind: 'probe',
    capabilities: allCapabilityObject,
    ok: true
  })
  assert.deepEqual(parse('mkdir'), {
    kind: 'mkdir',
    capabilities: allCapabilityObject,
    ok: true
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
  for (const operation of ['stage-export', 'stage-import', 'sha256']) {
    assert.deepEqual(parse(operation, 'digest', ['b'.repeat(64), '12']), {
      kind: operation,
      capabilities: allCapabilityObject,
      sha256: 'b'.repeat(64),
      size: 12
    })
  }
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
      'procFd', 'noclobber', 'cat', 'gnuStat', 'realpath', 'chown',
      'chmod', 'rm'
    ], [
      'digest', 'b'.repeat(64), '12'
    ]],
    ['stage-import', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256',
      'procFd', 'noclobber', 'cat', 'gnuStat', 'gnuMv', 'realpath',
      'chown', 'chmod', 'rm'
    ], ['digest', 'b'.repeat(64), '12']],
    ['stage-cleanup', [
      'cleanShell', 'printf', 'id', 'tr', 'stat', 'base64', 'sha256', 'procFd',
      'noclobber', 'gnuStat', 'realpath', 'rm'
    ], null]
  ]

  for (const [operation, required, data] of cases) {
    for (const capability of required) {
      const parser = createPrivilegedFileParser({ token, request: { operation } })
      parser.push(startMarker(
        token,
        allCapabilities.replace(`${capability}=1`, `${capability}=0`)
      ))
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
      'printf "%s\\n%s\\n%s\\n%s\\n" "$(stat -c %d -- .)" "$(stat -c %i -- .)" "$(id -u)" "$(id -g)"'
    ].join('\n'))
    assert.equal(metadata.status, 0, metadata.stderr)
    const [rootDevice, rootInode, rootUid, rootGid] =
      metadata.stdout.trim().split('\n')
    const request = createPrivilegedFileRequest({
      operation: 'stage-export',
      args: stageBinding({
        rootPath,
        rootRealPath: rootPath,
        rootDevice,
        rootInode,
        rootUid,
        rootGid,
        sourcePath
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
    const missingPath = toBashPath(path.join(nativeRoot, 'absent'))
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
    '[ "$(__sp_sha256_raw "./$__sp_responseName")" = "$__sp_expectedResponseDigest" ]'
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
      args: stageBinding({
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

  assert.match(importCommand, /__sp_installedDigest=.*\|\|/)
  assert.match(importCommand, /"\$__sp_installedDigest" = "\$__sp_expectedSha256"/)
  assert.match(importCommand, /"\$__sp_installedSize" = "\$__sp_expectedSize"/)
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
      args: { ...binding, sourcePath: '/root/secret' }
    }
  })
  const importCommand = buildPrivilegedFileCommand({
    token,
    request: {
      operation: 'stage-import',
      args: {
        ...binding,
        targetPath: '/root/target',
        sha256: 'a'.repeat(64),
        size: '12',
        targetMode: '600',
        targetUid: '0',
        targetGid: '0'
      }
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
  assert.match(exportCommand, /exec 4< "\$__sp_sourcePath"/)
  assert.match(exportCommand, /\/proc\/\$\$\/fd\/4/)
  assert.match(exportCommand, /cat <&4 >&3/)
  assert.match(exportCommand, /stat -L -c %i -- "\$__sp_fd4"/)
  assert.doesNotMatch(exportCommand, /cp -a -- "\$__sp_sourcePath" "\$__sp_stagePath"/)
  assert.equal(
    exportCommand.indexOf('__sp_digest=') <
      exportCommand.indexOf('chown -- "$__sp_rootUid:$__sp_rootGid"'),
    true
  )
  assert.match(importCommand, /exec 3< "\.\/\$__sp_objectName"/)
  assert.match(importCommand, /__sp_targetParent="\$\{__sp_targetPath%\/\*\}"/)
  assert.match(importCommand, /__sp_targetName="\$\{__sp_targetPath##\*\/\}"/)
  assert.match(importCommand, /__sp_targetParentReal=.*realpath/)
  assert.match(importCommand, /cd -- "\$__sp_targetParent"/)
  assert.match(importCommand, /stat -c %d -- \./)
  assert.match(importCommand, /stat -c %i -- \./)
  assert.match(importCommand, /__sp_targetParentTrusted=0/)
  assert.match(importCommand, /__sp_targetParentUid=.*stat -c %u -- \./)
  assert.match(importCommand, /__sp_targetParentMode=.*stat -c %a -- \./)
  assert.match(importCommand, /0\$__sp_targetParentMode & 022/)
  assert.match(
    importCommand,
    /__sp_cleanup_temp\(\) \{ \[ "\$__sp_targetParentTrusted" = 1 \] \|\| return 0; if __sp_path_matches_fd/
  )
  assert.match(importCommand, /__sp_tempName="\.shellpilot-\$__sp_token\.tmp"/)
  assert.match(importCommand, /umask 077.*set -C.*exec 4> "\.\/\$__sp_tempName"/)
  assert.match(importCommand, /stat -L -c %a -- "\$__sp_fd4".*= 600/)
  assert.match(importCommand, /cat <&3 >&4/)
  assert.match(importCommand, /"\$__sp_expectedSize"/)
  assert.match(importCommand, /mv -fT -- "\.\/\$__sp_tempName" "\.\/\$__sp_targetName"/)
  assert.equal(
    importCommand.indexOf('chown -- "$__sp_targetUid:$__sp_targetGid" "$__sp_fd4"') <
      importCommand.indexOf('mv -fT --'),
    true
  )
  assert.equal(
    importCommand.indexOf('__sp_readyMode=') <
      importCommand.indexOf('mv -fT --'),
    true
  )
  assert.equal(
    importCommand.lastIndexOf('__sp_path_matches_fd "./$__sp_tempName"') <
      importCommand.indexOf('mv -fT --'),
    true
  )
  assert.equal(
    importCommand.lastIndexOf('__sp_path_matches_fd "./$__sp_tempName"') >
      importCommand.indexOf('__sp_readyMode='),
    true
  )
  assert.equal(importCommand.lastIndexOf('exec 4>&-') > importCommand.indexOf('mv -fT --'), true)
  assert.match(importCommand, /__sp_path_matches_fd "\.\/\$__sp_targetName" "\$__sp_tempDevice" "\$__sp_tempInode"/)
  assert.match(importCommand, /__sp_finalDigest=.*__sp_sha256_raw "\$__sp_fd4"/)
  assert.match(importCommand, /__sp_finalMode=.*stat -L -c %a -- "\$__sp_fd4"/)
  assert.match(importCommand, /__sp_cleanup_temp.*__sp_tempDevice.*__sp_tempInode/)
  assert.doesNotMatch(importCommand, /rm -f -- "\$__sp_tempPath"/)
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
          args: {
            ...binding,
            targetPath,
            sha256: 'a'.repeat(64),
            size: '12',
            targetMode: '600',
            targetUid: '0',
            targetGid: '0'
          }
        }
      }),
      /targetPath/
    )
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
  assert.match(command, /__sp_sha256_raw "\$__sp_fd3"/)
  assert.match(command, /stat -L -c %s -- "\$__sp_fd3"/)
  assert.match(command, /"\$__sp_expectedSha256"/)
  assert.match(command, /"\$__sp_expectedSize"/)
  assert.match(command, /__sp_path_matches_fd "\.\/\$__sp_objectName"/)
  assert.equal(
    command.lastIndexOf('__sp_path_matches_fd "./$__sp_objectName"') <
      command.indexOf('rm -f -- "./$__sp_objectName"'),
    true
  )
  assert.doesNotMatch(command, /rm -rf/)
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

test('linux staging handshake export import and cleanup preserve content metadata and atomic replacement', {
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
      args: { ...fixture.binding, objectName, sourcePath }
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
    fs.writeFileSync(targetPath, 'old target', { mode: 0o600 })
    const oldInode = fs.statSync(targetPath, { bigint: true }).ino
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
        targetGid: '0'
      }
    })
    assert.equal(imported.execution.status, 0, imported.execution.stderr)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), content)
    const installedStat = fs.statSync(targetPath, { bigint: true })
    assert.notEqual(installedStat.ino, oldInode)
    assert.equal(Number(installedStat.mode & 0o7777n), 0o640)
    assert.equal(installedStat.uid, 0n)
    assert.equal(installedStat.gid, 0n)
    assert.deepEqual(
      fs.readdirSync(targetParent).filter(name => name.startsWith('.shellpilot-')),
      []
    )

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

test('linux stage import rejects digest mismatch special entries directories and replaced temp names', {
  skip: linuxRootOnly
}, async () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-linux-stage-reject-'))
  try {
    const fixture = await createLinuxStageFixture(nativeRoot, 'l2')
    const targetParent = path.join(nativeRoot, 'target-parent')
    fs.mkdirSync(targetParent, { mode: 0o700 })
    const targetPath = path.join(targetParent, 'installed')
    fs.writeFileSync(targetPath, 'unchanged', { mode: 0o600 })
    const targetInode = fs.statSync(targetPath, { bigint: true }).ino
    const baseArgs = {
      ...fixture.binding,
      targetPath,
      sha256: sha256Text('trusted'),
      size: '7',
      targetMode: '600',
      targetUid: '0',
      targetGid: '0'
    }

    fs.writeFileSync(path.join(fixture.rootPath, 'digest-object'), 'different')
    const mismatch = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f1'.repeat(24),
      args: { ...baseArgs, objectName: 'digest-object' }
    })
    assert.notEqual(mismatch.execution.status, 0)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unchanged')
    assert.equal(fs.statSync(targetPath, { bigint: true }).ino, targetInode)
    assert.equal(fs.existsSync(path.join(targetParent, `.shellpilot-${'f1'.repeat(24)}.tmp`)), false)

    fs.chmodSync(targetParent, 0o777)
    const untrustedToken = 'fa'.repeat(24)
    const abandonedTemp = path.join(
      targetParent,
      `.shellpilot-${untrustedToken}.tmp`
    )
    const untrustedMismatch = await runRealProtocolOperation({
      operation: 'stage-import',
      token: untrustedToken,
      args: { ...baseArgs, objectName: 'digest-object' }
    })
    assert.notEqual(untrustedMismatch.execution.status, 0)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unchanged')
    assert.equal(fs.readFileSync(abandonedTemp, 'utf8'), 'different')
    fs.rmSync(abandonedTemp)
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
      assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unchanged')
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
      args: { ...baseArgs, objectName: 'digest-object', targetPath: directoryTarget }
    })
    assert.notEqual(directoryRejected.execution.status, 0)
    assert.equal(fs.statSync(directoryTarget).isDirectory(), true)

    const symlinkTarget = path.join(targetParent, 'symlink-target')
    fs.symlinkSync('installed', symlinkTarget)
    const symlinkTargetRejected = await runRealProtocolOperation({
      operation: 'stage-import',
      token: 'f6'.repeat(24),
      args: { ...baseArgs, objectName: 'digest-object', targetPath: symlinkTarget }
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
        targetPath: path.join(symlinkParent, 'through-link')
      }
    })
    assert.notEqual(symlinkParentRejected.execution.status, 0)
    assert.equal(fs.existsSync(path.join(targetParent, 'through-link')), false)

    const replacementToken = 'f3'.repeat(24)
    const replacementName = `.shellpilot-${replacementToken}.tmp`
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
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unchanged')

    fs.rmSync(replacementPath)
    const raceObject = path.join(fixture.rootPath, 'race-object')
    fs.writeFileSync(raceObject, Buffer.alloc(32 * 1024 * 1024, 0x61), { mode: 0o600 })
    const raceToken = 'f5'.repeat(24)
    const raceTempPath = path.join(targetParent, `.shellpilot-${raceToken}.tmp`)
    const raceLog = path.join(nativeRoot, 'race-replaced')
    const raced = await runRealProtocolOperation({
      operation: 'stage-import',
      token: raceToken,
      prelude: [
        '(',
        '  __sp_test_i=0',
        `  while [ ! -e ${quoteForBash(raceTempPath)} ] && [ "$__sp_test_i" -lt 10000 ]; do __sp_test_i=$((__sp_test_i + 1)); sleep 0.001; done`,
        `  if [ -e ${quoteForBash(raceTempPath)} ]; then rm -f -- ${quoteForBash(raceTempPath)}; printf foreign > ${quoteForBash(raceTempPath)}; printf replaced > ${quoteForBash(raceLog)}; fi`,
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
    assert.equal(fs.readFileSync(raceTempPath, 'utf8'), 'foreign')
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unchanged')
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})

test('linux stage import metadata failure preserves the old target and removes its matching temp', {
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
    const oldContent = 'old target must remain'
    fs.writeFileSync(targetPath, oldContent, { mode: 0o640 })
    fs.chmodSync(targetPath, 0o640)
    const oldStat = fs.statSync(targetPath, { bigint: true })
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
        targetGid: '0'
      }
    })
    assert.notEqual(rejected.execution.status, 0)
    assert.equal(fs.readFileSync(targetPath, 'utf8'), oldContent)
    const preservedStat = fs.statSync(targetPath, { bigint: true })
    assert.equal(preservedStat.ino, oldStat.ino)
    assert.equal(Number(preservedStat.mode & 0o7777n), Number(oldStat.mode & 0o7777n))
    assert.equal(preservedStat.uid, oldStat.uid)
    assert.equal(preservedStat.gid, oldStat.gid)
    assert.deepEqual(
      fs.readdirSync(targetParent).filter(name => name.startsWith('.shellpilot-')),
      []
    )
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true })
  }
})
