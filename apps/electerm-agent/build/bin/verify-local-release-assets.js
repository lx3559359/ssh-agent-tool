const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')
const {
  buildLocalReleaseAssetReport,
  buildValidatedLocalUpdateAssets
} = require('./github-release-utils')
const {
  validateUpdateApprovalManifest
} = require('./write-update-approval-manifest')
const { assertCurrentReleaseBaseline } = require('./release-version-baseline')
const {
  assertPackageVersionConsistency,
  verifyReleaseVersionConsistency
} = require('./release-version-consistency')

const distDir = path.resolve(__dirname, '../../dist')
const releaseArch = process.env.AIGSHELL_RELEASE_ARCH
const releaseChannel = process.env.AIGSHELL_UPDATE_CHANNEL
const releaseAssetPrefix = pack.productName || 'ShellPilot'

function readLocalFiles (dir = distDir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs.readdirSync(dir).map(name => {
    const filePath = path.join(dir, name)
    return {
      name,
      size: fs.statSync(filePath).size
    }
  })
}

function validateLocalUpdateApprovalManifest (dir, version, channel) {
  const manifestPath = path.join(dir, 'aigshell-update.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  validateUpdateApprovalManifest(manifest, version, { channel })
}

function validateLocalLatestMetadata (dir, version, arch, assetPrefix) {
  const latestPath = path.join(dir, 'latest.yml')
  const content = fs.readFileSync(latestPath, 'utf8')
  const installer = `${assetPrefix}-${version}-win-${arch || 'x64'}-installer.exe`
  if (!new RegExp(`^version:\\s*['"]?${version.replace(/\./g, '\\.')}['"]?\\s*$`, 'm').test(content)) {
    throw new Error(`latest.yml version must match release version ${version}`)
  }
  if (!content.includes(`url: ${installer}`) || !content.includes(`path: ${installer}`)) {
    throw new Error(`latest.yml must point to ${installer}`)
  }
}

function printList (title, list) {
  if (!list.length) {
    return
  }
  console.error(title)
  list.forEach(item => console.error(`- ${item}`))
}

function verifyLocalReleaseArtifacts (options = {}) {
  const dir = options.distDir || distDir
  const version = options.version || process.env.AIGSHELL_RELEASE_VERSION || pack.version
  const arch = options.arch || releaseArch || 'x64'
  const channel = options.channel || releaseChannel
  const assetPrefix = options.assetPrefix || releaseAssetPrefix
  const updateOnly = options.updateOnly === undefined
    ? process.env.AIGSHELL_RELEASE_UPDATE_ONLY === '1'
    : options.updateOnly
  const localFiles = readLocalFiles(dir)
  let report

  if (!options.skipPackageVersion && version === pack.version) {
    assertCurrentReleaseBaseline({ silent: true })
    const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package-lock.json'), 'utf8'))
    assertPackageVersionConsistency({
      packageVersion: pack.version,
      lockVersion: lock.version,
      lockRootVersion: lock.packages && lock.packages[''] && lock.packages[''].version
    })
  }

  if (updateOnly) {
    const required = buildValidatedLocalUpdateAssets({
      distDir: dir,
      localFiles,
      version,
      arch
    })
    report = {
      ok: true,
      requiredNames: required.map(filePath => path.basename(filePath)),
      missingLocal: [],
      emptyLocal: []
    }
  } else {
    report = buildLocalReleaseAssetReport({
      localFiles,
      version,
      arch
    })
  }

  if (report.ok) {
    validateLocalUpdateApprovalManifest(dir, version, channel)
    validateLocalLatestMetadata(dir, version, arch, assetPrefix)
    verifyReleaseVersionConsistency({
      distDir: dir,
      version,
      arch,
      assetPrefix
    })
    return report
  }

  printList('Missing local update files:', report.missingLocal)
  printList('Empty local update files:', report.emptyLocal)
  throw new Error('Local release assets are incomplete.')
}

function main () {
  const report = verifyLocalReleaseArtifacts()
  console.log(`Local ${releaseAssetPrefix} update assets are ready for upload.`)
  report.requiredNames.forEach(name => console.log(`- ${name}`))
}

if (require.main === module) {
  main()
}

module.exports = {
  main,
  readLocalFiles,
  validateLocalLatestMetadata,
  validateLocalUpdateApprovalManifest,
  verifyLocalReleaseArtifacts
}
