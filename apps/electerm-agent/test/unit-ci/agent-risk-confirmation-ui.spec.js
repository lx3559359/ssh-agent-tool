const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('risk confirmation modal renders every required authorization detail', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/agent-risk-confirmation-modal.jsx'
  ), 'utf8')

  for (const token of [
    'targetIdentity',
    'purpose',
    'fullCommands',
    'scriptEntries',
    'skillArtifacts',
    'affectedObjects',
    'worstCase',
    'resourceImpact',
    'disconnectPossible',
    'recovery',
    'rollbackLimits',
    'verification',
    'cancellationBehavior'
  ]) {
    assert.match(source, new RegExp(token))
  }
  assert.match(source, /unknown/)
  assert.match(source, /maskClosable:\s*false/)
  assert.match(source, /signal.*abort|addEventListener\('abort'/s)
  assert.match(source, /shellpilotAgentRiskRecoveryNotReady/)
  assert.match(source, /shellpilotAgentRiskConfirmExecute/)
  assert.match(source, /shellpilotAgentRiskNoExtraVerification/)
})
