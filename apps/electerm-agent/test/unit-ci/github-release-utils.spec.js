const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildLocalReleaseAssetReport,
  buildReleaseTag,
  buildReleaseAssetReport,
  buildValidatedLocalReleaseAssets,
  getRequiredReleaseAssetNames,
  selectUnexpectedReleaseAssets,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
} = require(path.resolve(__dirname, '../../build/bin/github-release-utils'))
const {
  buildUpdateApprovalManifest,
  validateUpdateApprovalManifest
} = require(path.resolve(__dirname, '../../build/bin/write-update-approval-manifest'))

test('windows release workflow publishes only online update assets', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  assert.doesNotMatch(workflow, /apps\/electerm-agent\/dist\/\*\*\/\*/)
  assert.match(workflow, /apps\/electerm-agent\/dist\/AIGShell-\*-win-x64-installer\.exe/)
  assert.match(workflow, /apps\/electerm-agent\/dist\/AIGShell-\*-win-x64-installer\.exe\.blockmap/)
  assert.match(workflow, /apps\/electerm-agent\/dist\/latest\.yml/)
  assert.match(workflow, /apps\/electerm-agent\/dist\/aigshell-update\.json/)
})

test('windows release workflow smoke tests the packaged app before uploading artifacts', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const installerBuildIndex = workflow.indexOf('name: Build NSIS installer')
  const smokeTestIndex = workflow.indexOf('npm run test-package-smoke')
  const artifactUploadIndex = workflow.indexOf('name: Upload Windows artifacts')

  assert.ok(installerBuildIndex !== -1, 'workflow should build the NSIS installer')
  assert.ok(smokeTestIndex !== -1, 'workflow should run the packaged app smoke test')
  assert.ok(artifactUploadIndex !== -1, 'workflow should upload Windows artifacts')
  assert.ok(smokeTestIndex > installerBuildIndex, 'smoke test should run after the packaged app is built')
  assert.ok(smokeTestIndex < artifactUploadIndex, 'smoke test should run before release artifacts are uploaded')
})

test('windows release workflow runs unit tests before packaging', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const dependencyInstallIndex = workflow.indexOf('name: Install dependencies and rebuild native modules')
  const unitTestIndex = workflow.indexOf('npm run test-unit-ci')
  const rendererBuildIndex = workflow.indexOf('name: Build renderer and prepare packaged app')
  const installerBuildIndex = workflow.indexOf('name: Build NSIS installer')

  assert.ok(dependencyInstallIndex !== -1, 'workflow should install dependencies before testing')
  assert.ok(unitTestIndex !== -1, 'workflow should run unit tests')
  assert.ok(rendererBuildIndex !== -1, 'workflow should build the renderer')
  assert.ok(installerBuildIndex !== -1, 'workflow should build the installer')
  assert.ok(unitTestIndex > dependencyInstallIndex, 'unit tests should run after dependencies are installed')
  assert.ok(unitTestIndex < rendererBuildIndex, 'unit tests should run before renderer packaging begins')
  assert.ok(unitTestIndex < installerBuildIndex, 'unit tests should run before installer packaging begins')
})

test('windows release workflow enables ssh-agent before unit tests', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const sshAgentIndex = workflow.indexOf('Start-Service ssh-agent')
  const unitTestIndex = workflow.indexOf('npm run test-unit-ci')

  assert.ok(sshAgentIndex !== -1, 'release workflow should start the Windows ssh-agent service')
  assert.ok(unitTestIndex !== -1, 'release workflow should run unit tests')
  assert.ok(sshAgentIndex < unitTestIndex, 'ssh-agent service should start before unit tests')
})

test('windows release workflow verifies local update assets before upload', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const localVerifyIndex = workflow.indexOf('npm run release:local:verify')
  const approvalManifestIndex = workflow.indexOf('npm run release:approval')
  const portableBuildIndex = workflow.indexOf('name: Build portable package')
  const artifactUploadIndex = workflow.indexOf('name: Upload Windows artifacts')

  assert.ok(localVerifyIndex !== -1, 'workflow should verify local release assets')
  assert.ok(approvalManifestIndex !== -1, 'workflow should create the approval manifest')
  assert.ok(portableBuildIndex !== -1, 'workflow should build the portable package')
  assert.ok(artifactUploadIndex !== -1, 'workflow should upload Windows artifacts')
  assert.ok(approvalManifestIndex > portableBuildIndex, 'approval manifest should be created after all package builds')
  assert.ok(approvalManifestIndex < localVerifyIndex, 'approval manifest should be created before local release verification')
  assert.ok(localVerifyIndex > portableBuildIndex, 'local release verification should run after all package builds')
  assert.ok(localVerifyIndex < artifactUploadIndex, 'local release verification should run before artifacts are uploaded')
})

test('windows release workflow builds and publishes a portable zip separately from update assets', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const portableBuildIndex = workflow.indexOf('name: Build portable package')
  const localVerifyIndex = workflow.indexOf('npm run release:local:verify')
  const artifactUploadIndex = workflow.indexOf('name: Upload Windows artifacts')
  const releaseIndex = workflow.indexOf('name: Create draft GitHub Release after manual confirmation')

  assert.match(workflow, /AIGShell-\*-win-x64-portable\.zip/)
  assert.match(workflow, /npx electron-builder --win zip --publish never/)
  assert.ok(portableBuildIndex !== -1, 'workflow should build the portable package')
  assert.ok(localVerifyIndex !== -1, 'workflow should verify update assets')
  assert.ok(artifactUploadIndex !== -1, 'workflow should upload artifacts')
  assert.ok(releaseIndex !== -1, 'workflow should create a draft release')
  assert.ok(portableBuildIndex < localVerifyIndex, 'portable zip should be built before verification')
  assert.ok(localVerifyIndex < artifactUploadIndex, 'verification should run before artifact upload')
  assert.ok(artifactUploadIndex < releaseIndex, 'artifacts should be prepared before release creation')
})

test('windows release workflow requires an explicit manual stable release confirmation', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /release_channel:/)
  assert.match(workflow, /options:\s*\n\s+- stable\s*\n\s+- beta/)
  assert.match(workflow, /confirm_stable_release:/)
  assert.match(workflow, /type:\s+string/)
  assert.match(workflow, /AIGShell stable release/)
  assert.doesNotMatch(workflow, /push:\s*\n\s+tags:/)
  assert.match(workflow, /github\.event\.inputs\.release_channel/)
  assert.match(workflow, /github\.event\.inputs\.confirm_stable_release/)
  assert.match(workflow, /发布确认失败/)
  assert.match(workflow, /AIGSHELL_UPDATE_CHANNEL/)
  assert.match(workflow, /id:\s+package-version/)
  assert.match(workflow, /tag=v\$version/)
  assert.match(workflow, /tag_name:\s+\$\{\{ steps\.package-version\.outputs\.tag \}\}/)
})

test('windows release workflow verifies the portable zip contents before upload', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-release.yml'),
    'utf8'
  )

  const portableBuildIndex = workflow.indexOf('name: Build portable package')
  const portableVerifyIndex = workflow.indexOf('npm run verify-win-portable')
  const artifactUploadIndex = workflow.indexOf('name: Upload Windows artifacts')

  assert.ok(portableBuildIndex !== -1, 'workflow should build the portable package')
  assert.ok(portableVerifyIndex !== -1, 'workflow should verify the portable package')
  assert.ok(artifactUploadIndex !== -1, 'workflow should upload artifacts')
  assert.ok(portableVerifyIndex > portableBuildIndex, 'portable zip should be verified after it is built')
  assert.ok(portableVerifyIndex < artifactUploadIndex, 'portable zip should be verified before upload')
})

test('portable zip is not required for online update asset validation', () => {
  const names = getRequiredReleaseAssetNames('3.15.105')

  assert.deepEqual(names, [
    'AIGShell-3.15.105-win-x64-installer.exe',
    'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
    'latest.yml',
    'aigshell-update.json'
  ])
  assert.equal(names.some(name => name.includes('portable.zip')), false)
})

test('local Windows portable build scripts create zip packages', () => {
  const ciSource = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/prepare-win-portable-ci.js'),
    'utf8'
  )
  const localSource = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/build-win-portable.js'),
    'utf8'
  )

  assert.match(ciSource, /win-x64-portable\.zip/)
  assert.match(ciSource, /config\.win\.target\s*=\s*\['zip'\]/)
  assert.match(localSource, /win-x64-portable\.zip/)
  assert.match(localSource, /--win zip/)
  assert.doesNotMatch(localSource, /win-x64-portable\.tar\.gz/)
})

test('release verification scripts accept an explicit Windows release architecture', () => {
  const localVerifySource = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/verify-local-release-assets.js'),
    'utf8'
  )
  const githubVerifySource = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/verify-github-release.js'),
    'utf8'
  )

  assert.match(localVerifySource, /AIGSHELL_RELEASE_ARCH/)
  assert.match(localVerifySource, /buildLocalReleaseAssetReport\(\{[\s\S]*arch:\s*releaseArch/s)
  assert.match(githubVerifySource, /AIGSHELL_RELEASE_ARCH/)
  assert.match(githubVerifySource, /getRequiredReleaseAssetNames\(pack\.version,\s*\{[\s\S]*arch:\s*releaseArch/s)
  assert.match(githubVerifySource, /buildReleaseAssetReport\(\{[\s\S]*arch:\s*releaseArch/s)
})

test('local release verification validates the update approval manifest content', () => {
  const localVerifySource = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/verify-local-release-assets.js'),
    'utf8'
  )

  assert.match(localVerifySource, /validateUpdateApprovalManifest/)
  assert.match(localVerifySource, /aigshell-update\.json/)
  assert.match(localVerifySource, /pack\.version/)
  assert.match(localVerifySource, /AIGSHELL_UPDATE_CHANNEL/)
  assert.match(localVerifySource, /channel:\s*releaseChannel/)
})

test('windows ci workflow runs unit tests for normal code changes without publishing', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-ci.yml'),
    'utf8'
  )

  assert.match(workflow, /push:/)
  assert.match(workflow, /branches:\s*\n\s+- master/)
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /node-version:\s*"22"/)
  assert.match(workflow, /cache-dependency-path:\s+apps\/electerm-agent\/package-lock\.json/)
  assert.match(workflow, /working-directory:\s+apps\/electerm-agent/)
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm run test-unit-ci/)
  assert.doesNotMatch(workflow, /softprops\/action-gh-release/)
  assert.doesNotMatch(workflow, /electron-builder --win/)
  assert.doesNotMatch(workflow, /upload-artifact/)
})

test('windows ci workflow enables ssh-agent before unit tests', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '../../../../.github/workflows/windows-electerm-agent-ci.yml'),
    'utf8'
  )

  const sshAgentIndex = workflow.indexOf('Start-Service ssh-agent')
  const unitTestIndex = workflow.indexOf('npm run test-unit-ci')

  assert.ok(sshAgentIndex !== -1, 'ci workflow should start the Windows ssh-agent service')
  assert.ok(unitTestIndex !== -1, 'ci workflow should run unit tests')
  assert.ok(sshAgentIndex < unitTestIndex, 'ssh-agent service should start before unit tests')
})

test('builds a stable GitHub release tag from package version', () => {
  assert.equal(buildReleaseTag('3.15.105'), 'v3.15.105')
  assert.equal(buildReleaseTag('v3.15.105'), 'v3.15.105')
})

test('builds the stable update approval manifest required by clients', () => {
  assert.deepEqual(
    {
      ...buildUpdateApprovalManifest('3.15.105'),
      generatedAt: '<dynamic>'
    },
    {
      product: 'AIGShell',
      channel: 'stable',
      publishApproved: true,
      version: '3.15.105',
      generatedAt: '<dynamic>'
    }
  )
})

test('builds and validates beta update approval manifests for prerelease channel', () => {
  assert.deepEqual(
    {
      ...buildUpdateApprovalManifest('3.15.106-beta.1', { channel: 'beta' }),
      generatedAt: '<dynamic>'
    },
    {
      product: 'AIGShell',
      channel: 'beta',
      publishApproved: true,
      version: '3.15.106-beta.1',
      generatedAt: '<dynamic>'
    }
  )

  assert.doesNotThrow(() => validateUpdateApprovalManifest({
    product: 'AIGShell',
    channel: 'beta',
    publishApproved: true,
    version: '3.15.106-beta.1',
    generatedAt: '2026-07-09T00:00:00.000Z'
  }, '3.15.106-beta.1', { channel: 'beta' }))
})

test('validates update approval manifest content before release upload', () => {
  assert.doesNotThrow(() => validateUpdateApprovalManifest({
    product: 'AIGShell',
    channel: 'stable',
    publishApproved: true,
    version: '3.15.105',
    generatedAt: '2026-07-09T00:00:00.000Z'
  }, '3.15.105'))

  assert.throws(
    () => validateUpdateApprovalManifest({
      product: 'AIGShell',
      channel: 'beta',
      publishApproved: true,
      version: '3.15.105'
    }, '3.15.105'),
    /stable/
  )

  assert.throws(
    () => validateUpdateApprovalManifest({
      product: 'AIGShell',
      channel: 'stable',
      publishApproved: false,
      version: '3.15.105'
    }, '3.15.105'),
    /publishApproved/
  )

  assert.throws(
    () => validateUpdateApprovalManifest({
      product: 'AIGShell',
      channel: 'stable',
      publishApproved: true,
      version: '3.15.104'
    }, '3.15.105'),
    /version/
  )
})

test('selects only AIGShell Windows update assets from dist files', () => {
  const files = [
    'AIGShell-3.15.105-win-x64-installer.exe',
    'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
    'latest.yml',
    'aigshell-update.json',
    'builder-debug.yml',
    'SSH-Agent-Tool-3.15.105-win-x64-installer.exe',
    'win-unpacked',
    'v3.15.105'
  ]

  assert.deepEqual(
    selectReleaseAssets(files, '3.15.105'),
    [
      'AIGShell-3.15.105-win-x64-installer.exe',
      'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
      'latest.yml',
      'aigshell-update.json'
    ]
  )
})

test('identifies the exact release assets required for Windows online updates', () => {
  assert.deepEqual(
    getRequiredReleaseAssetNames('3.15.105'),
    [
      'AIGShell-3.15.105-win-x64-installer.exe',
      'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
      'latest.yml',
      'aigshell-update.json'
    ]
  )
})

test('identifies Windows ARM64 release assets when requested', () => {
  assert.deepEqual(
    getRequiredReleaseAssetNames('3.15.105', { arch: 'arm64' }),
    [
      'AIGShell-3.15.105-win-arm64-installer.exe',
      'AIGShell-3.15.105-win-arm64-installer.exe.blockmap',
      'latest.yml',
      'aigshell-update.json'
    ]
  )
})

test('selects only Windows ARM64 update assets when requested', () => {
  const files = [
    'AIGShell-3.15.105-win-x64-installer.exe',
    'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
    'AIGShell-3.15.105-win-arm64-installer.exe',
    'AIGShell-3.15.105-win-arm64-installer.exe.blockmap',
    'latest.yml',
    'aigshell-update.json'
  ]

  assert.deepEqual(
    selectReleaseAssets(files, '3.15.105', { arch: 'arm64' }),
    [
      'AIGShell-3.15.105-win-arm64-installer.exe',
      'AIGShell-3.15.105-win-arm64-installer.exe.blockmap',
      'latest.yml',
      'aigshell-update.json'
    ]
  )
})

test('selects unexpected release assets without deleting update files', () => {
  const assets = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', id: 'installer' },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', id: 'blockmap' },
    { name: 'latest.yml', id: 'latest' },
    { name: 'AIGShell.exe', id: 'loose-exe' },
    { name: 'app.asar', id: 'asar' },
    { name: 'windows-electerm-agent.yml', id: 'legacy-channel' }
  ]

  assert.deepEqual(
    selectUnexpectedReleaseAssets(assets, '3.15.105'),
    [
      { name: 'AIGShell.exe', id: 'loose-exe' },
      { name: 'app.asar', id: 'asar' },
      { name: 'windows-electerm-agent.yml', id: 'legacy-channel' }
    ]
  )
})

test('builds a release asset report for local and remote update files', () => {
  const localFiles = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 100 },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', size: 10 },
    { name: 'latest.yml', size: 3 },
    { name: 'aigshell-update.json', size: 88 }
  ]
  const remoteAssets = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 100 },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', size: 9 },
    { name: 'aigshell-update.json', size: 88 },
    { name: 'AIGShell.exe', size: 200 }
  ]

  assert.deepEqual(
    buildReleaseAssetReport({
      localFiles,
      remoteAssets,
      version: '3.15.105'
    }),
    {
      requiredNames: [
        'AIGShell-3.15.105-win-x64-installer.exe',
        'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
        'latest.yml',
        'aigshell-update.json'
      ],
      missingLocal: [],
      missingRemote: ['latest.yml'],
      sizeMismatches: [
        {
          name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
          localSize: 10,
          remoteSize: 9
        }
      ],
      unexpectedRemote: [
        { name: 'AIGShell.exe', size: 200 }
      ],
      ok: false
    }
  )
})

test('reports ok when local and remote update assets match exactly', () => {
  const files = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 100 },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', size: 10 },
    { name: 'latest.yml', size: 3 },
    { name: 'aigshell-update.json', size: 88 }
  ]

  assert.equal(
    buildReleaseAssetReport({
      localFiles: files,
      remoteAssets: files,
      version: '3.15.105'
    }).ok,
    true
  )
})

test('reports local update assets as valid only when all required files are present and non-empty', () => {
  const files = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 100 },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', size: 10 },
    { name: 'latest.yml', size: 3 },
    { name: 'aigshell-update.json', size: 88 },
    { name: 'win-unpacked', size: 0 }
  ]

  assert.deepEqual(
    buildLocalReleaseAssetReport({
      localFiles: files,
      version: '3.15.105'
    }),
    {
      requiredNames: [
        'AIGShell-3.15.105-win-x64-installer.exe',
        'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
        'latest.yml',
        'aigshell-update.json'
      ],
      missingLocal: [],
      emptyLocal: [],
      ok: true
    }
  )
})

test('reports missing and empty local update assets before upload', () => {
  const files = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 0 },
    { name: 'latest.yml', size: 3 }
  ]

  assert.deepEqual(
    buildLocalReleaseAssetReport({
      localFiles: files,
      version: '3.15.105'
    }),
    {
      requiredNames: [
        'AIGShell-3.15.105-win-x64-installer.exe',
        'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
        'latest.yml',
        'aigshell-update.json'
      ],
      missingLocal: [
        'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
        'aigshell-update.json'
      ],
      emptyLocal: ['AIGShell-3.15.105-win-x64-installer.exe'],
      ok: false
    }
  )
})

test('builds validated local release asset paths only when update files are ready', () => {
  const goodFiles = [
    { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 100 },
    { name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap', size: 10 },
    { name: 'latest.yml', size: 3 },
    { name: 'aigshell-update.json', size: 88 }
  ]

  assert.deepEqual(
    buildValidatedLocalReleaseAssets({
      distDir: 'dist',
      localFiles: goodFiles,
      version: '3.15.105'
    }),
    [
      path.join('dist', 'AIGShell-3.15.105-win-x64-installer.exe'),
      path.join('dist', 'AIGShell-3.15.105-win-x64-installer.exe.blockmap'),
      path.join('dist', 'latest.yml'),
      path.join('dist', 'aigshell-update.json')
    ]
  )

  assert.throws(
    () => buildValidatedLocalReleaseAssets({
      distDir: 'dist',
      localFiles: [
        { name: 'AIGShell-3.15.105-win-x64-installer.exe', size: 0 },
        { name: 'latest.yml', size: 3 }
      ],
      version: '3.15.105'
    }),
    /缺少本地发布文件.*AIGShell-3\.15\.105-win-x64-installer\.exe\.blockmap.*本地发布文件为空.*AIGShell-3\.15\.105-win-x64-installer\.exe/s
  )
})

test('creates deterministic gh commands for release create and upload', () => {
  const commands = buildGitHubReleaseCommands({
    repo: 'lx3559359/ssh-agent-tool',
    tag: 'v3.15.105',
    title: 'AIGShell v3.15.105',
    notes: 'AIGShell Windows release',
    assets: [
      'dist/AIGShell-3.15.105-win-x64-installer.exe',
      'dist/AIGShell-3.15.105-win-x64-installer.exe.blockmap',
      'dist/latest.yml',
      'dist/aigshell-update.json'
    ]
  })

  assert.deepEqual(commands, [
    ['gh', ['release', 'view', 'v3.15.105', '--repo', 'lx3559359/ssh-agent-tool']],
    ['gh', ['release', 'create', 'v3.15.105', '--repo', 'lx3559359/ssh-agent-tool', '--title', 'AIGShell v3.15.105', '--notes', 'AIGShell Windows release']],
    ['gh', ['release', 'upload', 'v3.15.105', 'dist/AIGShell-3.15.105-win-x64-installer.exe', 'dist/AIGShell-3.15.105-win-x64-installer.exe.blockmap', 'dist/latest.yml', 'dist/aigshell-update.json', '--repo', 'lx3559359/ssh-agent-tool', '--clobber']]
  ])
})

test('uses direct spawn options so gh arguments with spaces stay intact on Windows', () => {
  assert.deepEqual(createSpawnOptions({ stdio: 'ignore' }), {
    stdio: 'ignore',
    shell: false
  })
})
