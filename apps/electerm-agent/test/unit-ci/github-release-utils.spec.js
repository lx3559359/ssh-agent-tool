const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildReleaseTag,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
} = require(path.resolve(__dirname, '../../build/bin/github-release-utils'))

test('builds a stable GitHub release tag from package version', () => {
  assert.equal(buildReleaseTag('3.15.105'), 'v3.15.105')
  assert.equal(buildReleaseTag('v3.15.105'), 'v3.15.105')
})

test('selects only AIGShell Windows update assets from dist files', () => {
  const files = [
    'AIGShell-3.15.105-win-x64-installer.exe',
    'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
    'latest.yml',
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
      'latest.yml'
    ]
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
      'dist/latest.yml'
    ]
  })

  assert.deepEqual(commands, [
    ['gh', ['release', 'view', 'v3.15.105', '--repo', 'lx3559359/ssh-agent-tool']],
    ['gh', ['release', 'create', 'v3.15.105', '--repo', 'lx3559359/ssh-agent-tool', '--title', 'AIGShell v3.15.105', '--notes', 'AIGShell Windows release']],
    ['gh', ['release', 'upload', 'v3.15.105', 'dist/AIGShell-3.15.105-win-x64-installer.exe', 'dist/AIGShell-3.15.105-win-x64-installer.exe.blockmap', 'dist/latest.yml', '--repo', 'lx3559359/ssh-agent-tool', '--clobber']]
  ])
})

test('uses direct spawn options so gh arguments with spaces stay intact on Windows', () => {
  assert.deepEqual(createSpawnOptions({ stdio: 'ignore' }), {
    stdio: 'ignore',
    shell: false
  })
})
