const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readSource (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('artifact export actions use native save and the exact active SSH endpoint', () => {
  const source = readSource(
    'src/client/components/artifacts/artifact-export-actions.js'
  )
  const client = readSource(
    'src/client/components/artifacts/artifact-client.js'
  )

  assert.match(source, /saveArtifactFile/)
  assert.match(source, /prepareArtifactUploadSource/)
  assert.match(client, /prepareAIArtifactUploadSource/)
  assert.match(source, /getCurrentOperationsEndpoint/)
  assert.match(source, /mcpSftpUpload/)
  assert.match(source, /tabId:\s*endpoint\.tabId/)
  assert.match(source, /当前没有可用的 SSH 会话/)
})

test('main process prepares uploads only from generated repository files', () => {
  const source = readSource('src/app/lib/ipc.js')

  assert.match(source, /prepareAIArtifactUploadSource/)
  assert.match(source, /shellpilot-artifact-upload/)
  assert.match(source, /saveAIArtifactFileToTrustedPath/)
  assert.doesNotMatch(
    source,
    /prepareAIArtifactUploadSource:[\s\S]{0,1200}sourcePath/
  )
})
