const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/choose-save-folder.js'
))

test('save-folder bridge is resolved only when the dialog is requested', async () => {
  const previousWindow = global.window
  global.window = {}
  try {
    const { chooseSaveDirectory } = await import(`${moduleUrl.href}?test=${Date.now()}`)
    await assert.rejects(
      chooseSaveDirectory(),
      /save-folder dialog is unavailable/
    )

    let options
    global.window.api = {
      openDialog: async value => {
        options = value
        return ['C:\\safe-output']
      }
    }
    assert.equal(await chooseSaveDirectory({ title: 'Export' }), 'C:\\safe-output')
    assert.equal(options.title, 'Export')
    assert.ok(options.properties.includes('openDirectory'))
  } finally {
    global.window = previousWindow
  }
})
