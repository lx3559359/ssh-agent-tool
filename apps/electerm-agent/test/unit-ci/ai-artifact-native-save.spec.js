const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('native artifact save keeps local paths in the main process', () => {
  const ipc = read('src/app/lib/ipc.js')
  const client = read('src/client/components/artifacts/artifact-client.js')

  assert.match(ipc, /saveAIArtifactFile/)
  assert.match(ipc, /dialog\.showSaveDialog/)
  assert.match(ipc, /saveAIArtifactFileToTrustedPath/)
  assert.match(ipc, /shell\.openPath/)
  assert.doesNotMatch(client, /destination/)
  assert.doesNotMatch(client, /filePath/)
})

test('trusted export is isolated from the renderer-facing export method', () => {
  const service = read('src/app/lib/ai-artifacts/artifact-service.js')
  const repository = read('src/app/lib/ai-artifacts/artifact-repository.js')

  assert.match(service, /saveAIArtifactFileToTrustedPath/)
  assert.match(repository, /exportGeneratedFileToTrustedPath/)
  assert.match(repository, /path\.isAbsolute/)
  assert.match(service, /validateArtifactDestination/)
})
