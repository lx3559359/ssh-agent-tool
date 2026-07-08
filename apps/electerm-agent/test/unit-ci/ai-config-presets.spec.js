const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('AI config page exposes an xAI Grok provider preset for Chinese users', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'),
    'utf8'
  )

  assert.match(source, /label:\s*'xAI Grok'/)
  assert.match(source, /nameAI:\s*'xAI Grok'/)
  assert.match(source, /baseURLAI:\s*'https:\/\/api\.x\.ai\/v1'/)
  assert.match(source, /modelAI:\s*'grok-4\.5'/)
})
