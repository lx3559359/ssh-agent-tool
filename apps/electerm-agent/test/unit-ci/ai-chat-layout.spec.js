const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('AI chat history keeps a stable scroll container when history is empty', () => {
  const source = read('src/client/components/ai/ai-chat-history.jsx')

  assert.match(source, /className='ai-history-wrap ai-history-empty'/)
  assert.doesNotMatch(source, /return <div \/>/)
})

test('AI chat layout lets history scroll while the input remains fixed at the bottom', () => {
  const style = read('src/client/components/ai/ai.styl')

  assert.match(style, /\.ai-chat-history[\s\S]*?display flex/)
  assert.match(style, /\.ai-chat-history[\s\S]*?overflow hidden/)
  assert.match(style, /\.ai-history-wrap[\s\S]*?overflow-y auto/)
  assert.match(style, /\.ai-chat-input[\s\S]*?flex 0 0 auto/)
})
