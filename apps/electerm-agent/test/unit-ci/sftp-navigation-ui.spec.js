const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

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

test('sftp address bar supports Enter navigation and reload-or-jump button actions', () => {
  const source = readClientSource('address-bar.jsx')

  assert.match(source, /const GoIcon = isLoadingRemote\s*\?[\s\S]*LoadingOutlined[\s\S]*:\s*\(realPath === path \? ReloadOutlined : ArrowRightOutlined\)/)
  assert.match(source, /onPressEnter=\{e => props\.onGoto\(type,\s*e\)\}/)
  assert.match(source, /onClick=\{handleClick\}/)
  assert.match(source, /if \(!isLoadingRemote\) \{[\s\S]*onGoto\(type\)[\s\S]*\}/)
})
