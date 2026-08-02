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

test('session pane tabs and icon controls expose native keyboard semantics', () => {
  const session = readClient('components/session/session.jsx')
  const styles = readClient('components/session/session.styl')

  assert.match(session, /role='tablist'/)
  assert.match(session, /<button[\s\S]*role='tab'/)
  assert.match(session, /aria-selected=\{types\[i\] === pane\}/)
  assert.match(session, /tabIndex=\{types\[i\] === pane \? 0 : -1\}/)
  assert.match(session, /aria-controls=\{`session-pane-\$\{types\[i\]\}-\$\{tab\.id\}`\}/)
  assert.match(session, /handlePaneTabKeyDown/)
  assert.match(session, /ArrowLeft/)
  assert.match(session, /ArrowRight/)
  assert.match(session, /Home/)
  assert.match(session, /End/)
  assert.match(session, /id=\{`session-pane-\$\{paneMap\.terminal\}-\$\{tab\.id\}`\}/)
  assert.match(session, /id=\{`session-pane-\$\{paneMap\.fileManager\}-\$\{id\}`\}/)
  assert.ok((session.match(/className='session-icon-button/g) || []).length >= 7)
  assert.match(session, /aria-pressed=\{sshSftpSplitView\}/)
  assert.match(session, /aria-pressed=\{sftpPathFollowSsh\}/)
  assert.match(session, /aria-pressed=\{keepaliveEnabled\}/)
  assert.match(session, /aria-pressed=\{broadcastInput\}/)
  assert.match(styles, /\.type-tab:focus-visible[\s\S]*outline/)
  assert.match(styles, /\.session-icon-button:focus-visible[\s\S]*outline/)
})

test('SFTP uses grid, row, column-header, and roving-focus semantics', () => {
  const table = readClient('components/sftp/list-table-ui.jsx')
  const row = readClient('components/sftp/file-item.jsx')
  const header = readClient('components/sftp/file-table-header.jsx')
  const styles = readClient('components/sftp/sftp.styl')

  assert.match(table, /role='grid'/)
  assert.match(table, /aria-rowcount=\{rowCount\}/)
  assert.match(row, /role='row'/)
  assert.match(row, /aria-rowindex=\{rowIndex\}/)
  assert.match(row, /aria-selected=\{selected\}/)
  assert.match(header, /role='columnheader'/)
  assert.match(styles, /\.sftp-item:focus-visible[\s\S]*outline/)
})

test('safety center records and result updates expose list and live-region semantics', () => {
  const modal = readClient('components/main/safety-operation-center-modal.jsx')

  assert.match(modal, /role='list'/)
  assert.ok((modal.match(/role='listitem'/g) || []).length >= 3)
  assert.match(modal, /role='status'/)
  assert.match(modal, /aria-live='polite'/)
  assert.match(modal, /aria-busy=\{loading\}/)
  assert.match(modal, /aria-label=\{e\('shellpilotSafetySearchPlaceholder'\)\}/)
})
