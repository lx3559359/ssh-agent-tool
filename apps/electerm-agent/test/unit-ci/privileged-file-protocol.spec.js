const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const protocolModule =
  'src/client/components/sftp/privileged-file-protocol.js'

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
  assert.equal(command.includes(Buffer.from(hostile).toString('base64')), true)
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
    parser.push(startMarker(token))
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
    capabilities: { sh: true, stat: true },
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
      capabilities: { sh: true, stat: true },
      sha256: 'b'.repeat(64),
      size: 12
    })
  }
})

test('privileged parser enforces boundary order and ignores other namespaces and tokens', async () => {
  const { createPrivilegedFileParser } = await importModule(protocolModule)
  const { createPtyTaskOutputParser } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'
  )
  const token = 'e'.repeat(48)
  const request = { operation: 'list' }
  const parser = createPrivilegedFileParser({ token, request })

  parser.push(fileMarker('f'.repeat(48), 'start', 'bad', 'bad', 'bad'))
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
