const fs = require('fs')
const path = require('path')

function cleanWorkDirectory (workPath = path.resolve(__dirname, '../../work')) {
  fs.rmSync(workPath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200
  })
}

if (require.main === module) {
  cleanWorkDirectory()
}

module.exports = {
  cleanWorkDirectory
}
