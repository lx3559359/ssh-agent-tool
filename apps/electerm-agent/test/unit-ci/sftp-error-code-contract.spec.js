const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')

test('SFTP websocket errors preserve only safe authoritative codes', async () => {
  const { projectSftpError } = require(path.join(
    root,
    'src/app/common/sftp-error-contract.js'
  ))
  const { reconstructSftpError } = await import(pathToFileURL(path.join(
    root,
    'src/client/common/sftp-error.js'
  )).href)

  for (const code of ['ENOENT', 'EACCES', 'ETIMEDOUT', 2]) {
    const projected = projectSftpError(Object.assign(new Error('failed'), {
      code
    }))
    assert.equal(projected.code, code)
    const reconstructed = reconstructSftpError(projected, 'fallback')
    assert.equal(reconstructed.message, 'failed')
    assert.equal(reconstructed.code, code)
  }

  const unsafe = projectSftpError(Object.assign(new Error('failed'), {
    code: '<script>bad</script>'
  }))
  assert.equal(Object.hasOwn(unsafe, 'code'), false)
  const reconstructed = reconstructSftpError({
    message: 'missing',
    code: { value: 'ENOENT' }
  }, 'fallback')
  assert.equal(Object.hasOwn(reconstructed, 'code'), false)
  assert.equal(reconstructSftpError({ message: '' }, 'fallback').message, 'fallback')
})

test('SFTP server and renderer wire the safe error code projection', () => {
  const server = fs.readFileSync(path.join(
    root,
    'src/app/server/session-server.js'
  ), 'utf8')
  const client = fs.readFileSync(path.join(
    root,
    'src/client/common/sftp.js'
  ), 'utf8')

  assert.match(server, /projectSftpError\(err\)/)
  assert.match(client, /reconstructSftpError\(arg\.error, fallback\)/)
})
