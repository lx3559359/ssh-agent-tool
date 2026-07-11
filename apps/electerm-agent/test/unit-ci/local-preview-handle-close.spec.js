const test = require('node:test')
const assert = require('node:assert/strict')
const fss = require('node:fs/promises')

const fsModulePath = require.resolve('../../src/app/lib/fs')
const runtimeModulePath = require.resolve('../../src/app/common/runtime-constants')
const originalOpen = fss.open
const originalNodeEnv = process.env.NODE_ENV

test.afterEach(() => {
  fss.open = originalOpen
  process.env.NODE_ENV = originalNodeEnv
  delete require.cache[fsModulePath]
  delete require.cache[runtimeModulePath]
})

test('local preview closes its file handle when reading fails', async () => {
  let closeCalled = false
  fss.open = async () => ({
    read: async () => {
      throw new Error('read failed')
    },
    close: async () => {
      closeCalled = true
    }
  })
  process.env.NODE_ENV = 'development'
  delete require.cache[fsModulePath]
  delete require.cache[runtimeModulePath]
  const { fsExport } = require('../../src/app/lib/fs')

  await assert.rejects(
    fsExport.readFilePreview('/tmp/failure.log', 32),
    /read failed/
  )
  assert.equal(closeCalled, true)
})
