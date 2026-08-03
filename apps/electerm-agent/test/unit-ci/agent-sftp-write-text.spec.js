const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const policyUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-policy.js')).href

test('treats structured remote text writes as a confirmed state change', async () => {
  const { classifyAgentCall, getAgentToolDescriptor } = await import(policyUrl)
  const result = classifyAgentCall({
    descriptor: getAgentToolDescriptor('sftp_write_text'),
    args: { remotePath: '/etc/example.conf', content: 'enabled=true' }
  })

  assert.equal(result.outcome, 'risky')
  assert.equal(result.reasonCode, 'STRUCTURED_STATE_CHANGE')
})

test('routes Agent text writes through the SFTP transaction-backed store API', () => {
  const catalogSource = fs.readFileSync(path.join(aiRoot, 'agent-tool-catalog.js'), 'utf8')
  const executionSource = fs.readFileSync(path.join(aiRoot, 'agent-tool-execution.js'), 'utf8')
  const storeSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/store/mcp-handler.js'
  ), 'utf8')

  assert.match(catalogSource, /name:\s*'sftp_write_text'/)
  assert.match(executionSource, /case 'sftp_write_text':[\s\S]*mcpSftpWriteText/)
  assert.match(storeSource, /Store\.prototype\.mcpSftpWriteText/)
  assert.match(storeSource, /isSingleRemotePath\(remotePath\)/)
  assert.match(storeSource, /saveRemoteEditorFile|executePreparedRemoteEditorSave/)
})
