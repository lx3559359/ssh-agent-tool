const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/components/common/input-context-menu-target.js'
)

test('global input context menu ignores xterm helper textareas', async () => {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'input context menu target policy should be implemented as a testable module'
  )

  const { shouldUseInputContextMenu } = await import(pathToFileURL(modulePath).href)
  const normalTextarea = {
    tagName: 'TEXTAREA',
    closest: () => null
  }
  const xtermTextarea = {
    tagName: 'TEXTAREA',
    closest: selector => selector === '.xterm' ? {} : null
  }
  const terminalCanvas = {
    tagName: 'DIV',
    closest: selector => selector === '.xterm' ? {} : null
  }

  assert.equal(shouldUseInputContextMenu(normalTextarea), true)
  assert.equal(shouldUseInputContextMenu(xtermTextarea), false)
  assert.equal(shouldUseInputContextMenu(terminalCanvas), false)
})

test('input context menu component delegates target filtering to the shared policy', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/common/input-context-menu.jsx'
  ), 'utf8')

  assert.match(source, /import \{ shouldUseInputContextMenu \} from '\.\/input-context-menu-target\.js'/)
  assert.match(source, /if \(shouldUseInputContextMenu\(target\)\)/)
})
