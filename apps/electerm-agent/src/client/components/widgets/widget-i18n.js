import { getShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const widgetDisplayMap = {
  'batch-op': {
    prefix: 'shellpilotWidgetBatch',
    accent: 'blue',
    keywords: ['batch', 'operation', 'inspection', 'deployment', 'ssh', 'sftp']
  },
  'local-file-server': {
    prefix: 'shellpilotWidgetFile',
    accent: 'green',
    keywords: ['static', 'file', 'server', 'http', 'download', 'distribution']
  },
  'local-ftp-server': {
    prefix: 'shellpilotWidgetFtp',
    accent: 'cyan',
    keywords: ['ftp', 'file', 'upload', 'download', 'transfer']
  },
  'mcp-server': {
    prefix: 'shellpilotWidgetMcp',
    accent: 'purple',
    keywords: ['mcp', 'agent', 'ai', 'api', 'tool']
  },
  rename: {
    prefix: 'shellpilotWidgetRename',
    accent: 'orange',
    keywords: ['rename', 'file', 'organization']
  }
}

const configKeyNames = new Set([
  'host',
  'port',
  'directory',
  'maxAge',
  'cacheControl',
  'lastModified',
  'etag',
  'index',
  'redirect',
  'dotfiles',
  'acceptRanges',
  'autoRun',
  'anonymous',
  'username',
  'password',
  'apiKey',
  'enableBookmarks',
  'bookmarkKeyword',
  'enableBookmarkGroups',
  'enableSftp',
  'enableSettings',
  'commandBlacklist',
  'commandWhitelist',
  'template',
  'includeSubfolders',
  'fileTypes',
  'startNumber',
  'preserveCase'
])

function translated (translate, key) {
  const value = typeof translate === 'function' ? translate(key) : ''
  if (typeof value === 'string' && value.trim() && value !== key) {
    return value
  }
  return getShellPilotTranslation(key, 'en_us') || key
}

function configPrefix (name) {
  return `shellpilotWidgetConfig${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

export function getWidgetDisplay (widget, translate) {
  const info = widget?.info || {}
  const fallbackTitle = info.name || widget?.id || translated(translate, 'shellpilotWidgetFallbackTitle')
  const result = {
    title: fallbackTitle,
    description: info.description || translated(translate, 'shellpilotWidgetFallbackDescription'),
    scene: translated(translate, 'shellpilotWidgetBuiltinScene'),
    typeLabel: translated(
      translate,
      info.type === 'instance' ? 'shellpilotWidgetServiceType' : 'shellpilotWidgetToolType'
    ),
    actionText: translated(
      translate,
      info.type === 'instance' ? 'shellpilotWidgetStartService' : 'shellpilotWidgetRunTool'
    ),
    accent: 'blue',
    keywords: []
  }
  const meta = widgetDisplayMap[widget?.id]
  if (!meta) {
    return result
  }
  return {
    ...result,
    title: translated(translate, `${meta.prefix}Title`),
    description: translated(translate, `${meta.prefix}Description`),
    scene: translated(translate, `${meta.prefix}Scene`),
    typeLabel: translated(translate, `${meta.prefix}Type`),
    actionText: translated(translate, `${meta.prefix}Action`),
    accent: meta.accent,
    keywords: meta.keywords
  }
}

export function getConfigDisplay (config, translate) {
  if (!configKeyNames.has(config.name)) {
    return {
      label: config.name,
      description: config.description
    }
  }
  const prefix = configPrefix(config.name)
  return {
    label: translated(translate, `${prefix}Label`),
    description: translated(
      translate,
      config.name === 'autoRun'
        ? 'shellpilotWidgetAutoRunDescription'
        : `${prefix}Description`
    )
  }
}

export function formatInstanceTitle (item, translate) {
  const meta = widgetDisplayMap[item.widgetId]
  if (!meta) {
    return item.title
  }
  const suffix = item.id ? ` (${item.id})` : ''
  return `${translated(translate, `${meta.prefix}Title`)}${suffix}`
}
