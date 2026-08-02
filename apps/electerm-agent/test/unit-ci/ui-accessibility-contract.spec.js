const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const isolationPath = path.join(clientRoot, 'common/dialog-background-isolation.js')
const isolationUrl = pathToFileURL(isolationPath).href

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

function createRoot (initialAriaHidden = null) {
  const attributes = new Map()
  if (initialAriaHidden !== null) attributes.set('aria-hidden', initialAriaHidden)
  return {
    inert: false,
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  }
}

test('custom modal and drawer expose complete dialog semantics', () => {
  const modal = readClient('components/common/modal.jsx')
  const drawer = readClient('components/common/drawer.jsx')
  const isolation = fs.readFileSync(isolationPath, 'utf8')

  assert.match(modal, /createPortal/)
  assert.match(modal, /useDialogBackgroundIsolation\(open\)/)
  assert.match(modal, /aria-labelledby=\{titleId\}/)
  assert.match(modal, /aria-label=\{e\('shellpilotCloseDialog'\)\}/)
  assert.match(drawer, /createPortal/)
  assert.match(drawer, /role='dialog'/)
  assert.match(drawer, /aria-modal='true'/)
  assert.match(drawer, /aria-labelledby=\{titleId\}/)
  assert.match(drawer, /useDialogBackgroundIsolation\(open\)/)
  assert.match(isolation, /root\.inert = true/)
  assert.match(isolation, /activeOwners\.size/)
})

test('nested dialog isolation restores the exact original background state', async () => {
  const {
    acquireDialogBackgroundIsolation,
    releaseDialogBackgroundIsolation
  } = await import(isolationUrl)
  const root = createRoot('navigation')
  const firstOwner = Symbol('first-dialog')
  const secondOwner = Symbol('nested-dialog')

  acquireDialogBackgroundIsolation(firstOwner, root)
  assert.equal(root.inert, true)
  assert.equal(root.getAttribute('aria-hidden'), 'true')

  acquireDialogBackgroundIsolation(secondOwner, root)
  releaseDialogBackgroundIsolation(firstOwner)
  assert.equal(root.inert, true)
  assert.equal(root.getAttribute('aria-hidden'), 'true')

  releaseDialogBackgroundIsolation(secondOwner)
  assert.equal(root.inert, false)
  assert.equal(root.getAttribute('aria-hidden'), 'navigation')
})

test('dialog isolation removes aria-hidden when the background had no prior value', async () => {
  const {
    acquireDialogBackgroundIsolation,
    releaseDialogBackgroundIsolation
  } = await import(isolationUrl)
  const root = createRoot()
  const owner = Symbol('dialog')

  acquireDialogBackgroundIsolation(owner, root)
  releaseDialogBackgroundIsolation(owner)

  assert.equal(root.inert, false)
  assert.equal(root.getAttribute('aria-hidden'), null)
})
