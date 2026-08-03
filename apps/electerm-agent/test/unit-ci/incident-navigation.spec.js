const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const navigationPath = path.join(
  root,
  'src/client/components/incidents/incident-navigation.js'
)

async function loadNavigation () {
  assert.ok(
    fs.existsSync(navigationPath),
    'incident archive navigation module must exist'
  )
  return import(`${pathToFileURL(navigationPath)}?test=${Date.now()}`)
}

test('incident workspace opens without replacing terminal tabs', async () => {
  const {
    openIncidentArchive,
    closeIncidentArchive
  } = await loadNavigation()
  const tabs = [{ id: 'ssh-1' }]
  const store = {
    mainWorkspaceMode: 'terminal',
    activeIncidentId: '',
    tabs,
    activeTabId: 'ssh-1'
  }

  assert.equal(openIncidentArchive(store, 'incident-1'), true)
  assert.equal(store.mainWorkspaceMode, 'incident-archives')
  assert.equal(store.activeIncidentId, 'incident-1')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(store.activeTabId, 'ssh-1')
  assert.equal(openIncidentArchive(store, 'incident-1'), false)

  assert.equal(closeIncidentArchive(store), true)
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(closeIncidentArchive(store), false)
})

test('inactive terminal layer is inert while incident workspace is open', async () => {
  const {
    focusIncidentWorkspace,
    getIncidentWorkspaceAccessibility
  } = await loadNavigation()

  assert.deepEqual(getIncidentWorkspaceAccessibility(true), {
    inert: true,
    'aria-hidden': true
  })
  assert.deepEqual(getIncidentWorkspaceAccessibility(false), {
    inert: false,
    'aria-hidden': false
  })

  const focusCalls = []
  const workspace = {
    focus: options => focusCalls.push(options)
  }
  assert.equal(focusIncidentWorkspace(false, workspace), false)
  assert.equal(focusIncidentWorkspace(true, workspace), true)
  assert.deepEqual(focusCalls, [{ preventScroll: true }])
})
