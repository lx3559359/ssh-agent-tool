const fs = require('fs')
const path = require('path')
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

function prepareElectronBuilderConfig ({
  cwd = process.cwd(),
  workflowName = process.env.WORKFLOW_NAME || defaultLocalWorkflowName
} = {}) {
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
  prepareElectronBuilderConfig,
  replacePublishChannelPlaceholders
}
