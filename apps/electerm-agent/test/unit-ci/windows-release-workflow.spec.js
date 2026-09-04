const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflowPath = path.resolve(
  __dirname,
  '../../../../.github/workflows/windows-electerm-agent-release.yml'
)

function readWorkflow () {
  return fs.readFileSync(workflowPath, 'utf8')
}

function workflowStepNames (source) {
  return [...source.matchAll(/^ {6}- name: ([^\r\n]+)$/gm)]
    .map(match => match[1])
}

test('stable Windows releases remain independent of signing credentials', () => {
  const source = readWorkflow()

  assert.doesNotMatch(source, /WINDOWS_CSC_LINK/)
  assert.doesNotMatch(source, /WINDOWS_CSC_KEY_PASSWORD/)
  assert.doesNotMatch(source, /^\s*CSC_LINK:/m)
  assert.doesNotMatch(source, /^\s*CSC_KEY_PASSWORD:/m)
  assert.doesNotMatch(source, /release:windows:verify-signatures/)
  assert.doesNotMatch(source, /Verify stable release signatures/)
})

test('stable Windows releases retain manual confirmation and overwrite protection', () => {
  const source = readWorkflow()

  assert.match(
    source,
    /Verify manual stable release confirmation[\s\S]*ShellPilot stable release/
  )
  assert.match(source, /Refuse to overwrite an existing release/)
  assert.match(source, /gh release view \$tag/)
  assert.match(source, /git ls-remote --tags origin "refs\/tags\/\$tag"/)
  assert.match(source, /draft: true/)
})

test('unsigned packaging still passes every existing build and asset gate', () => {
  const source = readWorkflow()
  const expectedOrder = [
    'Verify manual stable release confirmation',
    'Install dependencies and rebuild native modules',
    'Run unit tests',
    'Build renderer and prepare packaged app',
    'Prepare electron-builder config',
    'Build NSIS installer',
    'Smoke test packaged ShellPilot app',
    'Build portable package',
    'Verify portable package',
    'Prepare approved online update assets',
    'Verify local update assets',
    'Upload Windows artifacts',
    'Create draft GitHub Release after manual confirmation'
  ]
  const names = workflowStepNames(source)
  let previousIndex = -1

  for (const name of expectedOrder) {
    const index = names.indexOf(name)
    assert.notEqual(index, -1, `Missing workflow step: ${name}`)
    assert.equal(index > previousIndex, true, `Step is out of order: ${name}`)
    previousIndex = index
  }

  assert.equal(
    [...source.matchAll(/electron-builder --win (?:nsis|zip) --publish never/g)]
      .length,
    2
  )
})
