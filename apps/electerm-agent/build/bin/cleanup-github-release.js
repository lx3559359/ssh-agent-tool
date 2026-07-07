const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  buildReleaseTag,
  createSpawnOptions,
  selectUnexpectedReleaseAssets
} = require('./github-release-utils')

const repo = process.env.GITHUB_REPOSITORY || 'lx3559359/ssh-agent-tool'
const tag = buildReleaseTag(pack.version)
const shouldDelete = process.argv.includes('--yes')

function getApiPath (asset) {
  if (!asset.apiUrl) {
    throw new Error(`Missing GitHub asset API URL for ${asset.name}`)
  }
  return new URL(asset.apiUrl).pathname
}

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

function runGh (args) {
  const res = spawnSync('gh', args, createSpawnOptions())
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
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
  const unexpected = selectUnexpectedReleaseAssets(release.assets, pack.version)

  if (!unexpected.length) {
    console.log(`Release ${tag} is already clean.`)
    return
  }

  console.log(`Release ${tag} has ${unexpected.length} unexpected asset(s):`)
  unexpected.forEach(asset => console.log(`- ${asset.name}`))

  if (!shouldDelete) {
    console.log('Dry run only. Re-run with --yes to delete these assets.')
    return
  }

  unexpected.forEach(asset => {
    runGh([
      'api',
      '--method',
      'DELETE',
      getApiPath(asset)
    ])
  })
  console.log(`Deleted ${unexpected.length} unexpected asset(s) from ${tag}.`)
}

main()
