const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('bookmark upload guard reports invalid backup files and restores watchers', async () => {
  const watcherEvents = []
  const messages = []
  const {
    runBookmarkUploadWithWatchers
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-upload-guard.js')))

  const result = await runBookmarkUploadWithWatchers({
    file: { fileContent: '{bad json' },
    upload: async () => {
      throw new Error('备份文件内容不是有效的 JSON')
    },
    watchers: [
      {
        stop: () => watcherEvents.push('bookmarks:stop'),
        start: () => watcherEvents.push('bookmarks:start')
      },
      {
        stop: () => watcherEvents.push('bookmarkGroups:stop'),
        start: () => watcherEvents.push('bookmarkGroups:start')
      }
    ],
    showError: (content) => messages.push(content),
    waitAfterUpload: async () => {}
  })

  assert.equal(result, false)
  assert.deepEqual(watcherEvents, [
    'bookmarks:stop',
    'bookmarkGroups:stop',
    'bookmarks:start',
    'bookmarkGroups:start'
  ])
  assert.deepEqual(messages, ['备份文件内容不是有效的 JSON'])
})
