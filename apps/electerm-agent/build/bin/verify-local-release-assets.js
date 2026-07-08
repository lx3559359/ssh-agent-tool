const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')
const {
  buildLocalReleaseAssetReport
} = require('./github-release-utils')
const {
  validateUpdateApprovalManifest
} = require('./write-update-approval-manifest')

const distDir = path.resolve(__dirname, '../../dist')
const releaseArch = process.env.AIGSHELL_RELEASE_ARCH
const releaseChannel = process.env.AIGSHELL_UPDATE_CHANNEL

function readLocalFiles () {
  if (!fs.existsSync(distDir)) {
    return []
  }
  return fs.readdirSync(distDir).map(name => {
    const filePath = path.join(distDir, name)
    return {
      name,
      size: fs.statSync(filePath).size
    }
  })
}

function validateLocalUpdateApprovalManifest () {
  const manifestPath = path.join(distDir, 'aigshell-update.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  validateUpdateApprovalManifest(manifest, pack.version, { channel: releaseChannel })
}

function printList (title, list) {
  if (!list.length) {
    return
  }
  console.error(title)
  list.forEach(item => console.error(`- ${item}`))
}

function main () {
  const report = buildLocalReleaseAssetReport({
    localFiles: readLocalFiles(),
    version: pack.version,
    arch: releaseArch
  })

  if (report.ok) {
    validateLocalUpdateApprovalManifest()
    console.log('Local AIGShell update assets are ready for upload.')
    report.requiredNames.forEach(name => console.log(`- ${name}`))
    return
  }

  printList('Missing local update files:', report.missingLocal)
  printList('Empty local update files:', report.emptyLocal)
  process.exit(1)
}

main()
