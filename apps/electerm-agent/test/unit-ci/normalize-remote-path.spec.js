const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('normalizes relative sftp paths to absolute remote paths', async () => {
  const {
    default: normalizeRemotePath
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/normalize-remote-path.js')))

  assert.equal(normalizeRemotePath('var/www/app'), '/var/www/app')
  assert.equal(normalizeRemotePath('./logs'), '/logs')
  assert.equal(normalizeRemotePath('../tmp'), '/tmp')
})

test('keeps absolute and windows-style sftp paths normalized', async () => {
  const {
    default: normalizeRemotePath
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/normalize-remote-path.js')))

  assert.equal(normalizeRemotePath('/var/www/app'), '/var/www/app')
  assert.equal(normalizeRemotePath('C:\\Users\\ops'), '/C:/Users/ops')
  assert.equal(normalizeRemotePath('/C:\\Users\\ops'), '/C:/Users/ops')
})
