const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
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
      baseURLAI: 'https://api.example.com/v1',
      modelAI: 'deepseek-chat',
      roleAI: ''
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

test('AI terminal context submit passes the generated prompt directly instead of relying on stale React state', () => {
  const aiChatSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )
  const storeCommonSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/common.js'),
    'utf8'
  )

  assert.match(
    aiChatSource,
    /function\s*\(\s*submitPromptOverride\s*\)/
  )
  assert.match(
    aiChatSource,
    /let\s+submitPrompt\s*=\s*typeof\s+submitPromptOverride\s*===\s*'string'\s*\?\s*submitPromptOverride\s*:\s*prompt/
  )
  assert.match(
    aiChatSource,
    /shouldAutoAttachSelectedSftpFileContext\(submitPrompt\)/
  )
  assert.match(
    storeCommonSource,
    /refsStatic\.get\('AIChat'\)\?\.handleSubmit\(prompt\)/
  )
})
