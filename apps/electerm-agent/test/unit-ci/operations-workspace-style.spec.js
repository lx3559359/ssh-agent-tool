const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('keeps the operations primary action readable in every theme', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')

  assert.match(
    styles,
    /\.operations-run-actions[\s\S]*?\.ant-btn-primary[\s\S]*?color\s+#fff/
  )
})
