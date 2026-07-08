const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-search.js')
).href

test('bookmark search matches server fields that are not always visible in the title', async () => {
  const {
    bookmarkMatchesKeyword
  } = await import(moduleUrl)

  const bookmark = {
    title: 'prod-web-01',
    host: '10.0.1.23',
    username: 'root',
    port: 22,
    description: 'nginx gateway',
    tags: ['生产环境', '核心业务']
  }

  assert.equal(bookmarkMatchesKeyword(bookmark, '10.0.1.23'), true)
  assert.equal(bookmarkMatchesKeyword(bookmark, 'root'), true)
  assert.equal(bookmarkMatchesKeyword(bookmark, 'nginx'), true)
  assert.equal(bookmarkMatchesKeyword(bookmark, '核心'), true)
  assert.equal(bookmarkMatchesKeyword(bookmark, 'missing'), false)
})

test('bookmark search matches group titles and descriptions', async () => {
  const {
    groupMatchesKeyword
  } = await import(moduleUrl)

  const group = {
    title: '生产环境',
    description: '核心服务器分组'
  }

  assert.equal(groupMatchesKeyword(group, '生产'), true)
  assert.equal(groupMatchesKeyword(group, '核心服务器'), true)
  assert.equal(groupMatchesKeyword(group, '测试环境'), false)
})

test('bookmark tree rows use the shared server search matcher', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-list-rows.js'),
    'utf8'
  )

  assert.match(source, /bookmarkMatchesKeyword\(item,\s*lowerKeyword\)/)
  assert.match(source, /groupMatchesKeyword\(group,\s*lowerKeyword\)/)
})
