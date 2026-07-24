const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importModule (relativePath) {
  const root = path.resolve(__dirname, '../../..')
  return import(pathToFileURL(path.join(root, relativePath)).href)
}

module.exports = { importModule }
