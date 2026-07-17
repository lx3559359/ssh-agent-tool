const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ipcSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/app/lib/ipc.js'),
  'utf8'
)
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/client/components/ai/agent-skill-client.js'),
  'utf8'
)

const expectedMethods = [
  'listAgentSkills',
  'getAgentSkillMetadata',
  'readAgentSkillFile',
  'createAgentSkillDraft',
  'updateAgentSkillDraftFile',
  'validateAgentSkillDraft',
  'enableAgentSkillDraft',
  'disableAgentSkill',
  'rollbackAgentSkill',
  'removeAgentSkill',
  'importAgentSkill'
]

test('registers the exact dedicated Agent Skill async IPC methods', () => {
  const block = ipcSource.match(/const agentSkillAsyncGlobals = \{([\s\S]*?)\n {2}\}/)
  assert.ok(block, 'dedicated Agent Skill IPC block is required')
  const names = [...block[1].matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]+):/gm)].map(match => match[1])
  assert.deepEqual(names, expectedMethods)
  assert.match(ipcSource, /path\.resolve\(appPath, 'agent-skills'\)/)
  assert.doesNotMatch(block[1], /rootPath|repositoryRoot|readFileSync|exec|spawn|shell/)
})

test('renderer client exposes fixed operations without a filesystem-root parameter', () => {
  for (const name of expectedMethods) {
    assert.match(clientSource, new RegExp(`runAgentSkillCall\\('${name}'`))
  }
  assert.doesNotMatch(clientSource, /rootPath|repositoryRoot|runGlobalAsync\(name/)
  assert.match(clientSource, /SKILL_IPC_ERROR/)
})

test('repository and IPC only resolve package-relative file reads', () => {
  const repositorySource = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/agent-skill-repository.js'),
    'utf8'
  )
  assert.match(repositorySource, /normalizeSkillRelativePath\(relativePath\)/)
  assert.match(repositorySource, /resolveSkillEntry\(found\.directory, safePath\)/)
  assert.doesNotMatch(ipcSource, /readAgentSkillFile:\s*\([^)]*root/)
})
