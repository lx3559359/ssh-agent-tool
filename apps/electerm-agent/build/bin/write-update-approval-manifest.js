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

function normalizeVersion (version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function validateUpdateApprovalManifest (manifest, version = pack.version) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('aigshell-update.json must contain an object')
  }
  if (manifest.product !== 'AIGShell') {
    throw new Error('aigshell-update.json product must be AIGShell')
  }
  if (manifest.channel !== 'stable') {
    throw new Error('aigshell-update.json channel must be stable')
  }
  if (manifest.publishApproved !== true) {
    throw new Error('aigshell-update.json publishApproved must be true')
  }
  if (normalizeVersion(manifest.version) !== normalizeVersion(version)) {
    throw new Error('aigshell-update.json version must match package version')
  }
  return true
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
  buildUpdateApprovalManifest,
  validateUpdateApprovalManifest
}
