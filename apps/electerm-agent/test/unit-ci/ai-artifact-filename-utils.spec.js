const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const {
  artifactFilename
} = require(path.join(
  root,
  'src/app/lib/ai-artifacts/filename-utils'
))

test('sanitizes control characters and Windows reserved filenames', () => {
  assert.equal(
    artifactFilename('巡检\u0000报告:生产', 'docx'),
    '巡检-报告-生产.docx'
  )
  assert.equal(artifactFilename('CON', 'pdf'), 'AI 成果物.pdf')
})

test('uses a readable Chinese fallback for empty titles', () => {
  assert.equal(artifactFilename('', 'xlsx'), 'AI 成果物.xlsx')
})
