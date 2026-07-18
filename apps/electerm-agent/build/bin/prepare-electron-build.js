const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { cp } = require('shelljs')

const defaultLocalWorkflowName = 'shellpilot-local'
const workflowNamePlaceholder = '${' + 'env.WORKFLOW_NAME}'

function replacePublishChannelPlaceholders (value, workflowName) {
  if (Array.isArray(value)) {
    return value.map(item => replacePublishChannelPlaceholders(item, workflowName))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.keys(value).reduce((result, key) => {
    const current = value[key]
    result[key] = key === 'channel' && current === workflowNamePlaceholder
      ? workflowName
      : replacePublishChannelPlaceholders(current, workflowName)
    return result
  }, {})
}

function findCpuFeaturesPackageDirs (cwd) {
  const candidates = []
  const dependencyRoots = [
    path.join(cwd, 'node_modules'),
    path.join(cwd, 'work/app/node_modules')
  ]

  for (const dependencyRoot of dependencyRoots) {
    candidates.push(path.join(dependencyRoot, 'cpu-features'))
    const pnpmStore = path.join(dependencyRoot, '.pnpm')
    if (!fs.existsSync(pnpmStore)) continue

    for (const entry of fs.readdirSync(pnpmStore, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('cpu-features@')) continue
      candidates.push(path.join(
        pnpmStore,
        entry.name,
        'node_modules/cpu-features'
      ))
    }
  }

  return [...new Set(candidates
    .filter(packageDir => fs.existsSync(path.join(packageDir, 'buildcheck.js')))
    .map(packageDir => fs.realpathSync(packageDir)))]
}

function prepareCpuFeaturesBuildConfig ({ cwd = process.cwd() } = {}) {
  const prepared = []
  for (const packageDir of findCpuFeaturesPackageDirs(cwd)) {
    const output = execFileSync(process.execPath, ['buildcheck.js'], {
      cwd: packageDir,
      encoding: 'utf8'
    })
    JSON.parse(output)
    fs.writeFileSync(path.join(packageDir, 'buildcheck.gypi'), output, 'utf8')
    prepared.push(packageDir)
  }
  return prepared
}

function prepareElectronBuilderConfig ({
  cwd = process.cwd(),
  workflowName = process.env.WORKFLOW_NAME || defaultLocalWorkflowName
} = {}) {
  prepareCpuFeaturesBuildConfig({ cwd })
  cp('-r', path.join(cwd, 'build/electron-builder.json'), cwd)
  const configPath = path.join(cwd, 'electron-builder.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const patched = replacePublishChannelPlaceholders(config, workflowName || defaultLocalWorkflowName)
  fs.writeFileSync(configPath, JSON.stringify(patched, null, 2))
}

if (require.main === module) {
  prepareElectronBuilderConfig()
}

module.exports = {
  findCpuFeaturesPackageDirs,
  prepareCpuFeaturesBuildConfig,
  prepareElectronBuilderConfig,
  replacePublishChannelPlaceholders
}
