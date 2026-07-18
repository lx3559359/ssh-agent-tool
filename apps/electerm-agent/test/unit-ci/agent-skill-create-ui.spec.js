const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

test('conversational creator exposes requirements, progress, review, and revision actions', () => {
  const modal = source('src/client/components/ai/agent-skill-create-modal.jsx')
  const review = source('src/client/components/ai/agent-skill-draft-review.jsx')

  assert.match(modal, /createAgentSkillCreatorController/)
  assert.match(modal, /requirements/)
  assert.match(modal, /conversation/)
  assert.match(modal, /gathering|generating|validating/)
  assert.match(modal, /shellpilotSkillContinueConversation/)
  assert.match(modal, /shellpilotSkillManualEdit/)
  assert.match(modal, /shellpilotSkillSaveDraftOnly/)
  assert.match(modal, /shellpilotSkillSaveAndEnable/)
  assert.match(review, /AgentSkillEditor/)
  assert.match(review, /fileDigests/)
  assert.match(review, /requestedPermissions/)
  assert.match(review, /riskSummary/)
  assert.match(review, /errors/)
  assert.match(review, /warnings/)
})

test('save and enable requires a fresh matching validation digest', () => {
  const modal = source('src/client/components/ai/agent-skill-create-modal.jsx')

  assert.match(modal, /validateAgentSkillDraft/)
  assert.match(modal, /validation\.valid/)
  assert.match(modal, /validation\.packageDigest === draft\.packageDigest/)
  assert.match(modal, /enableAgentSkillDraft/)
  assert.match(modal, /setValidation\(null\)/)
})

test('creator and review use accessible bounded modal regions without another main column', () => {
  const modal = source('src/client/components/ai/agent-skill-create-modal.jsx')
  const review = source('src/client/components/ai/agent-skill-draft-review.jsx')
  const styles = source('src/client/components/ai/agent-skill-manager.styl')

  assert.match(modal, /<Modal/)
  assert.match(modal, /aria-live='polite'/)
  assert.match(modal, /aria-label/)
  assert.match(review, /aria-live='polite'/)
  assert.match(styles, /\.agent-skill-create-modal/)
  assert.match(styles, /max-height/)
  assert.match(styles, /overflow-y auto/)
  assert.match(styles, /@media \(max-width: 820px\)/)
})
