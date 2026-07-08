const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('AI chat submit only opens config when a non-empty prompt is missing required config', async () => {
  const {
    getAIChatSubmitAction
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-submit.js')))

  assert.equal(getAIChatSubmitAction({
    prompt: '',
    config: {}
  }), 'noop')

  assert.equal(getAIChatSubmitAction({
    prompt: 'explain current terminal output',
    config: {
      baseURLAI: 'https://api.example.com/v1',
      modelAI: 'deepseek-chat',
      roleAI: 'SSH assistant'
    }
  }), 'submit')

  assert.equal(getAIChatSubmitAction({
    prompt: 'explain current terminal output',
    config: {
      baseURLAI: '',
      modelAI: 'deepseek-chat',
      roleAI: 'SSH assistant'
    }
  }), 'open-config')
})
