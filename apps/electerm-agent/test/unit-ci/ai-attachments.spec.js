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

test('web attachments receive a stable logical read ID', async () => {
  const {
    createWebAttachment
  } = await import(attachmentsUrl)
  const attachment = createWebAttachment(
    'http://kb.internal/app#/sharingPath'
  )

  assert.equal(attachment.source, 'url')
  assert.equal(typeof attachment.readId, 'string')
  assert.ok(attachment.readId.length > 0)
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
        sourceTabId: 'tab-a',
        sourceSftpEndpoint: sftpEndpoint(),
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
    sftpRefs: {
      get: () => ({
        getSftpSafetyEndpoint: () => sftpEndpoint(),
        readRemoteFileContext: async file => ({
          ok: true,
          path: `${file.path}/${file.name}`,
          source: 'remote',
          content: `remote:${file.path}/${file.name}`,
          binary: false,
          truncated: false,
          bytesRead: 30
        })
      })
    }
  })

  assert.match(prompt, /app\.log/)
  assert.match(prompt, /local:C:\/tmp\/app\.log/)
  assert.match(prompt, /error\.log/)
  assert.match(prompt, /remote:\/var\/log\/error\.log/)
})

test('pathless browser text attachments use their File payload instead of a disk path', async () => {
  const {
    buildAttachmentAIContent,
    createLocalFileAttachments
  } = await import(attachmentsUrl)
  const originalWindow = global.window
  let pathReads = 0
  const payload = 'browser payload'

  global.window = {
    pre: {
      runGlobalAsync: async (operation, input) => {
        assert.equal(operation, 'ingestAIContent')
        assert.equal(
          Buffer.from(input.dataBase64, 'base64').toString('utf8'),
          payload
        )
        return {
          ok: true,
          value: {
            kind: 'text',
            name: input.name,
            mimeType: input.mimeType,
            bytes: Buffer.byteLength(payload),
            text: payload,
            truncated: false
          }
        }
      }
    }
  }

  try {
    const file = {
      name: 'browser.txt',
      size: Buffer.byteLength(payload),
      type: 'text/plain',
      arrayBuffer: async () => Uint8Array.from(
        Buffer.from(payload)
      ).buffer
    }
    const result = await buildAttachmentAIContent({
      attachments: createLocalFileAttachments([file]),
      fsApi: {
        readFilePreview: async () => {
          pathReads += 1
          throw new Error('pathless browser files must not use disk reads')
        }
      }
    })

    assert.equal(pathReads, 0)
    assert.deepEqual(result.errors, [])
    assert.match(result.prompt, /browser payload/)
  } finally {
    global.window = originalWindow
  }
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
        sourceTabId: 'tab-a',
        sourceSftpEndpoint: sftpEndpoint(),
        file: {
          name: 'logs.tar.gz',
          path: '/tmp',
          type: 'remote',
          size: 4096,
          isDirectory: false
        }
      }
    ],
    sftpRefs: {
      get: () => ({
        getSftpSafetyEndpoint: () => sftpEndpoint(),
        readRemoteFileContext: async file => ({
          ok: true,
          archiveType: 'tar.gz',
          path: `${file.path}/${file.name}#nginx/error.log`,
          source: 'remote',
          content: 'nginx bind failed',
          binary: false,
          bytesRead: 16,
          truncated: true
        })
      })
    }
  })

  assert.match(prompt, /压缩/)
  assert.match(prompt, /logs\.tar\.gz#nginx\/error\.log/)
  assert.match(prompt, /nginx bind failed/)
  assert.match(prompt, /继续读取/)
})

test('all SFTP text and archive attachments use the public bounded entry route', async () => {
  const { buildAttachmentAIContent } = await import(attachmentsUrl)
  const names = ['notes.txt', 'bundle.zip', 'single.log.gz', 'logs.tgz']
  const calls = []
  const raw = {}
  Object.defineProperty(raw, 'sftp', {
    get () {
      throw new Error('raw SFTP attachment access is forbidden')
    }
  })
  raw.readRemoteFileContext = async (file, options) => {
    calls.push([file.name, options])
    return {
      ok: true,
      path: `/root/${file.name}`,
      source: 'remote',
      archiveType: file.name.endsWith('.txt') ? undefined : 'archive',
      content: `bounded:${file.name}`,
      binary: false,
      truncated: false,
      bytesRead: 10
    }
  }
  raw.getSftpSafetyEndpoint = () => sftpEndpoint()
  const controller = new AbortController()
  const result = await buildAttachmentAIContent({
    attachments: names.map(name => ({
      source: 'sftp',
      name,
      sourceTabId: 'tab-a',
      sourceSftpEndpoint: sftpEndpoint(),
      file: { name, path: '/root', type: 'remote', isDirectory: false }
    })),
    sftpRefs: { get: () => raw },
    signal: controller.signal
  })

  assert.deepEqual(result.errors, [])
  assert.equal(calls.length, names.length)
  assert.ok(calls.every(([, options]) => options.signal === controller.signal))
  for (const name of names) assert.match(result.prompt, new RegExp(`bounded:${name.replace('.', '\\.')}`))
})

test('SFTP binary attachments use the public bounded payload route and fail closed without it', async () => {
  const { buildAttachmentAIContent } = await import(attachmentsUrl)
  const originalWindow = global.window
  const calls = []
  global.window = {
    pre: {
      runGlobalAsync: async (_operation, input) => ({
        ok: true,
        value: {
          kind: 'text',
          name: input.name,
          text: Buffer.from(input.dataBase64, 'base64').toString('utf8'),
          truncated: false
        }
      })
    }
  }
  try {
    const attachment = {
      source: 'sftp',
      name: 'artifact.bin',
      sourceTabId: 'tab-a',
      sourceSftpEndpoint: sftpEndpoint(),
      file: { name: 'artifact.bin', path: '/root', type: 'remote' }
    }
    const result = await buildAttachmentAIContent({
      attachments: [attachment],
      sftpRefs: {
        get: () => ({
          getSftpSafetyEndpoint: () => sftpEndpoint(),
          readRemoteFileAttachment: async (file, options) => {
            calls.push([file, options])
            return { base64: Buffer.from('bounded payload').toString('base64') }
          }
        })
      }
    })
    assert.deepEqual(result.errors, [])
    assert.match(result.prompt, /bounded payload/)
    assert.equal(calls.length, 1)

    const missing = await buildAttachmentAIContent({
      attachments: [attachment],
      sftpRefs: {
        get: () => ({
          getSftpSafetyEndpoint: () => sftpEndpoint(),
          sftp: { readFileBase64Preview: async () => ({}) }
        })
      }
    })
    assert.equal(missing.prompt, '')
    assert.match(missing.errors[0], /安全读取/)
  } finally {
    global.window = originalWindow
  }
})

test('AI attachment source never reaches through SftpEntry to raw SFTP', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/ai/ai-attachments.js'),
    'utf8'
  )
  assert.doesNotMatch(source, /sftpRef\??\.sftp/)
  assert.match(source, /readRemoteFileContext/)
  assert.match(source, /readRemoteFileAttachment/)
})

function sftpEndpoint (overrides = {}) {
  return {
    host: 'prod.example.com',
    port: 2222,
    username: 'deploy',
    connectionUsername: 'deploy',
    tabId: 'tab-a',
    pid: 'sftp:tab-a:terminal-a',
    terminalId: 'terminal-a',
    terminalPid: 'terminal-a',
    sshTerminalPid: 4242,
    sshSessionGeneration: 'generation-a',
    hostKeyFingerprint: 'SHA256:host-a',
    sessionType: 'sftp',
    ...overrides
  }
}

test('queued SFTP attachments pin an immutable exact source endpoint', async () => {
  const {
    createSftpFileAttachments,
    parseSftpDropPayload
  } = await import(attachmentsUrl)
  const endpoint = sftpEndpoint()
  const attachments = createSftpFileAttachments([{
    name: 'app.log',
    path: '/root',
    type: 'remote',
    isDirectory: false
  }], {
    getSftpSafetyEndpoint: () => endpoint
  })

  assert.equal(attachments[0].sourceTabId, 'tab-a')
  assert.deepEqual(attachments[0].sourceSftpEndpoint, endpoint)
  assert.equal(Object.isFrozen(attachments[0]), true)
  assert.equal(Object.isFrozen(attachments[0].sourceSftpEndpoint), true)
  endpoint.sshSessionGeneration = 'generation-mutated'
  assert.equal(
    attachments[0].sourceSftpEndpoint.sshSessionGeneration,
    'generation-a'
  )
  const restored = parseSftpDropPayload(JSON.stringify(attachments))
  assert.equal(restored[0].sourceTabId, 'tab-a')
  assert.deepEqual(
    restored[0].sourceSftpEndpoint,
    attachments[0].sourceSftpEndpoint
  )
})

test('empty SFTP selections preserve the no-file flow without resolving a source endpoint', async () => {
  const { createSftpFileAttachments } = await import(attachmentsUrl)
  let endpointReads = 0
  const attachments = createSftpFileAttachments([], {
    getSftpSafetyEndpoint: () => {
      endpointReads += 1
      throw new Error('the empty selection must not resolve an endpoint')
    }
  })

  assert.deepEqual(attachments, [])
  assert.equal(endpointReads, 0)
})

test('legacy SFTP attachment endpoints without terminalId fail closed', async () => {
  const { createSftpFileAttachments } = await import(attachmentsUrl)
  const legacyEndpoint = sftpEndpoint()
  delete legacyEndpoint.terminalId

  assert.throws(
    () => createSftpFileAttachments([{
      name: 'legacy.log',
      path: '/root',
      type: 'remote',
      isDirectory: false
    }], {
      getSftpSafetyEndpoint: () => legacyEndpoint
    }),
    /SFTP 会话安全标识/
  )
})

test('SFTP attachments resolve their pinned tab instead of the active tab', async () => {
  const {
    buildAttachmentAIContent,
    createSftpFileAttachments
  } = await import(attachmentsUrl)
  let readsA = 0
  let readsB = 0
  const refA = {
    getSftpSafetyEndpoint: () => sftpEndpoint(),
    readRemoteFileContext: async file => {
      readsA += 1
      return {
        ok: true,
        path: `${file.path}/${file.name}`,
        source: 'remote',
        content: 'source A',
        truncated: false
      }
    }
  }
  const refB = {
    getSftpSafetyEndpoint: () => sftpEndpoint({
      tabId: 'tab-b',
      pid: 'sftp:tab-b:terminal-b',
      terminalId: 'terminal-b',
      terminalPid: 'terminal-b',
      sshTerminalPid: 5252,
      sshSessionGeneration: 'generation-b'
    }),
    readRemoteFileContext: async () => {
      readsB += 1
      throw new Error('active tab B must never read attachment A')
    }
  }
  const attachments = createSftpFileAttachments([{
    name: 'app.log',
    path: '/root',
    type: 'remote',
    isDirectory: false
  }], refA)
  const refsByTab = new Map([
    ['sftp-tab-a', refA],
    ['sftp-tab-b', refB]
  ])
  const result = await buildAttachmentAIContent({
    attachments,
    sftpRefs: { get: key => refsByTab.get(key) },
    sftpRef: refB
  })

  assert.deepEqual(result.errors, [])
  assert.match(result.prompt, /source A/)
  assert.equal(readsA, 1)
  assert.equal(readsB, 0)
})

test('SFTP attachment rejects reconnect PID changes closed tabs and legacy bindings', async () => {
  const {
    buildAttachmentAIContent,
    createSftpFileAttachments
  } = await import(attachmentsUrl)
  let reads = 0
  const pinnedRef = { getSftpSafetyEndpoint: () => sftpEndpoint() }
  const [attachment] = createSftpFileAttachments([{
    name: 'app.log',
    path: '/root',
    type: 'remote',
    isDirectory: false
  }], pinnedRef)
  for (const changed of [
    { sshSessionGeneration: 'generation-new' },
    { sshTerminalPid: 4343 }
  ]) {
    const changedRef = {
      getSftpSafetyEndpoint: () => sftpEndpoint(changed),
      readRemoteFileContext: async () => { reads += 1 }
    }
    const result = await buildAttachmentAIContent({
      attachments: [attachment],
      sftpRefs: { get: () => changedRef }
    })
    assert.equal(result.prompt, '')
    assert.match(result.errors[0], /附件源连接已过期/)
  }

  const gone = await buildAttachmentAIContent({
    attachments: [attachment],
    sftpRefs: { get: () => null }
  })
  assert.equal(gone.prompt, '')
  assert.match(gone.errors[0], /附件源连接已过期/)

  const [legacy] = createSftpFileAttachments([{
    name: 'legacy.log', path: '/root', type: 'remote', isDirectory: false
  }])
  const legacyResult = await buildAttachmentAIContent({
    attachments: [legacy],
    sftpRefs: { get: () => pinnedRef }
  })
  assert.equal(legacyResult.prompt, '')
  assert.match(legacyResult.errors[0], /附件缺少安全源绑定/)
  assert.equal(reads, 0)
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
  assert.match(source, /ai-attachment-upload-button/)
  assert.doesNotMatch(source, /ai-attachment-pick-icon/)
  assert.match(source, /buildAttachmentAIContent/)
  assert.match(source, /parseSftpDropPayload/)
})

test('AI attachment presentation identifies safe local image previews', async () => {
  const {
    getAIAttachmentPresentation
  } = await import(attachmentsUrl)

  assert.equal(typeof getAIAttachmentPresentation, 'function')
  assert.deepEqual(getAIAttachmentPresentation({
    source: 'local',
    name: 'screen.png',
    size: 1536,
    mimeType: 'image/png'
  }), {
    kind: 'image',
    extension: 'png',
    typeLabel: 'PNG',
    sizeLabel: '1.5 KB',
    meta: 'PNG · 1.5 KB'
  })
})

test('AI attachment presentation does not preview unsupported image MIME types', async () => {
  const {
    getAIAttachmentPresentation
  } = await import(attachmentsUrl)

  assert.equal(typeof getAIAttachmentPresentation, 'function')
  assert.equal(getAIAttachmentPresentation({
    source: 'local',
    name: 'spoofed.png',
    mimeType: 'image/svg+xml'
  }).kind, 'file')
})

test('AI attachment presentation describes documents and web sources', async () => {
  const {
    getAIAttachmentPresentation
  } = await import(attachmentsUrl)

  assert.equal(typeof getAIAttachmentPresentation, 'function')
  assert.deepEqual(getAIAttachmentPresentation({
    source: 'local',
    name: 'report.docx',
    size: 2 * 1024 * 1024
  }), {
    kind: 'file',
    extension: 'docx',
    typeLabel: 'DOCX',
    sizeLabel: '2 MB',
    meta: 'DOCX · 2 MB'
  })
  assert.deepEqual(getAIAttachmentPresentation({
    source: 'url',
    name: 'https://example.com/report'
  }), {
    kind: 'web',
    extension: '',
    typeLabel: 'WEB',
    sizeLabel: '',
    meta: 'WEB'
  })
})

test('AI attachment card owns local image preview lifecycle and an accessible remove action', () => {
  const componentPath = path.join(
    root,
    'src/client/components/ai/ai-attachment-card.jsx'
  )

  assert.equal(fs.existsSync(componentPath), true)
  const source = fs.readFileSync(componentPath, 'utf8')
  assert.match(source, /URL\.createObjectURL/)
  assert.match(source, /URL\.revokeObjectURL/)
  assert.match(source, /className='ai-attachment-preview-image'/)
  assert.match(source, /className='ai-attachment-remove'/)
  assert.match(source, /aria-label=/)
})
