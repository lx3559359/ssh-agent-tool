const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/agent-pagination.js'
)).href
const runtimeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-runtime-context.js'
)).href

test('paginates deterministic Agent lists with usable continuation cursors', async () => {
  const { paginateAgentList } = await import(moduleUrl)
  const values = Array.from({ length: 250 }, (_, index) => ({ name: `file-${index}` }))
  const first = paginateAgentList(values, { limit: 100 })
  assert.equal(first.items.length, 100)
  assert.equal(first.nextCursor, '100')
  const second = paginateAgentList(values, { cursor: first.nextCursor, limit: 100 })
  assert.equal(second.items[0].name, 'file-100')
  assert.equal(second.nextCursor, '200')
})

test('keeps a page below the model-safe JSON byte budget', async () => {
  const { paginateAgentList } = await import(moduleUrl)
  const values = Array.from({ length: 20 }, (_, index) => ({
    name: `file-${index}`,
    detail: 'x'.repeat(2048)
  }))
  const page = paginateAgentList(values, { maxBytes: 8 * 1024, limit: 200 })
  assert.ok(page.items.length > 0)
  assert.ok(Buffer.byteLength(JSON.stringify(page.items)) <= 8 * 1024)
  assert.ok(page.nextCursor)
})

test('pagination cursor survives retained context while older groups are omitted', async () => {
  const { buildAgentContextWindow } = await import(runtimeUrl)
  const runtimeMessages = []
  for (let index = 0; index < 30; index += 1) {
    const id = `page-${index}`
    runtimeMessages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id,
        function: { name: 'sftp_list', arguments: '{}' }
      }]
    }, {
      role: 'tool',
      tool_call_id: id,
      content: JSON.stringify({
        items: [{ name: `file-${index}`, detail: 'x'.repeat(4096) }],
        nextCursor: `cursor-${index}`
      })
    })
  }

  const context = buildAgentContextWindow(
    [{ role: 'system', content: 'system' }],
    runtimeMessages
  )

  assert.ok(context.omittedGroups > 0)
  const finalTool = context.messages.findLast(message => message.role === 'tool')
  assert.equal(JSON.parse(finalTool.content).nextCursor, 'cursor-29')
  assert.match(
    context.messages.find(message => /context window omitted/.test(message.content))
      .content,
    /Re-read paginated resources with their cursor/
  )
})
