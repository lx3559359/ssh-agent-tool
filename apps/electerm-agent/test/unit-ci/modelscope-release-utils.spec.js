const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const {
  buildModelScopeAssetCopyPlan,
  buildModelScopeGitEnv,
  buildModelScopeRepoUrl,
  ensureModelScopeToken,
  getModelScopeAskPassContent,
  resolveModelScopeReleaseVersion
} = require(path.resolve(__dirname, '../../build/bin/sync-modelscope-release'))

test('ModelScope release sync requires an explicit token before pushing', () => {
  assert.throws(
    () => ensureModelScopeToken({}),
    /MODELSCOPE_TOKEN/
  )
  assert.equal(ensureModelScopeToken({ MODELSCOPE_TOKEN: 'ms-secret' }), 'ms-secret')
})

test('ModelScope release sync copies every approved update asset including legacy channel metadata', () => {
  const plan = buildModelScopeAssetCopyPlan({
    distDir: 'dist',
    cloneDir: 'mirror',
    version: '3.15.105',
    localFiles: [
      { name: 'ShellPilot-3.15.105-win-x64-installer.exe', size: 100 },
      { name: 'ShellPilot-3.15.105-win-x64-installer.exe.blockmap', size: 10 },
      { name: 'latest.yml', size: 3 },
      { name: 'shellpilot-local.yml', size: 3 },
      { name: 'aigshell-update.json', size: 88 },
      { name: 'shellpilot-update.json', size: 88 },
      { name: 'checksums.json', size: 180 },
      { name: 'shellpilot-release.json', size: 320 }
    ]
  })

  assert.deepEqual(
    plan.map(item => [item.from, item.to]),
    [
      [path.join('dist', 'ShellPilot-3.15.105-win-x64-installer.exe'), path.join('mirror', 'ShellPilot-3.15.105-win-x64-installer.exe')],
      [path.join('dist', 'ShellPilot-3.15.105-win-x64-installer.exe.blockmap'), path.join('mirror', 'ShellPilot-3.15.105-win-x64-installer.exe.blockmap')],
      [path.join('dist', 'latest.yml'), path.join('mirror', 'latest.yml')],
      [path.join('dist', 'shellpilot-local.yml'), path.join('mirror', 'shellpilot-local.yml')],
      [path.join('dist', 'aigshell-update.json'), path.join('mirror', 'aigshell-update.json')],
      [path.join('dist', 'shellpilot-update.json'), path.join('mirror', 'shellpilot-update.json')],
      [path.join('dist', 'checksums.json'), path.join('mirror', 'checksums.json')],
      [path.join('dist', 'shellpilot-release.json'), path.join('mirror', 'shellpilot-release.json')]
    ]
  )
})

test('ModelScope git authentication uses askpass environment without writing the token into the script', () => {
  const askPass = getModelScopeAskPassContent({ isWindows: true })
  assert.match(askPass, /MODELSCOPE_USERNAME/)
  assert.match(askPass, /MODELSCOPE_TOKEN/)
  assert.doesNotMatch(askPass, /ms-secret/)

  const env = buildModelScopeGitEnv({
    askPassPath: 'C:\\Temp\\modelscope-askpass.cmd',
    token: 'ms-secret',
    username: 'lx3559359',
    baseEnv: { PATH: 'C:\\Windows' }
  })
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GIT_ASKPASS, 'C:\\Temp\\modelscope-askpass.cmd')
  assert.equal(env.MODELSCOPE_USERNAME, 'lx3559359')
  assert.equal(env.MODELSCOPE_TOKEN, 'ms-secret')
  assert.equal(env.PATH, 'C:\\Windows')
})

test('ModelScope repo URL targets the domestic update repository', () => {
  assert.equal(
    buildModelScopeRepoUrl('lx3559359/ShellPilot-Updates'),
    'https://www.modelscope.cn/lx3559359/ShellPilot-Updates.git'
  )
})

test('ModelScope release sync can target an explicit published version from CI', () => {
  assert.equal(
    resolveModelScopeReleaseVersion({ AIGSHELL_RELEASE_VERSION: '0.3.5' }, '0.3.4'),
    '0.3.5'
  )
  assert.equal(resolveModelScopeReleaseVersion({}, '0.3.4'), '0.3.4')
})

test('ModelScope release sync prints a concise token error for operators', () => {
  const env = { ...process.env }
  delete env.MODELSCOPE_TOKEN
  delete env.MODELSCOPE_API_TOKEN
  delete env.MODELSCOPE_SDK_TOKEN

  const result = spawnSync(process.execPath, ['build/bin/sync-modelscope-release.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env,
    encoding: 'utf8'
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /MODELSCOPE_TOKEN is required/)
  assert.doesNotMatch(result.stderr, /at ensureModelScopeToken/)
})
