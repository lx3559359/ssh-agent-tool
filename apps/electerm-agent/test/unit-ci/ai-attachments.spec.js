const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const attachmentsUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-attachments.js')
).href

test('AI attachments parse SFTP drop payloads into file attachments', async () => {
  const {
    parseSftpDropPayload
  } = await import(attachmentsUrl)

  const attachments = parseSftpDropPayload(JSON.stringify([
    {
      name: 'error.log',
      path: '/var/log',
      type: 'remote',
      size: 12,
      isDirectory: false
    },
    {
      name: 'logs',
      path: '/var',
      type: 'remote',
      isDirectory: true
    }
  ]))

  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].source, 'sftp')
  assert.equal(attachments[0].name, 'error.log')
  assert.equal(attachments[0].file.path, '/var/log')
})

test('AI attachments build bounded context for local and SFTP files', async () => {
  const {
    buildAttachmentContextPrompt
  } = await import(attachmentsUrl)

  const prompt = await buildAttachmentContextPrompt({
    attachments: [
      {
        id: 'local-1',
        source: 'local',
        name: 'app.log',
        path: 'C:/tmp/app.log',
        size: 10
      },
      {
        id: 'sftp-1',
        source: 'sftp',
        name: 'error.log',
        file: {
          name: 'error.log',
          path: '/var/log',
          type: 'remote',
          size: 20,
          isDirectory: false
        }
      }
    ],
    fsApi: {
      readFilePreview: async filePath => ({
        content: `local:${filePath}`,
        binary: false,
        truncated: false,
        bytesRead: 20
      })
    },
    sftpRef: {
      sftp: {
        readFilePreview: async filePath => ({
          content: `remote:${filePath}`,
          binary: false,
          truncated: false,
          bytesRead: 30
        })
      }
    }
  })

  assert.match(prompt, /app\.log/)
  assert.match(prompt, /local:C:\/tmp\/app\.log/)
  assert.match(prompt, /error\.log/)
  assert.match(prompt, /remote:\/var\/log\/error\.log/)
})

test('AI attachments explain continuation and archive member context', async () => {
  const {
    buildAttachmentContextPrompt
  } = await import(attachmentsUrl)

  const prompt = await buildAttachmentContextPrompt({
    attachments: [
      {
        id: 'archive-1',
        source: 'sftp',
        name: 'logs.tar.gz',
        file: {
          name: 'logs.tar.gz',
          path: '/tmp',
          type: 'remote',
          size: 4096,
          isDirectory: false
        }
      }
    ],
    sftpRef: {
      sftp: {
        listArchive: async filePath => ({
          type: 'tar.gz',
          entries: [
            { path: 'nginx/error.log', size: 2048 }
          ],
          filePath
        }),
        readArchiveTextEntry: async (filePath, entryPath) => ({
          archiveType: 'tar.gz',
          entryPath,
          content: 'nginx bind failed',
          binary: false,
          bytesRead: 16,
          hasMore: true,
          nextOffset: 16
        })
      }
    }
  })

  assert.match(prompt, /压缩/)
  assert.match(prompt, /logs\.tar\.gz#nginx\/error\.log/)
  assert.match(prompt, /nginx bind failed/)
  assert.match(prompt, /继续读取/)
})

test('AI chat component wires local paste drag and SFTP drop attachment UI', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )

  assert.match(source, /attachmentQueue/)
  assert.match(source, /handlePickLocalAttachments/)
  assert.match(source, /handlePasteAttachments/)
  assert.match(source, /handleDropAttachments/)
  assert.match(source, /type='file'/)
  assert.match(source, /buildAttachmentContextPrompt/)
  assert.match(source, /parseSftpDropPayload/)
})
