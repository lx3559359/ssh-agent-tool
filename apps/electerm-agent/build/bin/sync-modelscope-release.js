const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  buildValidatedLocalUpdateAssets,
  createSpawnOptions
} = require('./github-release-utils')
const {
  modelScopeRepo
} = require('../../src/app/common/update-sources')
const { assertCurrentReleaseBaseline } = require('./release-version-baseline')
const {
  verifyLocalReleaseArtifacts
} = require('./verify-local-release-assets')

const distDir = process.env.AIGSHELL_RELEASE_DIST ||
  path.resolve(__dirname, '../../dist')
const defaultCloneDir = path.resolve(
  __dirname,
  '../../../../.artifacts/modelscope/ShellPilot-Updates'
)

function buildModelScopeRepoUrl (repo = modelScopeRepo) {
  return `https://www.modelscope.cn/${repo}.git`
}

function ensureModelScopeToken (env = process.env) {
  const token = env.MODELSCOPE_TOKEN || env.MODELSCOPE_API_TOKEN || env.MODELSCOPE_SDK_TOKEN
  if (!token) {
    throw new Error('MODELSCOPE_TOKEN is required to push ShellPilot update assets to ModelScope.')
  }
  return token
}

function resolveModelScopeReleaseVersion (env = process.env, fallback = pack.version) {
  return env.AIGSHELL_RELEASE_VERSION || fallback
}

function getModelScopeAskPassContent ({ isWindows = process.platform === 'win32' } = {}) {
  if (isWindows) {
    return [
      '@echo off',
      'echo %~1 | findstr /I "Username" >nul',
      'if %errorlevel%==0 (',
      '  echo %MODELSCOPE_USERNAME%',
      ') else (',
      '  echo %MODELSCOPE_TOKEN%',
      ')',
      ''
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) printf "%s\\n" "$MODELSCOPE_USERNAME" ;;',
    '  *) printf "%s\\n" "$MODELSCOPE_TOKEN" ;;',
    'esac',
    ''
  ].join('\n')
}

function buildModelScopeGitEnv ({
  askPassPath,
  token,
  username,
  baseEnv = process.env
}) {
  return {
    ...baseEnv,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: askPassPath,
    MODELSCOPE_USERNAME: username,
    MODELSCOPE_TOKEN: token
  }
}

function readLocalFiles (dir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs.readdirSync(dir).map(name => ({
    name,
    size: fs.statSync(path.join(dir, name)).size
  }))
}

function buildModelScopeAssetCopyPlan ({
  distDir,
  cloneDir,
  version,
  arch,
  localFiles
}) {
  return buildValidatedLocalUpdateAssets({
    distDir,
    localFiles: localFiles || readLocalFiles(distDir),
    version,
    arch
  }).map(filePath => ({
    from: filePath,
    to: path.join(cloneDir, path.basename(filePath))
  }))
}

function run (command, args, options = {}) {
  const result = spawnSync(command, args, createSpawnOptions(options))
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} failed`)
  }
  return result
}

function writeAskPassFile () {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh'
  const askPassPath = path.join(os.tmpdir(), `shellpilot-modelscope-askpass-${Date.now()}${extension}`)
  fs.writeFileSync(askPassPath, getModelScopeAskPassContent())
  if (process.platform !== 'win32') {
    fs.chmodSync(askPassPath, 0o700)
  }
  return askPassPath
}

function syncModelScopeRelease (options = {}) {
  const repo = options.repo || modelScopeRepo
  const repoUrl = options.repoUrl || buildModelScopeRepoUrl(repo)
  const cloneDir = options.cloneDir || defaultCloneDir
  const env = options.env || process.env
  const version = options.version || resolveModelScopeReleaseVersion(env, pack.version)
  const arch = options.arch || env.AIGSHELL_RELEASE_ARCH
  const token = ensureModelScopeToken(env)
  const username = options.username ||
    (env && (env.MODELSCOPE_USERNAME || env.MODELSCOPE_USER)) ||
    repo.split('/')[0]
  const askPassPath = writeAskPassFile()
  const gitEnv = buildModelScopeGitEnv({
    askPassPath,
    token,
    username,
    baseEnv: env
  })

  try {
    if (!fs.existsSync(path.join(cloneDir, '.git'))) {
      fs.mkdirSync(path.dirname(cloneDir), { recursive: true })
      run('git', ['clone', repoUrl, cloneDir], { env: gitEnv })
    }

    const copyPlan = buildModelScopeAssetCopyPlan({
      distDir: options.distDir || distDir,
      cloneDir,
      version,
      arch
    })
    copyPlan.forEach(item => fs.copyFileSync(item.from, item.to))

    run('git', ['-C', cloneDir, 'config', 'user.name', username], { env: gitEnv })
    run('git', ['-C', cloneDir, 'config', 'user.email', `${username}@users.noreply.modelscope.cn`], { env: gitEnv })
    run('git', ['-C', cloneDir, 'lfs', 'track', '*.exe'], { env: gitEnv })
    run('git', ['-C', cloneDir, 'add', '--', '.gitattributes', ...copyPlan.map(item => path.basename(item.to))], { env: gitEnv })

    const status = run('git', ['-C', cloneDir, 'status', '--porcelain'], {
      env: gitEnv,
      stdio: 'pipe',
      encoding: 'utf8'
    }).stdout.trim()
    if (status) {
      run('git', ['-C', cloneDir, 'commit', '-m', `发布 ShellPilot ${version} 更新资产`], { env: gitEnv })
    } else {
      console.log(`ModelScope release assets for ${version} are already staged in ${cloneDir}.`)
    }

    run('git', ['-C', cloneDir, 'push', 'origin', 'master'], { env: gitEnv })
    return {
      cloneDir,
      copied: copyPlan.map(item => path.basename(item.to)),
      repoUrl,
      version
    }
  } finally {
    fs.rmSync(askPassPath, { force: true })
  }
}

function main () {
  assertCurrentReleaseBaseline()
  verifyLocalReleaseArtifacts({
    distDir,
    version: resolveModelScopeReleaseVersion(),
    updateOnly: true,
    skipPackageVersion: true
  })
  const result = syncModelScopeRelease()
  console.log(`ModelScope ShellPilot ${result.version} update assets synced.`)
  result.copied.forEach(name => console.log(`- ${name}`))
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error(err.message || err)
    process.exit(1)
  }
}

module.exports = {
  buildModelScopeAssetCopyPlan,
  buildModelScopeGitEnv,
  buildModelScopeRepoUrl,
  ensureModelScopeToken,
  getModelScopeAskPassContent,
  resolveModelScopeReleaseVersion,
  syncModelScopeRelease
}
