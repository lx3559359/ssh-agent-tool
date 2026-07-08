const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readSftpSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp', relativePath),
    'utf8'
  )
}

test('sftp file item refresh reloads the active side list', () => {
  const source = readSftpSource('file-item.jsx')
  const start = source.indexOf('refresh = () => {')
  const end = source.indexOf('shouldShowSelectedMenu = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /this\.props\.onGoto\(this\.props\.file\.type\)/)
})

test('sftp address bar shows reload when path is unchanged and jump when edited', () => {
  const source = readSftpSource('address-bar.jsx')

  assert.match(
    source,
    /const GoIcon = isLoadingRemote\s*\?[\s\S]*LoadingOutlined[\s\S]*:\s*\(realPath === path \? ReloadOutlined : ArrowRightOutlined\)/
  )
  assert.match(source, /onPressEnter=\{e => props\.onGoto\(type,\s*e\)\}/)
  assert.match(source, /onClick=\{handleClick\}/)
})

test('sftp onGoto refreshes current local or remote path through the list loader', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('onGoto = async (type, e) => {')
  const end = source.indexOf('goParent = (type) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /e && e\.preventDefault\(\)/)
  assert.match(body, /const oldPath = this\.state\[type \+ 'Path'\]/)
  assert.match(body, /let np = await this\.parsePath\(type,\s*this\.state\[nt\]\)/)
  assert.match(body, /np = normalizeRemotePath\(np\)/)
  assert.match(body, /this\.setState\(\{[\s\S]*\[n\]: np[\s\S]*\[nt\]: np[\s\S]*\}/)
  assert.match(body, /this\[`\$\{type\}List`\]\(undefined,\s*undefined,\s*oldPath\)/)
})

test('sftp history click updates path temp and reloads that side', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('onClickHistory = (type, path) => {')
  const end = source.indexOf('handleReloadRemoteSftp = async () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const oldPath = this\.state\[type \+ 'Path'\]/)
  assert.match(body, /\[n\]: path/)
  assert.match(body, /\[`\$\{n\}Temp`\]: path/)
  assert.match(body, /this\[`\$\{type\}List`\]\(undefined,\s*undefined,\s*oldPath\)/)
})
