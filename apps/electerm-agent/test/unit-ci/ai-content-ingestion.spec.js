const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const JSZip = require('jszip')
const ExcelJS = require('exceljs')

const {
  ingestBuffer,
  isDocumentExtension
} = require('../../src/app/lib/ai-content/content-ingestion')
const {
  assertSafePublicUrl,
  isPrivateAddress
} = require('../../src/app/lib/ai-content/url-safety')
const {
  createPinnedLookup,
  htmlToText
} = require('../../src/app/lib/ai-content/web-reader')
const {
  readRemoteFileBase64Preview
} = require('../../src/app/server/sftp-file')

test('ingests text, DOCX, PPTX and image content with bounded output', async () => {
  const text = await ingestBuffer({
    name: 'server.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('nginx timeout\n'.repeat(100)),
    maxTextChars: 120
  })
  assert.equal(text.kind, 'text')
  assert.ok(text.text.length <= 120)
  assert.equal(text.truncated, true)

  const docx = new JSZip()
  docx.file('word/document.xml', [
    '<w:document xmlns:w="urn:test"><w:body>',
    '<w:p><w:r><w:t>故障复盘</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Nginx 超时</w:t></w:r></w:p>',
    '</w:body></w:document>'
  ].join(''))
  const docxResult = await ingestBuffer({
    name: 'review.docx',
    buffer: await docx.generateAsync({ type: 'nodebuffer' })
  })
  assert.equal(docxResult.kind, 'text')
  assert.match(docxResult.text, /故障复盘/)
  assert.match(docxResult.text, /Nginx 超时/)

  const pptx = new JSZip()
  pptx.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld>',
    '<a:p><a:r><a:t>服务器巡检</a:t></a:r></a:p>',
    '</p:cSld></p:sld>'
  ].join(''))
  const pptxResult = await ingestBuffer({
    name: 'inspection.pptx',
    buffer: await pptx.generateAsync({ type: 'nodebuffer' })
  })
  assert.match(pptxResult.text, /服务器巡检/)

  const image = await ingestBuffer({
    name: 'error.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47])
  })
  assert.equal(image.kind, 'image')
  assert.match(image.dataUrl, /^data:image\/png;base64,/)

  assert.equal(isDocumentExtension('.pdf'), true)
  assert.equal(isDocumentExtension('.docx'), true)
  assert.equal(isDocumentExtension('.exe'), false)
})

test('rejects image formats that model requests cannot safely carry', async () => {
  await assert.rejects(
    ingestBuffer({
      name: 'network.bmp',
      mimeType: 'image/bmp',
      buffer: Buffer.from([0x42, 0x4d, 0, 0])
    }),
    /不支持|image/i
  )
  await assert.rejects(
    ingestBuffer({
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg></svg>')
    }),
    /不支持|image/i
  )
  await assert.rejects(
    ingestBuffer({
      name: 'spoofed.png',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg></svg>')
    }),
    /不支持|image/i
  )
})

test('rejects Office archives with an excessive declared expansion size', async () => {
  const archive = new JSZip()
  archive.file(
    'word/document.xml',
    `<w:document><w:p>${'A'.repeat(65 * 1024 * 1024)}</w:p></w:document>`
  )
  const buffer = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })

  assert.ok(buffer.length < 10 * 1024 * 1024)
  await assert.rejects(
    ingestBuffer({
      name: 'oversized.docx',
      buffer
    }),
    /解压后|archive/i
  )
})

test('extracts XLSX cells and safely bounds SFTP binary reads', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('巡检')
  sheet.addRow(['服务', '状态'])
  sheet.addRow(['nginx', '运行中'])
  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const xlsx = await ingestBuffer({
    name: '服务器巡检.xlsx',
    buffer: workbookBuffer
  })

  assert.equal(xlsx.kind, 'text')
  assert.match(xlsx.text, /巡检/)
  assert.match(xlsx.text, /nginx/)
  assert.match(xlsx.text, /运行中/)

  const preview = await readRemoteFileBase64Preview({
    createReadStream: () => Readable.from([
      Buffer.from([0, 1, 2]),
      Buffer.from([3, 4, 5])
    ])
  }, '/tmp/sample.bin', 4)

  assert.equal(preview.bytesRead, 4)
  assert.equal(preview.truncated, true)
  assert.deepEqual(
    Buffer.from(preview.base64, 'base64'),
    Buffer.from([0, 1, 2, 3])
  )
})

test('rejects local, private and credential-bearing web URLs', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('10.1.2.3'), true)
  assert.equal(isPrivateAddress('169.254.1.1'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)

  await assert.rejects(
    assertSafePublicUrl('http://127.0.0.1/admin'),
    /public|公网|private/i
  )
  await assert.rejects(
    assertSafePublicUrl('https://user:password@example.com/'),
    /credential|凭据/i
  )
  await assert.rejects(
    assertSafePublicUrl('file:///etc/passwd'),
    /http|https/i
  )

  assert.equal(
    htmlToText(
      '<h1>巡检报告</h1><script>secret()</script><p>Nginx 正常</p>'
    ),
    '巡检报告\nNginx 正常'
  )
})

test('pinned web lookup supports Node single and all address callbacks', async () => {
  const lookup = createPinnedLookup('93.184.216.34', 4)

  await new Promise((resolve, reject) => {
    lookup('example.com', {}, (error, address, family) => {
      if (error) return reject(error)
      assert.equal(address, '93.184.216.34')
      assert.equal(family, 4)
      resolve()
    })
  })

  await new Promise((resolve, reject) => {
    lookup('example.com', { all: true }, (error, addresses) => {
      if (error) return reject(error)
      assert.deepEqual(addresses, [{
        address: '93.184.216.34',
        family: 4
      }])
      resolve()
    })
  })
})
