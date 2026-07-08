const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-favorite.js')
).href

test('bookmark favorite helper toggles a stable favorite boolean without dropping fields', async () => {
  const {
    isBookmarkFavorite,
    toggleBookmarkFavorite
  } = await import(moduleUrl)

  const bookmark = {
    id: 'server-1',
    title: 'prod-web-01',
    host: '10.0.1.23',
    username: 'root',
    tags: ['prod']
  }

  const favorite = toggleBookmarkFavorite(bookmark)
  assert.equal(isBookmarkFavorite(favorite), true)
  assert.equal(favorite.favorite, true)
  assert.equal(favorite.id, bookmark.id)
  assert.equal(favorite.host, bookmark.host)
  assert.deepEqual(favorite.tags, bookmark.tags)

  const normal = toggleBookmarkFavorite(favorite)
  assert.equal(isBookmarkFavorite(normal), false)
  assert.equal(normal.favorite, false)
})

test('bookmark tree exposes favorite controls and persists through editItem', () => {
  const opSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-item-op.jsx'),
    'utf8'
  )
  const rowSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-list-row.jsx'),
    'utf8'
  )
  const listSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-list.jsx'),
    'utf8'
  )

  assert.match(opSource, /StarFilled/)
  assert.match(opSource, /StarOutlined/)
  assert.match(opSource, /toggleFavorite/)
  assert.match(rowSource, /toggleFavorite=\{toggleFavorite\}/)
  assert.match(listSource, /toggleFavorite\s*=/)
  assert.match(listSource, /editItem\(item\.id,\s*\{\s*favorite:/)
})
