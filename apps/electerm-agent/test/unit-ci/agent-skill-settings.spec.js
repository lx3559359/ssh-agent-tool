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

test('AI settings persistence includes custom Agent Skills', () => {
  const source = readSource('src/client/components/ai/ai-config-props.js')

  assert.match(source, /'agentSkills'/)
})

test('AI settings form exposes custom Agent Skill management fields', () => {
  const source = readSource('src/client/components/ai/ai-config.jsx')

  assert.match(source, /Form\.List\s+name=['"]agentSkills['"]/)
  assert.match(source, /name:\s*'id'/)
  assert.match(source, /name:\s*'title'/)
  assert.match(source, /name:\s*'description'/)
  assert.match(source, /name=\{\[name,\s*'prompt'\]\}/)
  assert.match(source, /name=\{\[name,\s*'disabled'\]\}/)
  assert.match(source, /e\('shellpilotAiAddSkill'\)/)
  assert.match(source, /e\('shellpilotDelete'\)/)
})
