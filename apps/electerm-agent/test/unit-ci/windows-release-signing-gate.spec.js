const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflowPath = path.resolve(
  __dirname,
  '../../../../.github/workflows/windows-electerm-agent-release.yml'
)
const cscLinkMapping = '          CSC_LINK: $' +
  '{{ secrets.WINDOWS_CSC_LINK }}'
const cscPasswordMapping = '          CSC_KEY_PASSWORD: $' +
  '{{ secrets.WINDOWS_CSC_KEY_PASSWORD }}'

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

function extractJobEnvironmentBlock (source) {
  const start = source.indexOf('\n    env:')
  const end = source.indexOf('\n    steps:')

  assert.notEqual(start, -1, 'Missing job environment block')
  assert.notEqual(end, -1, 'Missing workflow steps block')
  assert.equal(start < end, true)
  return source.slice(start, end)
}

function assertSigningSecretsAreStepLocal (stepBlock) {
  assert.match(
    stepBlock,
    /^ {10}CSC_LINK: \$\{\{ secrets\.WINDOWS_CSC_LINK \}\}$/m
  )
  assert.match(
    stepBlock,
    /^ {10}CSC_KEY_PASSWORD: \$\{\{ secrets\.WINDOWS_CSC_KEY_PASSWORD \}\}$/m
  )
}

function assertStableSignatureStep (stepBlock) {
  assert.match(
    stepBlock,
    /^ {8}if: \$\{\{ github\.event\.inputs\.release_channel == 'stable' \}\}$/m
  )
  assert.match(
    stepBlock,
    /^ {8}run: npm run release:windows:verify-signatures$/m
  )
  assert.doesNotMatch(stepBlock, /^ {8}continue-on-error:/m)
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
  const portableSignatureGate = source.indexOf(
    'name: Verify stable release signatures after portable build'
  )
  const assetPreparation = source.indexOf(
    'name: Prepare approved online update assets'
  )
  const artifactUpload = source.indexOf('name: Upload Windows artifacts')
  const releaseCreation = source.indexOf(
    'name: Create draft GitHub Release after manual confirmation'
  )
  const jobEnvironment = extractJobEnvironmentBlock(source)
  const installerBuildStep = extractNamedStepBlock(
    source,
    'Build NSIS installer'
  )
  const portableBuildStep = extractNamedStepBlock(
    source,
    'Build portable package'
  )
  const signatureStep = extractNamedStepBlock(
    source,
    'Verify stable release signatures'
  )
  const portableSignatureStep = extractNamedStepBlock(
    source,
    'Verify stable release signatures after portable build'
  )

  assert.doesNotMatch(jobEnvironment, /^ {6}CSC_LINK:/m)
  assert.doesNotMatch(jobEnvironment, /^ {6}CSC_KEY_PASSWORD:/m)
  assertSigningSecretsAreStepLocal(installerBuildStep)
  assertSigningSecretsAreStepLocal(portableBuildStep)
  assertStableSignatureStep(signatureStep)
  assertStableSignatureStep(portableSignatureStep)
  assert.equal(confirmationGate >= 0, true)
  assert.equal(confirmationGate < credentialGate, true)
  assert.equal(credentialGate < dependencyInstall, true)
  assert.equal(credentialGate < installerBuild, true)
  assert.equal(signatureGate < assetPreparation, true)
  assert.equal(portableSignatureGate < assetPreparation, true)
  assert.equal(portableSignatureGate < artifactUpload, true)
  assert.equal(portableSignatureGate < releaseCreation, true)
  assertImmediateNamedStepOrder(source, [
    'Build NSIS installer',
    'Verify stable release signatures',
    'Smoke test packaged ShellPilot app'
  ])
  assertImmediateNamedStepOrder(source, [
    'Verify portable package',
    'Verify stable release signatures after portable build',
    'Prepare approved online update assets'
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

test('rejects removal of the final portable signature gate', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const finalGate = extractNamedStepBlock(
    source,
    'Verify stable release signatures after portable build'
  )
  const mutated = source.replace(finalGate, '')

  assert.notEqual(mutated, source)
  assert.throws(() => assertStableWindowsReleaseSigningWorkflow(mutated))
})

test('rejects a named build step after the final signature gate', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const assetStep = '      - name: Prepare approved online update assets'
  const mutated = source.replace(
    assetStep,
    [
      '      - name: Unexpected post-signature build',
      '        run: npm run unexpected-build',
      '',
      assetStep
    ].join('\n')
  )

  assert.notEqual(mutated, source)
  assert.throws(() => assertStableWindowsReleaseSigningWorkflow(mutated))
})

test('rejects missing secrets from either packaging step', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const mutations = [
    ['Build NSIS installer', cscLinkMapping],
    ['Build NSIS installer', cscPasswordMapping],
    ['Build portable package', cscLinkMapping],
    ['Build portable package', cscPasswordMapping]
  ]

  for (const [stepName, mapping] of mutations) {
    const stepBlock = extractNamedStepBlock(source, stepName)
    const mutatedStep = stepBlock.replace(mapping, '')
    const mutated = source.replace(stepBlock, mutatedStep)

    assert.notEqual(mutatedStep, stepBlock)
    assert.throws(() => assertStableWindowsReleaseSigningWorkflow(mutated))
  }
})

test('rejects signing credentials in the job environment', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  const mutated = source.replace(
    '      CI: true',
    [
      '      CI: true',
      '      CSC_LINK: $' + '{{ secrets.WINDOWS_CSC_LINK }}'
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
