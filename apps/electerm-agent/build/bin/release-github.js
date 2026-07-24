const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  buildReleaseTag,
  buildValidatedLocalReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions,
  getSpawnStatus,
  assertSpawnSuccess
} = require('./github-release-utils')
const { assertCurrentReleaseBaseline } = require('./release-version-baseline')
const {
  verifyLocalReleaseArtifacts
} = require('./verify-local-release-assets')

const repo = process.env.GITHUB_REPOSITORY || 'lx3559359/ssh-agent-tool'
const distDir = path.resolve(__dirname, '../../dist')
const dryRun = process.argv.includes('--dry-run')
const releaseProductName = pack.productName || 'ShellPilot'
const releaseNotesPath = path.resolve(__dirname, '../../docs/releases', `v${pack.version}.md`)

function getReleaseNotes () {
  return fs.existsSync(releaseNotesPath)
    ? fs.readFileSync(releaseNotesPath, 'utf8').trim()
    : `${releaseProductName} Windows release v${pack.version}`
}

function run (command, args, options = {}, spawn = spawnSync) {
  const result = spawn(command, args, createSpawnOptions(options))
  return getSpawnStatus(result, command, args)
}

function runRequired (command, args, options = {}, spawn = spawnSync) {
  const result = spawn(command, args, createSpawnOptions(options))
  return assertSpawnSuccess(result, command, args)
}

function executeGitHubReleaseCommands (commands, spawn = spawnSync) {
  const [view, create, edit, upload, publish] = commands
  const exists = run(view[0], view[1], { stdio: 'ignore' }, spawn) === 0
  const prepare = exists ? edit : create
  runRequired(prepare[0], prepare[1], {}, spawn)
  runRequired(upload[0], upload[1], {}, spawn)
  runRequired(publish[0], publish[1], {}, spawn)
}

function main () {
  assertCurrentReleaseBaseline()
  verifyLocalReleaseArtifacts()
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist 目录不存在，请先运行 Windows 打包：${distDir}`)
  }

  const localFiles = fs.readdirSync(distDir).map(name => ({
    name,
    size: fs.statSync(path.join(distDir, name)).size
  }))
  const assets = buildValidatedLocalReleaseAssets({
    distDir,
    localFiles,
    version: pack.version
  })
  const tag = buildReleaseTag(pack.version)
  const commands = buildGitHubReleaseCommands({
    repo,
    tag,
    title: `${releaseProductName} ${tag}`,
    notes: getReleaseNotes(),
    assets
  })

  if (dryRun) {
    commands.forEach(([command, args]) => {
      console.log([command, ...args].join(' '))
    })
    return
  }

  executeGitHubReleaseCommands(commands)
}

if (require.main === module) {
  main()
}

module.exports = {
  executeGitHubReleaseCommands,
  getReleaseNotes,
  main,
  run,
  runRequired
}
