const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function sha256File (filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
}

function buildChecksums ({
  distDir,
  version,
  channel,
  files = []
}) {
  return {
    product: 'ShellPilot',
    compatibleProducts: ['ShellPilot', 'AIGShell'],
    version,
    channel,
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(files
      .filter(name => fs.existsSync(path.join(distDir, name)))
      .map(name => {
        const filePath = path.join(distDir, name)
        return [
          name,
          {
            sha256: sha256File(filePath),
            size: fs.statSync(filePath).size
          }
        ]
      }))
  }
}

function writeChecksums (options = {}) {
  const distDir = options.distDir
  if (!distDir) {
    throw new Error('distDir is required')
  }
  const checksums = buildChecksums(options)
  const checksumsPath = path.join(distDir, 'checksums.json')
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n')
  return {
    checksums,
    checksumsPath
  }
}

module.exports = {
  buildChecksums,
  sha256File,
  writeChecksums
}
