const test = require('node:test')
const assert = require('node:assert/strict')

test('chunk recovery recognizes stale dynamic import failures only', async () => {
  const {
    isChunkLoadError
  } = await import('../../src/client/components/common/chunk-load-recovery.js')

  assert.equal(isChunkLoadError(new Error('Loading chunk 812 failed')), true)
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/help.js')), true)
  assert.equal(isChunkLoadError(new Error('Cannot read properties of null')), false)
})

test('chunk recovery auto reloads once per failed asset and then exposes manual recovery', async () => {
  const {
    tryAutoRecoverChunkLoad
  } = await import('../../src/client/components/common/chunk-load-recovery.js')
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  }
  let reloads = 0
  const error = new Error('Loading chunk 812 failed (http://127.0.0.1/assets/help-812.js)')

  assert.equal(tryAutoRecoverChunkLoad(error, {
    storage,
    reload: () => { reloads += 1 }
  }), true)
  assert.equal(reloads, 1)
  assert.equal(tryAutoRecoverChunkLoad(error, {
    storage,
    reload: () => { reloads += 1 }
  }), false)
  assert.equal(reloads, 1)
})

test('lazy module entry points use the shared recovery boundary', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(__dirname, '../..')
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')

  for (const file of [
    'src/client/components/ai/ai-chat-entry.jsx',
    'src/client/components/main/main.jsx',
    'src/client/components/main/aigshell-topbar.jsx',
    'src/client/components/side-panel-r/side-panel-r.jsx'
  ]) {
    assert.match(read(file), /LazyModuleBoundary/, file)
  }
})
