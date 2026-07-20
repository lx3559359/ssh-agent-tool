const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

function parseVersion (value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    throw new Error(`无法识别版本号：${value || '<empty>'}`)
  }
  return match.slice(1).map(Number)
}

function compareVersions (left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1
    }
  }
  return 0
}

function assertVersionBaselineState (state) {
  if (compareVersions(state.currentVersion, state.baselineVersion) < 0) {
    throw new Error(
      `检测到旧版本构建：当前为 ${state.currentVersion}，` +
      `${state.baselineRef} 基线为 ${state.baselineVersion}。` +
      '禁止从旧版本生成客户端，请先切换或同步到最新主分支。'
    )
  }
  if (!state.baselineIsAncestor) {
    throw new Error(
      `当前分支 ${state.currentRef || '<detached>'} 不包含发布基线 ` +
      `${state.baselineRef}。禁止构建，请先同步最新代码再重试。`
    )
  }
  return state
}

function runGit (args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function hasGitRef (ref, cwd) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd,
    windowsHide: true,
    stdio: 'ignore'
  }).status === 0
}

function resolveBaselineRef (cwd, env = process.env) {
  const requested = String(env.SHELLPILOT_BASELINE_REF || '').trim()
  const candidates = requested ? [requested] : ['origin/master', 'master']
  const baselineRef = candidates.find(ref => hasGitRef(ref, cwd))
  if (!baselineRef) {
    throw new Error('无法找到 origin/master 或 master 版本基线，已停止构建。')
  }
  return baselineRef
}

function readPackageVersion (content, label) {
  try {
    return JSON.parse(content).version
  } catch (error) {
    throw new Error(`无法读取 ${label} 的 package.json 版本：${error.message}`)
  }
}

function inspectCurrentReleaseBaseline (options = {}) {
  const appRoot = options.appRoot || path.resolve(__dirname, '../..')
  const repoRoot = runGit(['rev-parse', '--show-toplevel'], appRoot)
  const packagePath = path.join(appRoot, 'package.json')
  const packageRelativePath = path.relative(repoRoot, packagePath).replace(/\\/g, '/')
  const baselineRef = options.baselineRef || resolveBaselineRef(repoRoot, options.env)
  const currentVersion = readPackageVersion(fs.readFileSync(packagePath, 'utf8'), '当前工作区')
  const baselineVersion = readPackageVersion(
    runGit(['show', `${baselineRef}:${packageRelativePath}`], repoRoot),
    baselineRef
  )
  const baselineIsAncestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', baselineRef, 'HEAD'],
    { cwd: repoRoot, windowsHide: true, stdio: 'ignore' }
  ).status === 0
  const currentRef = runGit(['branch', '--show-current'], repoRoot) || runGit(['rev-parse', '--short', 'HEAD'], repoRoot)

  return {
    currentVersion,
    baselineVersion,
    baselineRef,
    baselineIsAncestor,
    currentRef,
    repoRoot
  }
}

function assertCurrentReleaseBaseline (options = {}) {
  const state = assertVersionBaselineState(inspectCurrentReleaseBaseline(options))
  if (!options.silent) {
    console.log(`[版本基线] ${state.currentVersion} / ${state.baselineRef} ${state.baselineVersion} / ${state.currentRef}`)
  }
  return state
}

if (require.main === module) {
  assertCurrentReleaseBaseline()
}

module.exports = {
  assertCurrentReleaseBaseline,
  assertVersionBaselineState,
  compareVersions,
  inspectCurrentReleaseBaseline,
  parseVersion,
  resolveBaselineRef
}
