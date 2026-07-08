const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/sftp/file-name-validation.js')
).href

test('sftp file name validation rejects empty and dot-only names with Chinese messages', async () => {
  const { validateSftpFileName } = await import(moduleUrl)

  assert.deepEqual(validateSftpFileName(''), {
    ok: false,
    message: '文件名不能为空'
  })
  assert.deepEqual(validateSftpFileName('   '), {
    ok: false,
    message: '文件名不能为空'
  })
  assert.deepEqual(validateSftpFileName('.'), {
    ok: false,
    message: '文件名不能为 . 或 ..'
  })
  assert.deepEqual(validateSftpFileName('..'), {
    ok: false,
    message: '文件名不能为 . 或 ..'
  })
})

test('sftp file name validation trims safe names before file operations', async () => {
  const { validateSftpFileName } = await import(moduleUrl)

  assert.deepEqual(validateSftpFileName('  nginx.conf  '), {
    ok: true,
    name: 'nginx.conf'
  })
})

test('sftp file item validates blur names before create or rename operations', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/file-item.jsx'),
    'utf8'
  )
  const start = source.indexOf('handleBlur = () => {')
  const end = source.indexOf('rename = (oldname, newname) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /validateSftpFileName\(nameTemp\)/)
  assert.match(body, /message\.warning\(validation\.message\)/)
  assert.match(body, /return this\.cancelNew\(type\)/)
  assert.match(body, /this\.rename\(name,\s*validation\.name\)/)
})
