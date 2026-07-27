const {
  validateArtifactDraft
} = require('./artifact-validator')
const {
  artifactFilename
} = require('./filename-utils')
const {
  buildPrintableReportHtml
} = require('./report-html')

const MAX_PRINT_HTML_BYTES = 2 * 1024 * 1024

function createPdfGenerator (options = {}) {
  const printer = options.printHtml || require('./pdf-printer').printHtml
  return {
    format: 'pdf',
    async generate (source) {
      const draft = validateArtifactDraft(source)
      const html = buildPrintableReportHtml(draft)
      if (Buffer.byteLength(html, 'utf8') > MAX_PRINT_HTML_BYTES) {
        const error = new Error('Printable artifact content is too large.')
        error.code = 'ARTIFACT_PDF_TOO_LARGE'
        throw error
      }
      const content = await printer(html, {
        pageSize: 'A4',
        printBackground: true
      })
      if (!Buffer.isBuffer(content)) {
        const error = new Error('PDF printer returned invalid content.')
        error.code = 'ARTIFACT_PDF_INVALID'
        throw error
      }
      return {
        filename: artifactFilename(draft.title, 'pdf'),
        content
      }
    }
  }
}

const generator = createPdfGenerator()

module.exports = Object.freeze(Object.assign(generator, {
  createPdfGenerator
}))
