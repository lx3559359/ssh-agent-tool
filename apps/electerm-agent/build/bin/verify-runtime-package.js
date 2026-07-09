const fs = require('fs')
const path = require('path')

const defaultRequiredFiles = [
  'node_modules/form-data/lib/form_data.js',
  'node_modules/combined-stream/lib/combined_stream.js',
  'node_modules/delayed-stream/lib/delayed_stream.js'
]

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function verifyRuntimePackage ({
  appDir = path.resolve(process.cwd(), 'work/app'),
  requiredFiles = defaultRequiredFiles
} = {}) {
  const packagePath = path.join(appDir, 'package.json')
  const pack = readJson(packagePath)
  const selfDependency = pack.dependencies && pack.dependencies[pack.name]

  if (selfDependency) {
    throw new Error(`Runtime package ${pack.name} must not depend on itself: ${selfDependency}`)
  }

  const missing = requiredFiles.filter((file) => {
    return !fs.existsSync(path.join(appDir, file))
  })

  if (missing.length) {
    throw new Error(`Runtime package is missing required files: ${missing.join(', ')}`)
  }
}

function main () {
  verifyRuntimePackage()
  console.log('Runtime package verification passed.')
}

if (require.main === module) {
  main()
}

module.exports = {
  defaultRequiredFiles,
  main,
  verifyRuntimePackage
}
