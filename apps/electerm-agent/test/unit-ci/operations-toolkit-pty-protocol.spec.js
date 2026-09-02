const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const protocolModule =
  'src/client/components/operations-toolkit/runtime/pty-task-protocol.js'

test('PTY task tokens come from the secure random source', async () => {
  const { createPtyTaskToken } = await importModule(protocolModule)
  const tokens = new Set(Array.from(
    { length: 32 },
    () => createPtyTaskToken()
  ))

  assert.equal(tokens.size, 32)
  assert.equal(
    [...tokens].every(token => /^[a-f0-9]{48}$/.test(token)),
    true
  )
})

test('PTY wrapper probes effective identity and transports script as Base64', async () => {
  const { buildPtyTaskCommand } = await importModule(protocolModule)
  const rawScript = "printf '%s\\n' root; exit 7"
  const command = buildPtyTaskCommand({
    token: 'a'.repeat(32),
    script: rawScript
  })

  assert.match(command, /id -u/)
  assert.match(command, /id -un/)
  assert.match(command, /base64 -d \| sh/)
  assert.match(command, /SHELLPILOT_OPS/)
  assert.match(command, /exit "\$__sp_status"/)
  assert.doesNotMatch(command, new RegExp(rawScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(command.includes('\n'), false)
})

test('PTY wrapper exposes one exact top-level command to shell integration', async () => {
  const { buildPtyTaskCommand } = await importModule(protocolModule)
  const command = buildPtyTaskCommand({
    token: '9'.repeat(48),
    script: "printf 'managed output\\n'; uname -s"
  })

  assert.match(command, /^sh -c '/)
  assert.equal(command.includes('\n'), false)
  assert.equal(command.slice('sh -c '.length).startsWith("'"), true)
  assert.equal(command.endsWith("'"), true)
  assert.match(command, /SHELLPILOT_OPS/)
  assert.doesNotMatch(command, /^__sp_token=/)
})

test('PTY wrapper rejects caller-supplied invalid boundary tokens', async () => {
  const { buildPtyTaskCommand } = await importModule(protocolModule)

  assert.throws(
    () => buildPtyTaskCommand({ token: 'not-random', script: 'id' }),
    /令牌/
  )
})

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function taskMarker (token, phase, ...fields) {
  return `\u001b]697;SHELLPILOT_OPS;${token};${phase};${fields.join(';')}\u0007`
}

test('PTY parser accepts split markers and emits only bounded clean output', async () => {
  const { createPtyTaskOutputParser } = await importModule(protocolModule)
  const token = 'b'.repeat(32)
  const parser = createPtyTaskOutputParser({ token })
  const start = taskMarker(
    token,
    'start',
    encodeMarkerField('0'),
    encodeMarkerField('root')
  )
  const end = taskMarker(token, 'end', '7')
  const chunks = [
    `ignored prompt\r\n${start.slice(0, 34)}`,
    `${start.slice(34)}hello \u001b[31mro`,
    `ot\u001b[0m\r\n${end.slice(0, 29)}`,
    `${end.slice(29)}ignored prompt`
  ]
  const output = chunks.flatMap(chunk => parser.push(chunk).output).join('')

  assert.deepEqual(parser.identity(), { uid: '0', username: 'root' })
  assert.equal(output, 'hello root\n')
  assert.equal(parser.exitCode(), 7)
  assert.equal(parser.started(), true)
  assert.equal(parser.ended(), true)
})

test('PTY parser rejects forged tokens malformed identities and invalid boundaries', async () => {
  const { createPtyTaskOutputParser } = await importModule(protocolModule)
  const token = 'c'.repeat(32)

  assert.throws(
    () => createPtyTaskOutputParser({ token }).push(taskMarker(
      'd'.repeat(32),
      'start',
      encodeMarkerField('0'),
      encodeMarkerField('root')
    )),
    /令牌/
  )
  assert.throws(
    () => createPtyTaskOutputParser({ token }).push(taskMarker(
      token,
      'start',
      encodeMarkerField('not-a-uid'),
      encodeMarkerField('root')
    )),
    /身份/
  )
  assert.throws(
    () => createPtyTaskOutputParser({ token }).push(
      taskMarker(token, 'end', '0')
    ),
    /结束边界/
  )
})

test('PTY parser rejects duplicate boundaries and out-of-range exit codes', async () => {
  const { createPtyTaskOutputParser } = await importModule(protocolModule)
  const token = 'e'.repeat(32)
  const start = taskMarker(
    token,
    'start',
    encodeMarkerField('1000'),
    encodeMarkerField('hik')
  )
  const parser = createPtyTaskOutputParser({ token })

  parser.push(start)
  assert.throws(() => parser.push(start), /开始边界/)

  const invalidExitParser = createPtyTaskOutputParser({ token })
  invalidExitParser.push(start)
  assert.throws(
    () => invalidExitParser.push(taskMarker(token, 'end', '256')),
    /结束边界/
  )
})

test('PTY parser bounds unterminated marker buffering', async () => {
  const { createPtyTaskOutputParser } = await importModule(protocolModule)
  const token = 'f'.repeat(32)
  const parser = createPtyTaskOutputParser({ token })

  assert.throws(
    () => parser.push(
      `\u001b]697;SHELLPILOT_OPS;${token};start;${'A'.repeat(4096)}`
    ),
    /边界过长/
  )
})

test('terminal sanitizer keeps split Unicode while removing split ANSI and OSC', async () => {
  const { createTerminalTextSanitizer } = await importModule(protocolModule)
  const sanitizer = createTerminalTextSanitizer()
  const emoji = '😀'
  const output = [
    sanitizer.push(`A\r\n中${emoji[0]}`),
    sanitizer.push(`${emoji[1]}\u001b[`),
    sanitizer.push('31m红\u001b]0;title'),
    sanitizer.push('\u0007色\u001b('),
    sanitizer.push(`0B${emoji}\r`),
    sanitizer.finish()
  ].join('')

  assert.equal(output, `A\n中${emoji}红色B${emoji}\n`)
  assert.equal(output.includes('\u001b'), false)
  assert.equal(output.includes('\u0007'), false)
  assert.equal(output.includes('�'), false)
})

test('terminal sanitizer removes OSC terminated by ST across chunks', async () => {
  const { createTerminalTextSanitizer } = await importModule(protocolModule)
  const sanitizer = createTerminalTextSanitizer()
  const output = [
    sanitizer.push('before\u001b]633;A;nonce\u001b'),
    sanitizer.push('\\after'),
    sanitizer.finish()
  ].join('')

  assert.equal(output, 'beforeafter')
})
