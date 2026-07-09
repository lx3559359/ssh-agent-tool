const fs = require('fs')
const path = require('path')

function removePackagedBatchScripts (projectRoot = process.cwd()) {
  const root = path.join(projectRoot, 'resources', 'app.asar.unpacked', 'node_modules')
  const removed = []
  if (!fs.existsSync(root)) {
    return removed
  }

  function walk (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile() || !/\.(bat|cmd)$/i.test(entry.name)) {
        continue
      }
      fs.rmSync(fullPath, { force: true })
      removed.push(path.relative(projectRoot, fullPath))
    }
  }

  walk(root)
  return removed
}

function patchPackagedUpdateConfig (
  projectRoot = process.cwd(),
  { cacheDirName = 'ShellPilot-updater' } = {}
) {
  const updateConfigPath = path.join(projectRoot, 'resources', 'app-update.yml')
  if (!fs.existsSync(updateConfigPath)) {
    return false
  }
  const content = fs.readFileSync(updateConfigPath, 'utf8')
  const next = /^updaterCacheDirName:.*$/m.test(content)
    ? content.replace(/^updaterCacheDirName:.*$/m, `updaterCacheDirName: ${cacheDirName}`)
    : `${content.replace(/\s*$/, '\n')}updaterCacheDirName: ${cacheDirName}\n`
  if (next !== content) {
    fs.writeFileSync(updateConfigPath, next)
  }
  return true
}

module.exports = {
  patchPackagedUpdateConfig,
  removePackagedBatchScripts
}
