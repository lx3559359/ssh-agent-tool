const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflowPath = path.resolve(
  __dirname,
  '../../../../.github/workflows/windows-electerm-agent-release.yml'
)

test('stable Windows releases require credentials and verify both signatures', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
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
  const packageSmoke = source.indexOf(
    'name: Smoke test packaged ShellPilot app'
  )
  const assetPreparation = source.indexOf(
    'name: Prepare approved online update assets'
  )

  assert.match(source, /CSC_LINK: \$\{\{ secrets\.WINDOWS_CSC_LINK \}\}/)
  assert.match(source, /CSC_KEY_PASSWORD: \$\{\{ secrets\.WINDOWS_CSC_KEY_PASSWORD \}\}/)
  assert.match(source, /release_channel == 'stable'/)
  assert.match(source, /run: npm run release:windows:verify-signatures/)
  assert.equal(confirmationGate >= 0, true)
  assert.equal(confirmationGate < credentialGate, true)
  assert.equal(credentialGate < dependencyInstall, true)
  assert.equal(credentialGate < installerBuild, true)
  assert.equal(installerBuild < signatureGate, true)
  assert.equal(signatureGate < packageSmoke, true)
  assert.equal(signatureGate < assetPreparation, true)
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
