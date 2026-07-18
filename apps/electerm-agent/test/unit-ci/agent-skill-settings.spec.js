const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../', relativePath),
    'utf8'
  )
}

test('AI settings persistence retains legacy Skills until repository migration accounts for them', () => {
  const source = readSource('src/client/components/ai/ai-config-props.js')

  assert.match(source, /'agentSkills'/)
})

test('AI settings form delegates user Skill operations to the local manager', () => {
  const source = readSource('src/client/components/ai/ai-config.jsx')

  assert.doesNotMatch(source, /Form\.List\s+name=['"]agentSkills['"]/)
  assert.match(source, /AgentSkillManagerModal/)
  assert.match(source, /shellpilotSkillManageCount/)
})
