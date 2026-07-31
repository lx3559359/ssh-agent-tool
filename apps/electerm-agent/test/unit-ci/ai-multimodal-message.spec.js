const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('AI request preserves bounded multimodal content arrays', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'app',
    'lib',
    'ai.js'
  ), 'utf8')
  assert.match(source, /normalizeAIMessageRequestContent/)
  assert.doesNotMatch(
    source,
    /content:\s*String\(message\.content\)/
  )
})

test('chat attachments use trusted ingestion and expose URL input', () => {
  const attachments = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'ai',
    'ai-attachments.js'
  ), 'utf8')
  const chat = fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'src',
    'client',
    'components',
    'ai',
    'ai-chat.jsx'
  ), 'utf8')
  assert.match(attachments, /ingestAIContent/)
  assert.match(chat, /shellpilotAiReadWebUrl/)
  assert.match(chat, /aiContentParts/)
})
