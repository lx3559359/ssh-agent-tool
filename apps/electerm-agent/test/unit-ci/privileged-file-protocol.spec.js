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

const allStageCapabilities = [
  'sh=1', 'cleanShell=1', 'stat=1', 'base64=1', 'sha256=1', 'procFd=1',
  'noclobber=1', 'cat=1', 'gnuStat=1', 'gnuMv=1',
  'realpath=1', 'chown=1', 'chmod=1', 'rm=1'
].join(',')

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function fileMarker (token, phase, ...fields) {
  return `\u001b]698;SHELLPILOT_FILE;${token};${phase};${fields.join(';')}\u0007`
}

function startMarker (token, capabilities = 'sh=1,stat=1') {
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
    encodeMarkerField('sh=1,stat=1')
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
    capabilities: { sh: true, stat: true },
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
    ['list', { path: '/x' }, '"$__sp_path"/.[!.]* "$__sp_path"/..?* "$__sp_path"/*'],
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
    ['stage-cleanup', stageBinding(), /rm -f/]
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
    const capabilities = operation.startsWith('stage-')
      ? allStageCapabilities
      : 'sh=1,stat=1'
    parser.push(startMarker(token, capabilities))
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
    capabilities: { sh: true, stat: true },
    ok: true
  })
  assert.deepEqual(parse('mkdir'), {
    kind: 'mkdir',
    capabilities: { sh: true, stat: true },
    ok: true
  })
  assert.deepEqual(parse('stat', 'metadata', ['41ed;4;1;2;3;4']), {
    kind: 'stat',
    capabilities: { sh: true, stat: true },
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
    capabilities: { sh: true, stat: true },
    text: "target\n'"
  })
  assert.deepEqual(parse('stage-handshake', 'handshake', [
    'a'.repeat(64), '1000', '1001', '700', '/real/stage', '2049', '12345'
  ]), {
    kind: 'stage-handshake',
    capabilities: Object.fromEntries(
      allStageCapabilities.split(',').map(value => [value.split('=')[0], true])
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
      capabilities: operation.startsWith('stage-')
        ? Object.fromEntries(
          allStageCapabilities.split(',').map(value => [value.split('=')[0], true])
        )
        : { sh: true, stat: true },
      sha256: 'b'.repeat(64),
      size: 12
    })
  }
})

test('stage parser rejects forged success when a required capability is false', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const token = '4'.repeat(48)
  const cases = [
    ['stage-handshake', ['cleanShell', 'procFd', 'noclobber', 'realpath', 'chown'], [
      'handshake', 'a'.repeat(64), '1000', '1001', '700',
      '/real/stage', '2049', '12345'
    ]],
    ['stage-export', [
      'cleanShell', 'procFd', 'noclobber', 'cat', 'realpath', 'chown', 'chmod'
    ], [
      'digest', 'b'.repeat(64), '12'
    ]],
    ['stage-import', [
      'cleanShell', 'procFd', 'noclobber', 'cat', 'gnuMv', 'realpath',
      'chown', 'chmod'
    ], ['digest', 'b'.repeat(64), '12']],
    ['stage-cleanup', [
      'cleanShell', 'procFd', 'noclobber', 'realpath', 'rm'
    ], null]
  ]

  for (const [operation, required, data] of cases) {
    for (const capability of required) {
      const parser = createPrivilegedFileParser({ token, request: { operation } })
      parser.push(startMarker(
        token,
        allStageCapabilities.replace(`${capability}=1`, `${capability}=0`)
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
    request: { operation: 'stage-cleanup', args: binding }
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
  assert.match(importCommand, /exec 4> "\$__sp_tempPath"/)
  assert.match(importCommand, /"\$__sp_expectedSize"/)
  assert.match(importCommand, /mv -fT -- "\$__sp_tempPath" "\$__sp_targetPath"/)
  assert.match(importCommand, /mv -fT[^;]+\|\| \{ rm -f -- "\$__sp_tempPath"; return 1; \}/)
  assert.match(cleanupCommand, /rm -f -- "\.\/\$__sp_objectName"/)
  assert.doesNotMatch(cleanupCommand, /rm -rf/)

  assert.throws(
    () => buildPrivilegedFileCommand({
      token,
      request: {
        operation: 'stage-cleanup',
        args: { ...binding, objectName: '../escape' }
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
})
