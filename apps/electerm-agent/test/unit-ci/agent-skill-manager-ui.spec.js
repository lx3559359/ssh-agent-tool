const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

test('AI settings opens a local Skill manager instead of editing prompt rows inline', () => {
  const config = source('src/client/components/ai/ai-config.jsx')

  assert.doesNotMatch(config, /Form\.List\s+name=['"]agentSkills['"]/)
  assert.match(config, /AgentSkillManagerModal/)
  assert.match(config, /shellpilotSkillManageCount/)
})

test('Skill manager keeps imports disabled and exposes the complete lifecycle', () => {
  const manager = source('src/client/components/ai/agent-skill-manager-modal.jsx')

  assert.match(manager, /shellpilotSkillEmpty/)
  assert.match(manager, /shellpilotSkillDisabledDraft/)
  for (const operation of [
    'importAgentSkill',
    'validateAgentSkillDraft',
    'enableAgentSkillDraft',
    'disableAgentSkill',
    'rollbackAgentSkill',
    'removeAgentSkill'
  ]) {
    assert.match(manager, new RegExp(operation))
  }
  assert.match(manager, /Modal\.confirm/)
  assert.match(manager, /validation\.valid/)
  assert.match(manager, /validation\.packageDigest/)
  assert.match(manager, /getFilePath\(file\)/)
})

test('Skill editor shows the full file plus permission, risk, and validation evidence', () => {
  const editor = source('src/client/components/ai/agent-skill-editor.jsx')

  assert.match(editor, /<Tree/)
  assert.match(editor, /readAgentSkillFile/)
  assert.match(editor, /updateAgentSkillDraftFile/)
  assert.match(editor, /requestedPermissions/)
  assert.match(editor, /riskSummary/)
  assert.match(editor, /errors/)
  assert.match(editor, /warnings/)
  assert.match(editor, /aria-live='polite'/)
})

test('Skill manager is a bounded secondary surface and does not change the main columns', () => {
  const manager = source('src/client/components/ai/agent-skill-manager-modal.jsx')
  const styles = source('src/client/components/ai/agent-skill-manager.styl')

  assert.match(manager, /<Modal/)
  assert.match(styles, /\.agent-skill-manager/)
  assert.match(styles, /max-height/)
  assert.match(styles, /overflow/)
  assert.match(styles, /@media \(max-width: 820px\)/)
  assert.doesNotMatch(styles, /position\s+fixed/)
})
