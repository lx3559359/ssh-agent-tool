const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-creator-prompt.js'
)).href

test('creator system prompt gathers the complete workflow contract', async () => {
  const {
    AGENT_SKILL_CREATOR_SYSTEM_PROMPT,
    buildAgentSkillCreatorPrompt
  } = await import(moduleUrl)
  const prompt = `${AGENT_SKILL_CREATOR_SYSTEM_PROMPT}\n${buildAgentSkillCreatorPrompt({
    requirements: 'Inspect a web service'
  })}`

  for (const phrase of [
    'trigger conditions',
    'inputs',
    'supported platforms',
    'ordered steps',
    'tools',
    'requested permissions',
    'prechecks',
    'success verification',
    'risk'
  ]) assert.match(prompt, new RegExp(phrase, 'i'))
})

test('creator prompt forbids execution, automatic enablement, credentials, and policy overrides', async () => {
  const { AGENT_SKILL_CREATOR_SYSTEM_PROMPT } = await import(moduleUrl)

  assert.match(AGENT_SKILL_CREATOR_SYSTEM_PROMPT, /must not execute/i)
  assert.match(AGENT_SKILL_CREATOR_SYSTEM_PROMPT, /must not enable/i)
  assert.match(AGENT_SKILL_CREATOR_SYSTEM_PROMPT, /credential/i)
  assert.match(AGENT_SKILL_CREATOR_SYSTEM_PROMPT, /cannot override.*safety/i)
  assert.match(AGENT_SKILL_CREATOR_SYSTEM_PROMPT, /one JSON object/i)
})
