const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  buildReleaseAssetReport,
  buildReleaseTag,
  createSpawnOptions,
  getAllowedGitHubReleaseAssetNames
} = require('./github-release-utils')

const repo = process.env.GITHUB_REPOSITORY || 'lx3559359/ssh-agent-tool'
const tag = buildReleaseTag(pack.version)
const distDir = path.resolve(__dirname, '../../dist')
const releaseArch = process.env.AIGSHELL_RELEASE_ARCH

function ghJson (args) {
  const res = spawnSync('gh', args, {
    ...createSpawnOptions({ stdio: 'pipe' }),
    encoding: 'utf8'
  })
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `gh ${args.join(' ')} failed`)
  }
  return JSON.parse(res.stdout)
}

function readLocalFiles () {
  return getAllowedGitHubReleaseAssetNames(pack.version, { arch: releaseArch }).map(name => {
    const filePath = path.join(distDir, name)
    if (!fs.existsSync(filePath)) {
      return {
        name,
        size: undefined
      }
    }
    return {
      name,
      size: fs.statSync(filePath).size
    }
  })
}

function printList (title, list, formatter = item => item) {
  if (!list.length) {
    return
  }
  console.error(title)
  list.forEach(item => console.error(`- ${formatter(item)}`))
}

function main () {
  const release = ghJson([
    'release',
    'view',
    tag,
    '--repo',
    repo,
    '--json',
    'assets'
  ])
  const report = buildReleaseAssetReport({
    localFiles: readLocalFiles(),
    remoteAssets: release.assets,
    version: pack.version,
    arch: releaseArch
  })

  if (report.ok) {
    console.log(`GitHub release ${tag} matches local ${pack.productName || 'ShellPilot'} update assets.`)
    report.requiredNames.forEach(name => console.log(`- ${name}`))
    return
  }

  printList('Missing local files:', report.missingLocal)
  printList('Missing remote assets:', report.missingRemote)
  printList(
    'Size mismatches:',
    report.sizeMismatches,
    item => `${item.name} local=${item.localSize} remote=${item.remoteSize}`
  )
  printList(
    'Unexpected remote assets:',
    report.unexpectedRemote,
    item => item.name
  )
  process.exit(1)
}

main()
