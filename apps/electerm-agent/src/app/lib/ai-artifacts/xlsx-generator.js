const ExcelJS = require('exceljs')
const {
  validateArtifactDraft
} = require('./artifact-validator')
const {
  artifactFilename
} = require('./filename-utils')

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F6FEB' }
}
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD0D7DE' } },
  left: { style: 'thin', color: { argb: 'FFD0D7DE' } },
  bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
  right: { style: 'thin', color: { argb: 'FFD0D7DE' } }
}

function uniqueSheetName (value, used) {
  const base = String(value || '数据')
    .replace(/[:\\/?*[\]]/g, '-')
    .slice(0, 31) || '数据'
  let name = base
  let index = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${index++})`
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`
  }
  used.add(name.toLowerCase())
  return name
}

function styleHeader (row) {
  row.font = {
    name: 'Microsoft YaHei',
    bold: true,
    color: { argb: 'FFFFFFFF' }
  }
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'center' }
}

function fitColumns (worksheet) {
  worksheet.columns.forEach(column => {
    let width = 10
    column.eachCell({ includeEmpty: true }, cell => {
      width = Math.max(width, String(cell.value ?? '').length + 2)
    })
    column.width = Math.min(48, width)
  })
}

async function generate (source) {
  const draft = validateArtifactDraft(source)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ShellPilot'
  workbook.created = new Date(0)
  workbook.modified = new Date(0)
  const usedNames = new Set()
  const summary = workbook.addWorksheet(uniqueSheetName('汇总', usedNames))
  summary.addRow([draft.title])
  summary.mergeCells('A1:B1')
  summary.getCell('A1').font = {
    name: 'Microsoft YaHei',
    bold: true,
    size: 18,
    color: { argb: 'FF1F2328' }
  }
  summary.addRows([
    ['服务器', draft.server],
    ['摘要', draft.summary],
    ['风险', draft.risks.join('\n')],
    ['建议', draft.recommendations.join('\n')]
  ])
  summary.getColumn(1).font = { name: 'Microsoft YaHei', bold: true }
  summary.getColumn(1).width = 14
  summary.getColumn(2).width = 72
  summary.getColumn(2).alignment = { wrapText: true, vertical: 'top' }

  for (const [index, table] of draft.tables.entries()) {
    const name = uniqueSheetName(table.title || `表格 ${index + 1}`, usedNames)
    const worksheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }]
    })
    const width = Math.max(
      1,
      table.columns.length,
      ...table.rows.map(row => row.length)
    )
    const columns = Array.from(
      { length: width },
      (_, columnIndex) => table.columns[columnIndex] || `第 ${columnIndex + 1} 列`
    )
    styleHeader(worksheet.addRow(columns))
    for (const row of table.rows) {
      worksheet.addRow(columns.map((_, columnIndex) => row[columnIndex] || ''))
    }
    worksheet.autoFilter = {
      from: 'A1',
      to: worksheet.getRow(1).getCell(width).address
    }
    worksheet.eachRow(row => {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { ...cell.font, name: 'Microsoft YaHei' }
        cell.border = THIN_BORDER
        cell.alignment = { vertical: 'top', wrapText: true }
        const text = String(cell.value || '').trim()
        if (/^(警告|warning)$/i.test(text)) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF3CD' }
          }
        } else if (/^(严重|critical|失败|failed)$/i.test(text)) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8D7DA' }
          }
        }
      })
    })
    fitColumns(worksheet)
  }

  return {
    filename: artifactFilename(draft.title, 'xlsx'),
    content: Buffer.from(await workbook.xlsx.writeBuffer())
  }
}

module.exports = Object.freeze({
  format: 'xlsx',
  generate
})
