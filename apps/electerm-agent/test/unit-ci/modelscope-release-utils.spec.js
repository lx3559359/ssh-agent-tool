const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

test('ModelScope Hub uploader uses API token file upload instead of git credentials', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/sync-modelscope-release-hub.py'),
    'utf8'
  )
  const pack = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../package.json'),
    'utf8'
  ))

  assert.match(source, /from modelscope_hub import HubApi/)
  assert.match(source, /upload_file/)
  assert.match(source, /MODELSCOPE_TOKEN/)
  assert.doesNotMatch(source, /git push/)
  assert.doesNotMatch(source, /GIT_ASKPASS/)
  assert.equal(
    pack.scripts['release:modelscope:hub'],
    'python build/bin/sync-modelscope-release-hub.py'
  )
})

test('ModelScope Hub uploader retries large asset uploads after transient timeouts', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../build/bin/sync-modelscope-release-hub.py'),
    'utf8'
  )

  assert.match(source, /def upload_file_with_retry/)
  assert.match(source, /MODELSCOPE_UPLOAD_RETRIES/)
  assert.match(source, /time\.sleep/)
  assert.match(source, /upload_file_with_retry\(/)
})

test('ModelScope Hub uploader redacts every accepted token value regardless of token format', () => {
  const modulePath = path.resolve(__dirname, '../../build/bin/sync-modelscope-release-hub.py')
  const script = [
    'import importlib.util, os, sys, types',
    'stub = types.ModuleType("modelscope_hub")',
    'stub.HubApi = object',
    'sys.modules["modelscope_hub"] = stub',
    'spec = importlib.util.spec_from_file_location("shellpilot_modelscope", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'message = " | ".join([os.environ["MODELSCOPE_TOKEN"], os.environ["MODELSCOPE_API_TOKEN"], os.environ["MODELSCOPE_SDK_TOKEN"]])',
    'print(module.redact(RuntimeError(message)))'
  ].join('; ')
  const secrets = ['plain-primary-token', 'ms-secret', 'sdk token with spaces']
  const result = spawnSync('python', ['-c', script, modulePath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      MODELSCOPE_TOKEN: secrets[0],
      MODELSCOPE_API_TOKEN: secrets[1],
      MODELSCOPE_SDK_TOKEN: secrets[2]
    }
  })

  assert.equal(result.status, 0, result.stderr)
  for (const secret of secrets) assert.doesNotMatch(result.stdout, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal((result.stdout.match(/\[REDACTED\]/g) || []).length, 3)
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
