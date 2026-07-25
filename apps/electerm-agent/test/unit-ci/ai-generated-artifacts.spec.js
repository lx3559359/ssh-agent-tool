const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-generated-artifacts.js'
)).href

test('extracts bounded ShellPilot file blocks and strips them from the chat body', async () => {
  const {
    extractAIGeneratedArtifacts,
    stripAIGeneratedArtifactBlocks
  } = await import(moduleUrl)
  const response = [
    '这是说明。',
    '<shellpilot-file name="巡检报告.html" format="html"><h1>报告</h1></shellpilot-file>'
  ].join('\n')

  const files = extractAIGeneratedArtifacts(response)
  assert.equal(files.length, 1)
  assert.equal(files[0].filename, '巡检报告.html')
  assert.equal(files[0].format, 'html')
  assert.equal(files[0].content, '<h1>报告</h1>')
  assert.equal(stripAIGeneratedArtifactBlocks(response).trim(), '这是说明。')
})

test('builds safe response exports and converts a Markdown table to CSV', async () => {
  const { buildAIResponseExports } = await import(moduleUrl)
  const response = '| 服务 | 状态 |\n| --- | --- |\n| nginx | 正常 |'
  const exports = buildAIResponseExports(response, { filenameStem: '巡检结果' })

  assert.equal(exports.markdown.filename, '巡检结果.md')
  assert.equal(exports.csv.content, '服务,状态\nnginx,正常\n')
  assert.match(exports.html.content, /<!doctype html>/i)
  assert.equal(JSON.parse(exports.json.content).content, response)
})
