const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-search-scheduler.js')
).href

function createFakeTimers () {
  let nextId = 1
  const pending = new Map()
  return {
    setTimer (callback) {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    clearTimer (id) {
      pending.delete(id)
    },
    flush () {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach(callback => callback())
    },
    get size () {
      return pending.size
    }
  }
}

test('bookmark search scheduler only applies the newest rapid input', async () => {
  const { createBookmarkSearchScheduler } = await import(moduleUrl)
  const timers = createFakeTimers()
  const searches = []
  const scheduler = createBookmarkSearchScheduler({
    onSearch: term => searches.push(term),
    setTimer: callback => timers.setTimer(callback),
    clearTimer: id => timers.clearTimer(id),
    delay: 150
  })

  scheduler.schedule('p')
  scheduler.schedule('pr')
  scheduler.schedule('prod')

  assert.equal(timers.size, 1)
  timers.flush()
  assert.deepEqual(searches, ['prod'])
})

test('bookmark search scheduler cancellation prevents work after unmount', async () => {
  const { createBookmarkSearchScheduler } = await import(moduleUrl)
  const timers = createFakeTimers()
  const searches = []
  const scheduler = createBookmarkSearchScheduler({
    onSearch: term => searches.push(term),
    setTimer: callback => timers.setTimer(callback),
    clearTimer: id => timers.clearTimer(id)
  })

  scheduler.schedule('server')
  scheduler.cancel()
  timers.flush()

  assert.deepEqual(searches, [])
})
