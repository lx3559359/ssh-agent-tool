const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')

function buildUpdateApprovalManifest (version = pack.version) {
  return {
    product: 'AIGShell',
    channel: 'stable',
    publishApproved: true,
    version,
    generatedAt: new Date().toISOString()
  }
}

function main () {
  const distDir = path.resolve(__dirname, '../../dist')
  fs.mkdirSync(distDir, { recursive: true })
  fs.writeFileSync(
    path.join(distDir, 'aigshell-update.json'),
    JSON.stringify(buildUpdateApprovalManifest(), null, 2) + '\n'
  )
}

if (require.main === module) {
  main()
}

module.exports = {
  buildUpdateApprovalManifest
}
