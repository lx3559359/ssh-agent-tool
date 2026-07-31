const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { once } = require('node:events')
const { PassThrough, Readable } = require('node:stream')
const JSZip = require('jszip')
const ExcelJS = require('exceljs')

const root = path.resolve(__dirname, '../..')

const source = {
  schemaVersion: 1,
  type: 'inspection-report',
  title: '生产服务器巡检',
  server: 'prod-web-01',
  summary: '服务器整体运行稳定，需要持续关注磁盘使用率。',
  sections: [
    {
      title: '系统状态',
      content: '负载正常，未发现失败服务。'
    }
  ],
  risks: ['数据盘使用率达到 82%'],
  recommendations: ['清理历史日志并设置保留周期'],
  tables: [
    {
      title: '服务状态',
      columns: ['服务', '状态', '端口'],
      rows: [
        ['nginx', '正常', '80'],
        ['docker', '警告', '']
      ]
    }
  ]
}

test('DOCX generator creates a real Office document with Chinese report content', async () => {
  const generator = require(path.join(
    root,
    'src/app/lib/ai-artifacts/docx-generator'
  ))
  const result = await generator.generate(source)

  assert.ok(Buffer.isBuffer(result.content))
  assert.equal(result.filename, '生产服务器巡检.docx')
  const archive = await JSZip.loadAsync(result.content)
  const documentXml = await archive.file('word/document.xml').async('string')
  const stylesXml = await archive.file('word/styles.xml').async('string')

  assert.match(documentXml, /生产服务器巡检/)
  assert.match(documentXml, /系统状态/)
  assert.match(documentXml, /nginx/)
  assert.match(documentXml, /清理历史日志/)
  assert.match(stylesXml, /Microsoft YaHei|微软雅黑/)
})

test('XLSX generator creates summary and filtered detail worksheets', async () => {
  const generator = require(path.join(
    root,
    'src/app/lib/ai-artifacts/xlsx-generator'
  ))
  const result = await generator.generate(source)

  assert.ok(Buffer.isBuffer(result.content))
  assert.equal(result.filename, '生产服务器巡检.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(result.content)

  assert.equal(workbook.worksheets.length, 2)
  assert.equal(workbook.getWorksheet('汇总').getCell('A1').value, '生产服务器巡检')
  const detail = workbook.getWorksheet('服务状态')
  assert.equal(detail.getCell('A1').value, '服务')
  assert.equal(detail.getCell('A2').value, 'nginx')
  assert.equal(detail.views[0].state, 'frozen')
  assert.equal(detail.views[0].ySplit, 1)
  assert.equal(detail.autoFilter, 'A1:C1')
})

test('ExcelJS streaming reader and writer remain compatible with patched dependencies', async () => {
  const output = new PassThrough()
  const chunks = []
  output.on('data', chunk => chunks.push(chunk))
  const finished = once(output, 'finish')

  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output })
  const sheet = writer.addWorksheet('Audit')
  sheet.addRow(['streaming', 42]).commit()
  await writer.commit()
  await finished

  const content = Buffer.concat(chunks)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(content)
  assert.equal(workbook.getWorksheet('Audit').getCell('B1').value, 42)

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(
    Readable.from(content)
  )
  const rows = []
  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      rows.push(row.values.slice(1))
    }
  }
  assert.deepEqual(rows, [['streaming', 42]])
})

test('printable report HTML is escaped and contains no executable content', () => {
  const {
    buildPrintableReportHtml
  } = require(path.join(
    root,
    'src/app/lib/ai-artifacts/report-html'
  ))
  const html = buildPrintableReportHtml({
    ...source,
    summary: '<img src=x onerror=alert(1)>',
    sections: [{
      title: '安全<script>alert(1)</script>',
      content: 'javascript:alert(1)'
    }]
  })

  assert.match(html, /<!doctype html>/i)
  assert.match(html, /生产服务器巡检/)
  assert.doesNotMatch(html, /<script|onerror=|javascript:/i)
  assert.match(html, /&lt;img/)
})

test('PDF generator delegates bounded A4 content to its sandboxed printer', async () => {
  const {
    createPdfGenerator
  } = require(path.join(
    root,
    'src/app/lib/ai-artifacts/pdf-generator'
  ))
  let observed
  const generator = createPdfGenerator({
    printHtml: async (html, options) => {
      observed = { html, options }
      return Buffer.from('%PDF-test')
    }
  })

  const result = await generator.generate(source)

  assert.equal(result.filename, '生产服务器巡检.pdf')
  assert.equal(result.content.toString('utf8'), '%PDF-test')
  assert.equal(observed.options.pageSize, 'A4')
  assert.equal(observed.options.printBackground, true)
  assert.ok(Buffer.byteLength(observed.html, 'utf8') < 2 * 1024 * 1024)
})
