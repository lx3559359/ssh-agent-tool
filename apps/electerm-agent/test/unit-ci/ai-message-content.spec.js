const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeAIMessageRequestContent,
  normalizeAIRequestMessages,
  getAIMessageText
} = require('../../src/app/lib/ai-content/message-content')

test('keeps bounded text and trusted image parts in AI requests', () => {
  const imageUrl = `data:image/png;base64,${Buffer.from('image').toString('base64')}`
  const content = normalizeAIMessageRequestContent([
    { type: 'text', text: '请分析截图' },
    {
      type: 'image_url',
      image_url: {
        url: imageUrl,
        detail: 'high'
      }
    },
    {
      type: 'image_url',
      image_url: {
        url: 'https://example.com/untrusted.png'
      }
    },
    { type: 'unknown', value: 'ignored' }
  ])

  assert.deepEqual(content, [
    { type: 'text', text: '请分析截图' },
    {
      type: 'image_url',
      image_url: {
        url: imageUrl,
        detail: 'high'
      }
    }
  ])
  assert.equal(getAIMessageText(content), '请分析截图')
})

test('filters invalid roles and empty messages', () => {
  const messages = normalizeAIRequestMessages([
    { role: 'user', content: '检查服务器' },
    { role: 'invalid', content: 'ignored' },
    { role: 'assistant', content: '' },
    { role: 'tool', tool_call_id: 'call-1', content: '' }
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[1].tool_call_id, 'call-1')
})
