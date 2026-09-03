const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflowPath = path.resolve(
  __dirname,
  '../../../../.github/workflows/windows-electerm-agent-release.yml'
)

function extractNamedStepBlock (source, stepName) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex(line => (
    line === `      - name: ${stepName}`
  ))
  assert.notEqual(start, -1, `Missing workflow step: ${stepName}`)

  const nextStepOffset = lines.slice(start + 1).findIndex(line => (
    /^ {6}- name: /.test(line)
  ))
  const end = nextStepOffset === -1
    ? lines.length
    : start + 1 + nextStepOffset
  return lines.slice(start, end).join('\n')
}

function assertImmediateNamedStepOrder (source, expectedNames) {
  const stepNames = [...source.matchAll(/^ {6}- name: ([^\r\n]+)$/gm)]
    .map(match => match[1])
  const start = stepNames.indexOf(expectedNames[0])

  assert.notEqual(start, -1, `Missing workflow step: ${expectedNames[0]}`)
  assert.deepEqual(
    stepNames.slice(start, start + expectedNames.length),
    expectedNames
  )
}

function assertStableWindowsReleaseSigningWorkflow (source) {
  const confirmationGate = source.indexOf(
    'name: Verify manual stable release confirmation'
  )
  const credentialGate = source.indexOf(
    'name: Require Windows signing credentials for stable release'
  )
  const dependencyInstall = source.indexOf(
    'name: Install dependencies and rebuild native modules'
  )
  const installerBuild = source.indexOf('name: Build NSIS installer')
  const signatureGate = source.indexOf(
    'name: Verify stable release signatures'
  )
  const assetPreparation = source.indexOf(
    'name: Prepare approved online update assets'
  )
  const signatureStep = extractNamedStepBlock(
    source,
    'Verify stable release signatures'
  )

  assert.match(
    source,
    /^ {6}CSC_LINK: \$\{\{ secrets\.WINDOWS_CSC_LINK \}\}$/m
  )
  assert.match(
    source,
    /^ {6}CSC_KEY_PASSWORD: \$\{\{ secrets\.WINDOWS_CSC_KEY_PASSWORD \}\}$/m
  )
  assert.match(
    signatureStep,
    /^ {8}if: \$\{\{ github\.event\.inputs\.release_channel == 'stable' \}\}$/m
  )
  assert.match(
    signatureStep,
    /^ {8}run: npm run release:windows:verify-signatures$/m
  )
  assert.equal(confirmationGate >= 0, true)
  assert.equal(confirmationGate < credentialGate, true)
  assert.equal(credentialGate < dependencyInstall, true)
  assert.equal(credentialGate < installerBuild, true)
  assert.equal(signatureGate < assetPreparation, true)
  assertImmediateNamedStepOrder(source, [
    'Build NSIS installer',
    'Verify stable release signatures',
    'Smoke test packaged ShellPilot app'
  ])
}

test('stable Windows releases require credentials and verify both signatures', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')

  assertStableWindowsReleaseSigningWorkflow(source)
})

test('rejects a signature gate without its own stable condition', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const mutated = source.replace(
    /( {6}- name: Verify stable release signatures\r?\n) {8}if: \$\{\{ github\.event\.inputs\.release_channel == 'stable' \}\}\r?\n/,
    '$1'
  )

  assert.notEqual(mutated, source)
  assert.throws(() => assertStableWindowsReleaseSigningWorkflow(mutated))
})

test('rejects a named step between the installer build and signature gate', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const signatureStep = '      - name: Verify stable release signatures'
  const mutated = source.replace(
    signatureStep,
    [
      '      - name: Unexpected intervening step',
      '        run: echo unexpected',
      '',
      signatureStep
    ].join('\n')
  )

  assert.notEqual(mutated, source)
  assert.throws(() => assertStableWindowsReleaseSigningWorkflow(mutated))
})

test('the signing credential gate applies only to stable releases', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const credentialGate = source.indexOf(
    'name: Require Windows signing credentials for stable release'
  )
  const dependencyInstall = source.indexOf(
    'name: Install dependencies and rebuild native modules'
  )
  const credentialStep = source.slice(credentialGate, dependencyInstall)

  assert.equal(credentialGate >= 0, true)
  assert.match(
    credentialStep,
    /if: \$\{\{ github\.event\.inputs\.release_channel == 'stable' \}\}/
  )
})
