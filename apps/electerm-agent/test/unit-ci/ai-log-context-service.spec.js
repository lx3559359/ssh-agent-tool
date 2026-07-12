const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const serviceUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/log-context-service.js')
).href

test('AI log context formats chunk reads with continuation metadata', async () => {
  const {
    buildLogReadPrompt
  } = await import(serviceUrl)

  const prompt = buildLogReadPrompt({
    file: {
      path: '/var/log/nginx/error.log',
      source: '远程 SFTP'
    },
    range: {
      content: 'line 1\nline 2',
      offset: 0,
      nextOffset: 13,
      totalBytes: 2048,
      bytesRead: 13,
      hasMore: true
    }
  })

  assert.match(prompt, /\/var\/log\/nginx\/error\.log/)
  assert.match(prompt, /远程 SFTP/)
  assert.match(prompt, /0/)
  assert.match(prompt, /13/)
  assert.match(prompt, /继续读取/)
  assert.match(prompt, /line 1/)
})

test('AI log context formats keyword search matches', async () => {
  const {
    buildLogSearchPrompt
  } = await import(serviceUrl)

  const prompt = buildLogSearchPrompt({
    file: {
      path: '/var/log/app.log',
      source: '本地文件'
    },
    search: {
      query: 'timeout',
      matches: [
        {
          lineNumber: 120,
          line: 'upstream timeout',
          before: ['request started'],
          after: ['request failed']
        }
      ],
      scannedBytes: 4096,
      totalBytes: 8192,
      nextOffset: 4096,
      truncated: true
    }
  })

  assert.match(prompt, /timeout/)
  assert.match(prompt, /120/)
  assert.match(prompt, /upstream timeout/)
  assert.match(prompt, /继续搜索/)
})

test('AI log context formats compressed log archive entries and selected entry content', async () => {
  const {
    buildArchiveLogPrompt
  } = await import(serviceUrl)

  const prompt = buildArchiveLogPrompt({
    file: {
      path: '/tmp/logs.tar.gz',
      source: '远程 SFTP 压缩包'
    },
    archive: {
      type: 'tar.gz',
      entries: [
        { path: 'nginx/error.log', size: 1024 },
        { path: 'app/app.log', size: 2048 }
      ]
    },
    entry: {
      entryPath: 'nginx/error.log',
      content: 'bind failed',
      bytesRead: 11,
      hasMore: false
    }
  })

  assert.match(prompt, /logs\.tar\.gz/)
  assert.match(prompt, /tar\.gz/)
  assert.match(prompt, /nginx\/error\.log/)
  assert.match(prompt, /app\/app\.log/)
  assert.match(prompt, /bind failed/)
})
