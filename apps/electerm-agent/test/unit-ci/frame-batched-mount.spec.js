const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadScheduler () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/frame-batched-mount.js'
  )))
}

function createHarness () {
  const frames = new Map()
  let nextId = 1
  return {
    frames,
    requestFrame: callback => {
      const id = nextId++
      frames.set(id, callback)
      return id
    },
    cancelFrame: id => frames.delete(id),
    runFrame () {
      const [id, callback] = frames.entries().next().value
      frames.delete(id)
      callback()
    }
  }
}

test('frame batched mount only mounts requested sections one per frame', async () => {
  const { createFrameBatchedMount } = await loadScheduler()
  const harness = createHarness()
  const mounted = []
  const scheduler = createFrameBatchedMount({
    onMount: index => mounted.push(index),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame
  })

  scheduler.start([1])
  assert.equal(harness.frames.size, 0)
  scheduler.request(3)
  scheduler.request(3)
  scheduler.request(2)
  assert.equal(harness.frames.size, 1)
  harness.runFrame()
  assert.deepEqual(mounted, [3])
  assert.equal(harness.frames.size, 1)
  harness.runFrame()
  assert.deepEqual(mounted, [3, 2])
  assert.equal(harness.frames.size, 0)
})

test('frame batched mount cancels pending requests', async () => {
  const { createFrameBatchedMount } = await loadScheduler()
  const harness = createHarness()
  const mounted = []
  const scheduler = createFrameBatchedMount({
    onMount: index => mounted.push(index),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame
  })

  scheduler.start([1])
  scheduler.request(4)
  scheduler.cancel()
  assert.equal(harness.frames.size, 0)
  assert.deepEqual(mounted, [])
  scheduler.request(2)
  assert.equal(harness.frames.size, 0)
})
