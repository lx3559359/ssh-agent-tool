const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-skills.js')
).href

test('Agent skill registry exposes built-in SSH troubleshooting skills', async () => {
  const {
    getBuiltInAgentSkills,
    buildAgentSkillPrompt
  } = await import(moduleUrl)

  const skills = getBuiltInAgentSkills()
  const ids = skills.map(skill => skill.id)

  assert.ok(ids.includes('linux-health'))
  assert.ok(ids.includes('nginx-troubleshooting'))
  assert.ok(ids.includes('docker-troubleshooting'))
  assert.ok(ids.includes('disk-cleanup'))
  assert.equal(skills.every(skill => skill.title && skill.prompt), true)

  const prompt = buildAgentSkillPrompt()
  assert.match(prompt, /Skill/)
  assert.match(prompt, /linux-health/)
  assert.match(prompt, /nginx-troubleshooting/)
  assert.match(prompt, /docker-troubleshooting/)
  assert.match(prompt, /disk-cleanup/)
})

test('Agent skill registry merges custom skills and filters invalid entries', async () => {
  const {
    getAgentSkills,
    buildAgentSkillPrompt
  } = await import(moduleUrl)

  const customSkills = [
    {
      id: 'custom-redis',
      title: 'Redis 排查',
      description: '检查 Redis 连接、慢查询和内存。',
      prompt: '优先查看 redis-cli info、slowlog 和连接数。'
    },
    {
      id: 'disabled-skill',
      title: '禁用技能',
      prompt: '不应该出现',
      disabled: true
    },
    {
      id: 'missing-prompt',
      title: '无提示技能'
    }
  ]

  const skills = getAgentSkills({ customSkills })
  const ids = skills.map(skill => skill.id)

  assert.ok(ids.includes('linux-health'))
  assert.ok(ids.includes('custom-redis'))
  assert.equal(ids.includes('disabled-skill'), false)
  assert.equal(ids.includes('missing-prompt'), false)

  const prompt = buildAgentSkillPrompt({ customSkills })
  assert.match(prompt, /custom-redis/)
  assert.match(prompt, /Redis 排查/)
  assert.match(prompt, /redis-cli info/)
  assert.doesNotMatch(prompt, /不应该出现/)
})

test('Agent system prompt includes the skill framework hook', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(source, /buildAgentSkillPrompt/)
  assert.match(source, /agentSkills/)
})
