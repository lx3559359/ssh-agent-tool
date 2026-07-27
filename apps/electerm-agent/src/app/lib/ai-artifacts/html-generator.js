const {
  validateArtifactDraft
} = require('./artifact-validator')
const {
  artifactFilename
} = require('./filename-utils')
const {
  buildPrintableReportHtml
} = require('./report-html')

const MAX_HTML_BYTES = 2 * 1024 * 1024

module.exports = Object.freeze({
  format: 'html',
  async generate (source) {
    const draft = validateArtifactDraft(source)
    const html = buildPrintableReportHtml(draft)
    const content = Buffer.from(html, 'utf8')
    if (content.byteLength > MAX_HTML_BYTES) {
      const error = new Error('HTML artifact content is too large.')
      error.code = 'ARTIFACT_HTML_TOO_LARGE'
      throw error
    }
    return {
      filename: artifactFilename(draft.title, 'html'),
      contentType: 'text/html; charset=utf-8',
      content
    }
  }
})
