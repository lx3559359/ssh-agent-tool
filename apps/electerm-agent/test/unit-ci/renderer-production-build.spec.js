const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const packageJson = require(path.join(root, 'package.json'))
const rendererBundle = path.join(
  root,
  `work/app/assets/js/electerm-${packageJson.version}.js`
)

function commandFailure (result) {
  return [
    `exit status: ${result.status}`,
    result.error?.stack,
    result.stdout,
    result.stderr
  ].filter(Boolean).join('\n')
}

test('production renderer build emits a non-empty, parseable application bundle', {
  timeout: 60_000
}, () => {
  fs.rmSync(rendererBundle, { force: true })
  const build = spawnSync(process.execPath, ['build/bin/vite-build.js'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })

  assert.equal(build.status, 0, commandFailure(build))
  assert.ok(fs.existsSync(rendererBundle), 'renderer bundle must exist')
  assert.ok(
    fs.statSync(rendererBundle).size > 100_000,
    'renderer bundle must contain the production application graph'
  )

  const syntax = spawnSync(process.execPath, ['--check', rendererBundle], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  assert.equal(syntax.status, 0, commandFailure(syntax))
})
