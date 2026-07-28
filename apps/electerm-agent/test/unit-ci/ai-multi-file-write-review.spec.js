const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('Agent exposes a dedicated reviewed multi-file SFTP write tool', () => {
  const tools = source('src/client/components/ai/agent-tools.js')
  const policy = source('src/client/components/ai/agent-tool-policy.js')
  const scopes = source('src/client/components/ai/agent-tool-scopes.js')
  const runtime = source('src/client/components/ai/agent-runtime-context.js')

  assert.match(tools, /name:\s*'sftp_write_text_batch'/)
  assert.match(tools, /mcpSftpWriteTextBatch/)
  assert.match(policy, /'sftp_write_text_batch'/)
  assert.match(scopes, /sftp_write_text_batch:\s*'session-write'/)
  assert.match(runtime, /'sftp_write_text_batch'/)
})

test('multi-file writes review all files before any execution', () => {
  const entry = source('src/client/components/sftp/sftp-entry.jsx')
  const reviewIndex = entry.indexOf('requestAiFileChangeReview')
  const validationIndex = entry.indexOf('validatePrepared', reviewIndex)
  const executeIndex = entry.indexOf('sftpSafetyRunner.execute', validationIndex)

  assert.ok(reviewIndex > -1)
  assert.ok(validationIndex > reviewIndex)
  assert.ok(executeIndex > validationIndex)
  assert.match(entry, /saveRemoteEditorFiles\s*=/)
  assert.match(entry, /AI_FILE_CHANGED_SINCE_REVIEW/)
})

test('the review modal provides file selection and a unified diff preview', () => {
  const modal = source(
    'src/client/components/ai/ai-file-change-review-modal.jsx'
  )

  assert.match(modal, /type='checkbox'/)
  assert.match(modal, /ai-file-change-review-list/)
  assert.match(modal, /ai-file-change-review-diff/)
  assert.match(modal, /创建恢复点并执行/)
})
