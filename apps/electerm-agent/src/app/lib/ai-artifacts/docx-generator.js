const {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require('docx')
const {
  validateArtifactDraft
} = require('./artifact-validator')
const {
  artifactFilename
} = require('./filename-utils')

const BODY_FONT = 'Microsoft YaHei'

function paragraph (text, options = {}) {
  return new Paragraph({
    ...options,
    children: [
      new TextRun({
        text: String(text || ''),
        font: BODY_FONT,
        size: options.size || 21,
        bold: Boolean(options.bold)
      })
    ]
  })
}

function listParagraph (text) {
  return paragraph(text, {
    bullet: { level: 0 },
    spacing: { after: 80 }
  })
}

function reportTable (table) {
  const width = Math.max(
    1,
    table.columns.length,
    ...table.rows.map(row => row.length)
  )
  const headers = Array.from(
    { length: width },
    (_, index) => table.columns[index] || `第 ${index + 1} 列`
  )
  const rows = [
    new TableRow({
      tableHeader: true,
      children: headers.map(value => new TableCell({
        children: [paragraph(value, { bold: true })]
      }))
    }),
    ...table.rows.map(row => new TableRow({
      children: headers.map((_, index) => new TableCell({
        children: [paragraph(row[index] || '')]
      }))
    }))
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  })
}

async function generate (source) {
  const draft = validateArtifactDraft(source)
  const children = [
    paragraph(draft.title, {
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      bold: true,
      size: 34,
      spacing: { after: 240 }
    })
  ]
  if (draft.server) {
    children.push(paragraph(`服务器：${draft.server}`, {
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 }
    }))
  }
  children.push(
    paragraph('摘要', { heading: HeadingLevel.HEADING_1, bold: true }),
    paragraph(draft.summary, { spacing: { after: 180 } })
  )
  for (const [index, section] of draft.sections.entries()) {
    children.push(
      paragraph(section.title || `第 ${index + 1} 节`, {
        heading: HeadingLevel.HEADING_1,
        bold: true
      }),
      ...String(section.content || '').split(/\r?\n/).map(line => (
        paragraph(line, { spacing: { after: 80 } })
      ))
    )
  }
  children.push(paragraph('风险', {
    heading: HeadingLevel.HEADING_1,
    bold: true
  }))
  children.push(...(draft.risks.length
    ? draft.risks.map(listParagraph)
    : [paragraph('未发现明确风险。')]))
  children.push(paragraph('建议', {
    heading: HeadingLevel.HEADING_1,
    bold: true
  }))
  children.push(...(draft.recommendations.length
    ? draft.recommendations.map(listParagraph)
    : [paragraph('暂无补充建议。')]))
  for (const [index, table] of draft.tables.entries()) {
    children.push(
      paragraph(table.title || `表格 ${index + 1}`, {
        heading: HeadingLevel.HEADING_1,
        bold: true
      }),
      reportTable(table)
    )
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 21 }
        }
      }
    },
    sections: [{
      headers: {
        default: new Header({
          children: [paragraph('ShellPilot AI 成果物', {
            alignment: AlignmentType.RIGHT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: '第 ', font: BODY_FONT }),
              new TextRun({ children: [PageNumber.CURRENT] }),
              new TextRun({ text: ' 页', font: BODY_FONT })
            ]
          })]
        })
      },
      children
    }]
  })

  return {
    filename: artifactFilename(draft.title, 'docx'),
    content: await Packer.toBuffer(document)
  }
}

module.exports = Object.freeze({
  format: 'docx',
  generate
})
