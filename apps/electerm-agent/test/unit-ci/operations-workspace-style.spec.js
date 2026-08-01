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

test('uses Aurora depth on containers while keeping operations rows flat', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]*border-radius\s+var\(--sp-radius-panel\)/)
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]*box-shadow\s+var\(--sp-shadow-lg\)/)
  assert.match(styles, /\.operations-workspace-head[\s\S]*box-shadow\s+var\(--sp-shadow-md\)/)
  assert.match(styles, /\.operations-tool-list[\s\S]*box-shadow\s+none/)
})
