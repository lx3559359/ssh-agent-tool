const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  buildReleaseTag,
  buildValidatedLocalReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
} = require('./github-release-utils')

const repo = process.env.GITHUB_REPOSITORY || 'lx3559359/ssh-agent-tool'
const distDir = path.resolve(__dirname, '../../dist')
const dryRun = process.argv.includes('--dry-run')

function run (command, args, options = {}) {
  const res = spawnSync(command, args, createSpawnOptions(options))
  return res.status || 0
}

function main () {
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
    title: `AIGShell ${tag}`,
    notes: `AIGShell Windows release ${tag}`,
    assets
  })

  if (dryRun) {
    commands.forEach(([command, args]) => {
      console.log([command, ...args].join(' '))
    })
    return
  }

  const view = commands[0]
  const create = commands[1]
  const upload = commands[2]
  const exists = run(view[0], view[1], { stdio: 'ignore' }) === 0
  if (!exists) {
    const created = run(create[0], create[1])
    if (created !== 0) {
      process.exit(created)
    }
  }

  const uploaded = run(upload[0], upload[1])
  if (uploaded !== 0) {
    process.exit(uploaded)
  }
}

main()
