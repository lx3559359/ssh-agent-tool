const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp', relativePath),
    'utf8'
  )
}

test('sftp file list double click delegates to the file entry action', () => {
  const source = readClientSource('list-table-ui.jsx')

  assert.match(source, /handleDoubleClick\s*=\s*\(e\)\s*=>/)
  assert.match(source, /const target = e\.target\.closest\('\[data-id\]'\)/)
  assert.match(source, /filesRef\.get\('file-' \+ id\)/)
  assert.match(source, /ref\.transferOrEnterDirectory\(e\)/)
  assert.match(source, /onDoubleClick:\s*this\.handleDoubleClick/)
})

test('sftp directory entries update the current path and reload the list', () => {
  const source = readClientSource('file-item.jsx')
  const start = source.indexOf('enterDirectory = (e, file = this.state.file) => {')
  const end = source.indexOf('openFile = file => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /let np = resolve\(path,\s*name\)/)
  assert.match(body, /np = normalizeRemotePath\(np\)/)
  assert.match(body, /\[n\]: np/)
  assert.match(body, /\[n \+ 'Temp'\]: np/)
  assert.match(body, /this\.props\[`\$\{type\}List`\]\(/)
  assert.match(body, /undefined,\s*undefined,\s*op/)
})

test('sftp double click enters directories before opening or transferring files', () => {
  const source = readClientSource('file-item.jsx')
  const start = source.indexOf('transferOrEnterDirectory = async (e, edit) => {')
  const end = source.indexOf('getTransferList = async (')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /if \(isDirectory\) \{[\s\S]*return this\.enterDirectory\(e\)[\s\S]*\}/)
  assert.match(body, /return this\.openFile\(this\.state\.file\)/)
  assert.match(body, /return this\.editFile\(\)/)
  assert.match(body, /this\.transfer\(\)/)
})

test('sftp double click reads a remote editor file through the entry capability', () => {
  const source = readClientSource('file-item.jsx')
  const start = source.indexOf('fetchEditorText = async (path, type) => {')
  const end = source.indexOf('\n  onSubmitEditFile', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /typeMap\.remote === type/)
  assert.match(body, /this\.props\.readRemoteFile\(path\)/)
  assert.doesNotMatch(body, /this\.props\.sftp\.readFile/)
})

test('sftp address bar supports Enter navigation and reload-or-jump button actions', () => {
  const source = readClientSource('address-bar.jsx')

  assert.match(source, /const GoIcon = isLoadingRemote\s*\?[\s\S]*LoadingOutlined[\s\S]*:\s*\(realPath === path \? ReloadOutlined : ArrowRightOutlined\)/)
  assert.match(source, /onPressEnter=\{e => props\.onGoto\(type,\s*e\)\}/)
  assert.match(source, /onClick=\{handleClick\}/)
  assert.match(source, /if \(!isLoadingRemote\) \{[\s\S]*onGoto\(type\)[\s\S]*\}/)
})

test('SFTP row labels expose existing side, file, metadata, and selection state', async () => {
  const { buildSftpRowAriaLabel } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/sftp-accessibility.js'
  )))
  const labels = {
    remote: 'Remote',
    local: 'Local',
    shellpilotSftpFolder: 'Folder',
    shellpilotSftpFile: 'File',
    shellpilotSftpParentDirectory: 'Parent directory',
    shellpilotSftpEmptyName: 'Unnamed item',
    shellpilotSftpSelected: 'Selected',
    shellpilotSftpNotSelected: 'Not selected'
  }
  const translate = key => labels[key] || key
  const properties = [{ id: 'name' }, { id: 'size' }, { id: 'modifyTime' }]
  const longName = 'very-long-production-audit-report-that-is-truncated.log'

  assert.equal(buildSftpRowAriaLabel({
    file: { name: longName, size: 2048, modifyTime: 1700000000 },
    type: 'remote',
    selected: true,
    properties,
    translate,
    formatSize: value => `${value / 1024} KB`,
    formatTime: value => `time:${value}`
  }), `Remote, ${longName}, File, 2 KB, time:1700000000, Selected`)

  assert.equal(buildSftpRowAriaLabel({
    file: { name: 'logs', isDirectory: true, size: 0, modifyTime: 1700000001 },
    type: 'local',
    selected: false,
    properties,
    translate,
    formatSize: String,
    formatTime: value => `time:${value}`
  }), 'Local, logs, Folder, time:1700000001, Not selected')

  assert.equal(buildSftpRowAriaLabel({
    file: { name: '..', isDirectory: true, isParent: true },
    type: 'remote',
    selected: false,
    properties: [{ id: 'name' }],
    translate
  }), 'Remote, .., Parent directory, Not selected')
})

test('SFTP grid, header, and rows expose a single delegated accessibility model', () => {
  const table = readClientSource('list-table-ui.jsx')
  const header = readClientSource('file-table-header.jsx')
  const row = readClientSource('file-item.jsx')

  assert.match(table, /role='grid'/)
  assert.match(table, /aria-rowcount=\{rowCount\}/)
  assert.match(header, /role='row'/)
  assert.match(header, /role='columnheader'/)
  assert.match(row, /role='row'/)
  assert.match(row, /aria-rowindex=\{rowIndex\}/)
  assert.match(row, /aria-selected=\{selected\}/)
  assert.match(row, /aria-label=\{ariaLabel\}/)
  assert.match(row, /tabIndex=\{isRovingTabStop \? 0 : -1\}/)
  assert.match(row, /!file\.isEmpty[\s\S]*isRovingTabStop/)
  assert.match(row, /lastClickedFile[\s\S]*activeSelectedId[\s\S]*id === activeSelectedId/)
  assert.match(row, /renderEditing[\s\S]*role='row'[\s\S]*role='gridcell'/)
  assert.match(row, /className='file-bg' aria-hidden='true'/)
  assert.match(row, /title: file\.name/)
  assert.match(row, /handleRowKeyDown/)
})
