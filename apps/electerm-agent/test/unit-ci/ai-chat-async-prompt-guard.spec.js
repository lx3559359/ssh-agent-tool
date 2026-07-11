const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('AI chat guards async submit and file quote prompt updates', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )
  const submitSource = source.slice(
    source.indexOf('const handleSubmit'),
    source.indexOf('function renderHistory')
  )
  const quoteSource = source.slice(
    source.indexOf('async function handleQuoteSftpFile'),
    source.indexOf('function handleQuoteMcpServers')
  )

  assert.match(submitSource, /const promptAtSubmit = prompt/)
  assert.match(submitSource, /setPrompt\(current =>\s*replacePromptIfUnchanged/)
  assert.match(quoteSource, /const promptAtStart = prompt/)
  assert.match(quoteSource, /setPrompt\(current =>\s*replacePromptIfUnchanged/)
})
