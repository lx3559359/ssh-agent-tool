const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-task-adapter.js'
)).href

test('transfer adapter persists progress at most every two seconds or four MiB', async () => {
  const patches = []
  const times = [0, 100, 200, 2100]
  const { createTransferTaskAdapter } = await import(moduleUrl)
  const adapter = createTransferTaskAdapter({
    patchTask: async (id, patch) => patches.push({ id, patch }),
    clock: () => times.shift()
  })

  assert.equal(await adapter.onProgress('one', {
    transferred: 1,
    total: 100
  }), true)
  assert.equal(await adapter.onProgress('one', {
    transferred: 2,
    total: 100
  }), false)
  assert.equal(await adapter.onProgress('one', {
    transferred: (4 * 1024 * 1024) + 2,
    total: 10 * 1024 * 1024
  }), true)
  assert.equal(await adapter.onProgress('one', {
    transferred: (4 * 1024 * 1024) + 3,
    total: 10 * 1024 * 1024
  }), false)
  assert.equal(patches.length, 2)
})

test('transfer adapter records confirmed pause and explicit resume states', async () => {
  const patches = []
  const { createTransferTaskAdapter } = await import(moduleUrl)
  const adapter = createTransferTaskAdapter({
    patchTask: async (id, patch) => patches.push({ id, patch })
  })
  const checkpoint = {
    offset: 4096,
    partialPath: '/tmp/.file.shellpilot-upload-one.part'
  }

  await adapter.requestPause('one')
  await adapter.onPaused('one', checkpoint)
  await adapter.onResume('one')

  assert.deepEqual(patches, [
    {
      id: 'one',
      patch: { status: 'pausing' }
    },
    {
      id: 'one',
      patch: {
        status: 'paused',
        metadata: { checkpoint }
      }
    },
    {
      id: 'one',
      patch: { status: 'resuming' }
    },
    {
      id: 'one',
      patch: { status: 'running' }
    }
  ])
})

test('interrupted transfer exposes resume while active transfer exposes pause', async () => {
  const { getTransferPrimaryAction } = await import(moduleUrl)
  assert.equal(getTransferPrimaryAction({ status: 'interrupted' }), 'resume')
  assert.equal(getTransferPrimaryAction({ status: 'paused' }), 'resume')
  assert.equal(getTransferPrimaryAction({ status: 'pausing' }), 'waiting')
  assert.equal(getTransferPrimaryAction({ status: 'running' }), 'pause')
  assert.equal(getTransferPrimaryAction({ status: 'completed' }), null)
})
