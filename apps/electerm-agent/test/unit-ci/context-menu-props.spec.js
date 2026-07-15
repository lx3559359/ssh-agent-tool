const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/common/context-menu-props.js')
).href

test('context menu ids stay unique across repeated and mixed menu instances', async () => {
  const { createContextMenuId } = await import(moduleUrl)
  const ids = [
    createContextMenuId('terminal-menu'),
    createContextMenuId('terminal-menu'),
    createContextMenuId('bookmark-menu'),
    createContextMenuId('input-menu')
  ]

  assert.equal(new Set(ids).size, ids.length)
  assert.match(ids[0], /^shellpilot-terminal-menu-\d+$/)
  assert.match(ids[2], /^shellpilot-bookmark-menu-\d+$/)
})
