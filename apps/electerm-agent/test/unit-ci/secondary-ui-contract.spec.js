const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const stylus = require('stylus')

const projectRoot = path.resolve(__dirname, '../..')
const clientRoot = path.join(projectRoot, 'src/client')
const terminalThemeUrl = pathToFileURL(path.join(clientRoot, 'common/terminal-theme.js'))

registerHooks({
  resolve (specifier, context, nextResolve) {
    if (context.parentURL === terminalThemeUrl.href) {
      if (specifier === '../common/constants') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export const settingMap = {}'
        }
      }
      if (specifier === '../common/download') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export default function download () {}'
        }
      }
      if (specifier === './theme-defaults') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export function defaultTheme () { return { themeConfig: {} } }'
        }
      }
    }
    return nextResolve(specifier, context)
  }
})

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

async function compileStylusSource (source, filename) {
  return await new Promise((resolve, reject) => {
    stylus(source)
      .set('filename', filename)
      .render((error, css) => error ? reject(error) : resolve(css))
  })
}

function topLevelCssBlocks (source) {
  const blocks = []
  let cursor = 0
  while (cursor < source.length) {
    const openBrace = source.indexOf('{', cursor)
    if (openBrace === -1) break
    let depth = 1
    let closeBrace = openBrace + 1
    while (closeBrace < source.length && depth > 0) {
      if (source[closeBrace] === '{') depth += 1
      else if (source[closeBrace] === '}') depth -= 1
      closeBrace += 1
    }
    assert.equal(depth, 0, `Unclosed CSS block: ${source.slice(cursor, openBrace).trim()}`)
    blocks.push({
      header: source.slice(cursor, openBrace).trim(),
      body: source.slice(openBrace + 1, closeBrace - 1)
    })
    cursor = closeBrace
  }
  return blocks
}

function normalizeCssHeader (header) {
  return header
    .split(',')
    .map(part => part.trim().replace(/\s+/g, ' '))
    .join(', ')
}

function cssDeclarations (body) {
  return Object.fromEntries(
    body
      .split(';')
      .map(declaration => declaration.trim())
      .filter(Boolean)
      .map(declaration => {
        const colon = declaration.indexOf(':')
        assert.notEqual(colon, -1, `Invalid CSS declaration: ${declaration}`)
        return [
          declaration.slice(0, colon).trim(),
          declaration.slice(colon + 1).trim().replace(/\s+/g, ' ')
        ]
      })
  )
}

function assertCssRule (blocks, selector, expectedDeclarations) {
  const normalizedSelector = normalizeCssHeader(selector)
  const matches = blocks.filter(block => normalizeCssHeader(block.header) === normalizedSelector)
  assert.equal(matches.length, 1, `Expected one CSS rule for ${selector}`)
  const declarations = cssDeclarations(matches[0].body)
  for (const [property, value] of Object.entries(expectedDeclarations)) {
    assert.equal(declarations[property], value, `${selector} must define ${property}`)
  }
}

function assertNoProtectedTerminalElevation (css, filename) {
  const protectedTerminalSelector = /(?:\.tabs\.terminal-session-tabs|\.terms-box|\.terminal-control|\.term-wrap|\.xterm(?:-screen|-viewport)?)(?=$|[\s,>+~.:[#])/i
  const visit = source => {
    for (const block of topLevelCssBlocks(source)) {
      if (block.header.startsWith('@')) {
        visit(block.body)
        continue
      }
      if (!protectedTerminalSelector.test(block.header)) continue
      assert.doesNotMatch(
        block.body,
        /box-shadow\s*:[^;]*--sp-shadow-[a-z0-9-]+/i,
        `${filename} must not apply semantic UI elevation to ${block.header}`
      )
    }
  }
  visit(css)
}

async function assertUiElevationContracts (source) {
  const filename = path.join(clientRoot, 'css/includes/secondary-ui.styl')
  const css = await compileStylusSource(source, filename)
  const blocks = topLevelCssBlocks(css)
  assertCssRule(blocks, '.sp-level-0', {
    color: 'var(--sp-text)',
    background: 'var(--sp-page)'
  })
  assertCssRule(blocks, '.sp-level-1', {
    color: 'var(--sp-text)',
    background: 'var(--sp-surface)',
    border: '1px solid var(--sp-border)',
    'border-radius': 'var(--sp-radius-control)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-control)'
  })
  assertCssRule(blocks, '.sp-level-2, .sp-card', {
    color: 'var(--sp-text)',
    background: 'var(--sp-surface-elevated)',
    border: '1px solid var(--sp-border)',
    'border-radius': 'var(--sp-radius-card)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-card)'
  })
  assertCssRule(blocks, '.sp-level-3', {
    color: 'var(--sp-text)',
    background: 'var(--sp-surface-elevated)',
    border: '1px solid var(--sp-border-strong)',
    'border-radius': 'var(--sp-radius-overlay)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-overlay)'
  })
  assertCssRule(blocks, '.sp-lift-interactive', {
    transition: 'transform var(--sp-motion-fast) ease, box-shadow var(--sp-motion-fast) ease'
  })
  assertCssRule(blocks, '.sp-lift-interactive:hover', {
    transform: 'translateY(-1px)'
  })
  assertCssRule(blocks, '.sp-lift-interactive:active', {
    transform: 'translateY(0)'
  })

  const reducedMotion = blocks.filter(block => (
    normalizeCssHeader(block.header) === '@media (prefers-reduced-motion: reduce)'
  ))
  assert.equal(reducedMotion.length, 1, 'Expected one reduced-motion media rule')
  const reducedMotionBlocks = topLevelCssBlocks(reducedMotion[0].body)
  assertCssRule(reducedMotionBlocks, '.sp-lift-interactive', {
    transition: 'none'
  })
  assertCssRule(reducedMotionBlocks, '.sp-lift-interactive:hover, .sp-lift-interactive:active', {
    transform: 'none'
  })
}

const terminalCanvasSelectorPattern = /\.(?:xterm|term-wrap)\b/

function assertNoTerminalCanvasSelectors (source) {
  assert.doesNotMatch(source, terminalCanvasSelectorPattern)
}

function moduleUrl (relativePath) {
  return pathToFileURL(path.join(clientRoot, relativePath)).href
}

function parseClient (relativePath) {
  return parser.parse(readClient(relativePath), {
    sourceType: 'module',
    plugins: ['jsx']
  })
}

function clientCodeFilesUnder (relativePath) {
  const root = path.join(clientRoot, relativePath)
  const result = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (/\.(?:js|jsx)$/.test(entry.name)) {
        result.push(path.relative(clientRoot, absolute).replace(/\\/g, '/'))
      }
    }
  }
  visit(root)
  return result.sort()
}

function nodeName (node) {
  if (!node) return ''
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name
  if (node.type === 'MemberExpression' || node.type === 'JSXMemberExpression') {
    return `${nodeName(node.object)}.${nodeName(node.property)}`
  }
  return ''
}

function stringValue (node) {
  if (!node) return ''
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'JSXText') return node.value.replace(/\s+/g, ' ').trim()
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(item => item.value.cooked).join('')
  }
  return ''
}

const visibleAttributeNames = new Set([
  'title', 'label', 'placeholder', 'description', 'extra', 'tooltip',
  'okText', 'cancelText'
])
const visibleObjectKeys = new Set([
  'label', 'labelText', 'placeholder', 'message', 'description', 'title',
  'extra', 'tooltip', 'okText', 'cancelText', 'scene', 'typeLabel', 'actionText'
])
const technicalVisibleCopy = new Set([
  'Groq', 'xAI Grok', 'Together AI', 'AtlasCloud', 'stdio', 'HTTP', 'src:',
  'SSH', 'SFTP', 'MCP Server', 'SetEnv', 'ENV:LANG', 'X11', 'x11',
  'R→L', 'L→R', 'Shift+Enter', 'Gist ID', 'GitHub', 'URL', 'wiki',
  'type', 'SEC=xxx BEC=xxxx', 'en_US.UTF-8', '/login[: ]*$/i',
  '/password[: ]*$/i',
  'connect, command, sftp_upload, sftp_download',
  'SSH: {value}', 'ssh', 'telnet', 'vnc', 'rdp', 'ftp',
  'root@server:~#', 'systemctl status nginx', '● active (running)'
])

function isTechnicalVisibleCopy (value) {
  const templateRemainder = value
    .replace(/\{value\}/g, '')
    .replace(/[\s:()\-*.v]/g, '')
  if (!/[A-Za-z\u3400-\u9fff]/.test(templateRemainder)) return true
  return technicalVisibleCopy.has(value) ||
    /^(?:https?|socks5?):\/\//i.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
}

function staticVisibleStrings (node) {
  if (!node) return []
  if (node.type === 'StringLiteral' || node.type === 'JSXText') {
    return [stringValue(node)]
  }
  if (node.type === 'JSXExpressionContainer') {
    return staticVisibleStrings(node.expression)
  }
  if (node.type === 'TemplateLiteral') {
    return [node.quasis.map(item => item.value.cooked).join(' {value} ')]
      .concat(node.expressions.flatMap(staticVisibleStrings))
  }
  if (node.type === 'ConditionalExpression') {
    return staticVisibleStrings(node.consequent).concat(staticVisibleStrings(node.alternate))
  }
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') {
    return staticVisibleStrings(node.left).concat(staticVisibleStrings(node.right))
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    return staticVisibleStrings(node.body)
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.flatMap(staticVisibleStrings)
  }
  if (node.type === 'CallExpression') {
    const callee = nodeName(node.callee)
    if (['e', 'tf', 'translate', 'window.translate', 'formatShellPilotTranslation'].includes(callee)) {
      return []
    }
  }
  return []
}

function visibleHardcodedCopy (relativePath) {
  const result = []
  const ast = parseClient(relativePath)
  const add = (value, location) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized || isTechnicalVisibleCopy(normalized)) return
    if (!/[A-Za-z\u3400-\u9fff]/.test(normalized)) return
    result.push(`${location}: ${normalized}`)
  }

  traverse(ast, {
    JSXText (item) {
      add(stringValue(item.node), `line ${item.node.loc.start.line}`)
    },
    JSXAttribute (item) {
      if (!visibleAttributeNames.has(item.node.name.name)) return
      for (const value of staticVisibleStrings(item.node.value)) {
        add(value, `line ${item.node.loc.start.line}`)
      }
    },
    ObjectProperty (item) {
      if (relativePath === 'components/bookmark-form/bookmark-schema.js') return
      const key = nodeName(item.node.key) || stringValue(item.node.key)
      if (!visibleObjectKeys.has(key)) return
      for (const value of staticVisibleStrings(item.node.value)) {
        add(value, `line ${item.node.loc.start.line}`)
      }
    },
    CallExpression (item) {
      const callee = nodeName(item.node.callee)
      const visibleCall = [
        'message.success', 'message.error', 'message.warning', 'message.info',
        'notification.success', 'notification.error', 'notification.warning',
        'showMsg', 'window.confirm', 'label'
      ].includes(callee)
      if (!visibleCall) return
      for (const value of staticVisibleStrings(item.node.arguments[0])) {
        add(value, `line ${item.node.loc.start.line}`)
      }
    },
    NewExpression (item) {
      if (nodeName(item.node.callee) !== 'Error') return
      for (const value of staticVisibleStrings(item.node.arguments[0])) {
        add(value, `line ${item.node.loc.start.line}`)
      }
    }
  })
  return result
}

const expectedSecondaryCopy = Object.freeze({
  connectionSucceeded: ['连接成功', 'Connection succeeded'],
  connectionFailed: ['连接失败', 'Connection failed'],
  sshAndSftpCannotBothBeDisabled: ['SSH 和 SFTP 不能同时禁用', 'SSH and SFTP cannot both be disabled'],
  saveAndConnect: ['保存并连接', 'Save and Connect'],
  saveAndCreateNew: ['保存并新建', 'Save and Create Another'],
  temporaryConnection: ['不保存，直接连接', 'Connect Without Saving'],
  temporaryConnectionHint: ['不保存配置，直接打开临时连接', 'Open a temporary connection without saving this configuration'],
  ok: ['确定', 'OK'],
  cancel: ['取消', 'Cancel'],
  more: ['更多', 'More'],
  shellpilotRequestFailed: ['请求失败', 'Request failed'],
  shellpilotUpdateChannelDescription: ['稳定版只接收已确认发布的正式更新，测试版用于提前验证新功能。', 'Stable receives confirmed releases only; Beta provides early access for testing new features.'],
  shellpilotUpdateSourceDescription: ['自动选择会优先使用国内源，失败后回退 GitHub；手动选择后只使用指定更新源。', 'Automatic selection prefers the regional mirror and falls back to GitHub; a manual choice uses only that source.'],
  shellpilotProtocolRegistered: ['协议处理器已注册', 'Protocol handlers registered'],
  shellpilotProtocolStatus: ['协议状态', 'Protocol Status'],
  shellpilotDataInSync: ['数据已同步', 'Data is synchronized'],
  shellpilotBookmarkGroups: ['书签分组', 'Bookmark Groups'],
  shellpilotUrlRequired: ['请输入 URL', 'Enter a URL'],
  shellpilotHttpUrlRequired: ['URL 必须以 http:// 或 https:// 开头', 'The URL must start with http:// or https://'],
  shellpilotAiQuickSetup: ['模型 API 快速配置', 'Quick Model API Setup'],
  shellpilotAiConfigAvailable: ['模型 API 配置可用', 'Model API configuration is available'],
  shellpilotAiUnexpectedResponse: ['模型 API 返回异常', 'The model API returned an unexpected response'],
  shellpilotAiLoadModelsFailed: ['拉取模型失败：{detail}', 'Failed to load models: {detail}'],
  shellpilotAiModelsLoaded: ['已获取 {count} 个模型', '{count} models loaded'],
  shellpilotAiUnconfigured: ['未配置', 'Not Configured'],
  shellpilotAiPending: ['待测试', 'Pending Test'],
  shellpilotAiAvailable: ['可用', 'Available'],
  shellpilotAiError: ['异常', 'Error'],
  shellpilotGiteeSyncWarning: ['不建议继续使用 Gitee 数据同步。更多信息请查看', 'Gitee data sync is no longer recommended. For details, see'],
  shellpilotTerminalAnalyzeWithAi: ['AI 分析当前终端', 'Analyze Current Terminal with AI'],
  shellpilotTerminalCopyCurrentPath: ['复制当前路径', 'Copy Current Path'],
  shellpilotTerminalZoomIn: ['放大终端字体', 'Increase Terminal Font Size'],
  shellpilotTerminalZoomOut: ['缩小终端字体', 'Decrease Terminal Font Size'],
  shellpilotTerminalZoomReset: ['重置终端字体', 'Reset Terminal Font Size'],
  shellpilotTerminalOpenLogFolder: ['打开会话日志目录', 'Open Session Log Folder'],
  shellpilotXmodemSend: ['XMODEM 发送', 'XMODEM Send'],
  shellpilotXmodemReceive: ['XMODEM 接收', 'XMODEM Receive'],
  shellpilotBookmarkOpenAll: ['全部打开', 'Open All'],
  shellpilotBookmarkEditGroup: ['编辑分组', 'Edit Group'],
  shellpilotBookmarkDeleteConnection: ['删除连接', 'Delete Connection'],
  shellpilotWidgetBatchTitle: ['批量任务', 'Batch Tasks'],
  shellpilotWidgetMcpDescription: ['把 ShellPilot 的连接、SFTP 和命令能力开放给支持 MCP 的 AI 工具。', 'Expose ShellPilot connections, SFTP, and command capabilities to AI tools that support MCP.'],
  shellpilotWidgetAutoRunDescription: ['ShellPilot 启动后自动运行这个工具。', 'Run this tool automatically after ShellPilot starts.'],
  shellpilotBatchLoadTemplate: ['载入模板', 'Load Template'],
  shellpilotBatchExecuteTask: ['执行任务', 'Run Task'],
  shellpilotBatchExecutionLog: ['执行日志', 'Execution Log'],
  shellpilotBatchActionsSupported: ['支持动作：', 'Supported actions:'],
  shellpilotBatchDescription: ['用于把连接服务器、执行命令、上传下载文件编排成可重复执行的任务流。', 'Arrange server connections, commands, uploads, and downloads into reusable workflows.'],
  shellpilotBatchWorkflowArrayRequired: ['任务流必须是数组', 'The workflow must be an array'],
  shellpilotBatchInvalidJson: ['任务 JSON 无效：{detail}', 'Invalid task JSON: {detail}'],
  shellpilotBatchExecutionComplete: ['任务执行完成', 'Task completed'],
  shellpilotBatchExecutionFailed: ['任务执行失败：{detail}', 'Task failed: {detail}'],
  shellpilotBatchStepActionRequired: ['步骤必须包含 action 字段', 'Each step must include an action field'],
  shellpilotBatchUnknownAction: ['未知动作：{action}', 'Unknown action: {action}'],
  shellpilotBatchConnectionTimeout: ['连接超时', 'Connection timed out'],
  shellpilotBatchConnectionFailed: ['连接失败：{detail}', 'Connection failed: {detail}'],
  shellpilotBatchUnknownError: ['未知错误', 'Unknown error'],
  shellpilotBatchNoActiveTab: ['没有可用的活动标签，请先连接服务器。', 'No active tab is available. Connect to a server first.'],
  shellpilotBatchTerminalNotFound: ['未找到终端', 'Terminal not found'],
  shellpilotBatchTerminalNotReady: ['终端未就绪：attach 插件尚未初始化', 'Terminal is not ready: the attach add-on has not initialized'],
  shellpilotBatchTransferTimeout: ['传输超时（1 小时）', 'Transfer timed out (1 hour)'],
  shellpilotBatchTransferFailed: ['传输失败：{detail}', 'Transfer failed: {detail}'],
  shellpilotBatchStepConnectSsh: ['连接 SSH', 'Connect SSH'],
  shellpilotBatchStepCreateTestFile: ['创建 5M 测试文件', 'Create 5M test file'],
  shellpilotBatchStepRecordFileInfo: ['记录文件信息', 'Record file information'],
  shellpilotBatchStepDownloadTestFile: ['下载 5M 文件', 'Download 5M file'],
  shellpilotBatchStepRecordDownload: ['记录下载结果', 'Record download result'],
  shellpilotBatchStepDeleteRemoteFile: ['删除远程测试文件', 'Delete remote test file'],
  shellpilotBatchStepUploadRemoteFile: ['上传文件到远程服务器', 'Upload file to remote server'],
  shellpilotBatchStepRecordUpload: ['记录上传结果', 'Record upload result'],
  shellpilotBatchStepVerifyCleanup: ['校验并清理', 'Verify and clean up'],
  shellpilotShortcutModifierRequired: ['快捷键必须包含 Ctrl、Shift、Alt 或 Meta 中的至少一个', 'The shortcut must include Ctrl, Shift, Alt, or Meta'],
  shellpilotShortcutAlreadyExists: ['快捷键已存在', 'The shortcut already exists'],
  shellpilotWidgetRunSucceededWithDetail: ['工具运行成功：{detail}', 'Tool completed successfully: {detail}'],
  shellpilotIdLabel: ['ID', 'ID'],
  shellpilotInvalidLogFolder: ['日志目录无效或不可写', 'The log folder is invalid or not writable'],
  shellpilotHostOrIp: ['主机名或 IP 地址', 'Hostname or IP address']
})

test('secondary copy catalogs resolve the same explicit key set in Chinese and English', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation,
    resolveShellPilotTranslation,
    formatShellPilotTranslation
  } = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))

  assert.deepEqual(
    getShellPilotCatalogKeys('zh_cn'),
    getShellPilotCatalogKeys('en_us')
  )
  for (const key of getShellPilotCatalogKeys('en_us')) {
    const english = getShellPilotTranslation(key, 'en_us')
    assert.equal(resolveShellPilotTranslation(key, 'fr_fr'), english, `${key} English fallback`)
    assert.notEqual(resolveShellPilotTranslation(key, 'fr_fr'), key, `${key} must not leak its raw key`)
  }
  for (const [key, [chinese, english]] of Object.entries(expectedSecondaryCopy)) {
    assert.equal(getShellPilotTranslation(key, 'zh_cn'), chinese, key)
    assert.equal(getShellPilotTranslation(key, 'en_us'), english, key)
  }
  assert.equal(
    formatShellPilotTranslation(key => key, 'shellpilotAiModelsLoaded', { count: 3 }),
    '3 models loaded'
  )
})

test('known secondary configuration surfaces contain no direct visible Chinese copy', () => {
  const files = [
    'components/setting-panel/setting-modal.jsx',
    'components/setting-panel/setting-common.jsx',
    'components/setting-panel/deep-link-control.jsx',
    'components/setting-sync/setting-sync-form.jsx',
    'components/setting-sync/sync-data-compare.jsx',
    'components/ai/ai-config.jsx',
    'components/ai/ai-config-modal.jsx',
    'components/bookmark-form/form-renderer.jsx',
    'components/bookmark-form/common/submit-buttons.jsx',
    'components/bookmark-form/config/web.js',
    'components/terminal/terminal-context-menu.js',
    'components/tree-list/bookmark-context-menu.js',
    'components/tree-list/tree-list-row.jsx',
    'components/sftp/context-menu-utils.js',
    'components/sftp/file-item.jsx',
    'components/sftp/list-table-ui.jsx'
  ]

  for (const file of files) {
    const source = readClient(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    assert.doesNotMatch(source, /[\u3400-\u9fff]/, file)
  }
})

test('Tool Center display and configuration copy follows preview language without mutating widget data', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const widgets = await import(moduleUrl('components/widgets/widget-i18n.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key
  const widget = {
    id: 'mcp-server',
    info: {
      name: 'MCP Server',
      description: 'internal source description',
      type: 'instance'
    }
  }
  const before = structuredClone(widget)

  assert.equal(widgets.getWidgetDisplay(widget, translate('zh_cn')).title, 'MCP 服务')
  assert.equal(widgets.getWidgetDisplay(widget, translate('en_us')).title, 'MCP Service')
  assert.match(widgets.getWidgetDisplay(widget, translate('en_us')).description, /ShellPilot/)
  assert.doesNotMatch(widgets.getWidgetDisplay(widget, translate('en_us')).description, /AIGShell/)
  assert.equal(widgets.getWidgetDisplay({ id: 'batch-op', info: {} }, key => key).title, 'Batch Tasks')
  assert.equal(
    widgets.getConfigDisplay({ name: 'autoRun', description: 'internal' }, translate('en_us')).description,
    'Run this tool automatically after ShellPilot starts.'
  )
  assert.equal(
    widgets.formatInstanceTitle({ widgetId: 'mcp-server', id: '7', title: 'raw' }, translate('zh_cn')),
    'MCP 服务 (7)'
  )
  assert.deepEqual(widget, before)

  const tabSource = readClient('components/setting-panel/tab-widgets.jsx')
  assert.match(tabSource, /<WidgetList[\s\S]{0,120}languageVersion=\{languageVersion\}/)
  assert.match(tabSource, /<WidgetControl[\s\S]{0,160}languageVersion=\{languageVersion\}/)
  assert.doesNotMatch(tabSource, /key=\{languageVersion\}/)
})

test('expanded configuration routes contain no direct hardcoded visible copy', () => {
  const quickCommandSettingFiles = [
    'components/quick-commands/quick-commands-list.jsx',
    'components/quick-commands/quick-commands-form.jsx',
    'components/quick-commands/quick-commands-form-elem.jsx',
    'components/quick-commands/quick-commands-list-form.jsx',
    'components/quick-commands/quick-command-transport.jsx',
    'components/quick-commands/quick-command-transport-mod.jsx',
    'components/quick-commands/on-drop.js'
  ]
  const themeSettingFiles = [
    'components/theme/theme-form.jsx',
    'components/theme/theme-gallery.jsx',
    'components/theme/theme-preview.jsx',
    'components/theme/theme-editor.jsx',
    'components/theme/theme-edit-slot.jsx'
  ]
  const files = [
    ...clientCodeFilesUnder('components/widgets'),
    ...clientCodeFilesUnder('components/batch-op'),
    ...clientCodeFilesUnder('components/shortcuts'),
    ...clientCodeFilesUnder('components/setting-panel'),
    ...clientCodeFilesUnder('components/bookmark-form'),
    ...clientCodeFilesUnder('components/setting-sync'),
    ...clientCodeFilesUnder('components/profile'),
    ...quickCommandSettingFiles,
    ...themeSettingFiles,
    'components/ai/ai-config.jsx',
    'components/ai/ai-config-modal.jsx',
    'components/common/modal.jsx',
    'components/terminal/terminal-context-menu.js',
    'components/tree-list/bookmark-context-menu.js',
    'components/tree-list/tree-list-row.jsx',
    'components/sftp/context-menu-utils.js',
    'components/sftp/file-item.jsx',
    'components/sftp/list-table-ui.jsx'
  ]
  const uniqueFiles = [...new Set(files)].sort()
  const issues = uniqueFiles.flatMap(file => {
    return visibleHardcodedCopy(file).map(copy => `${file} ${copy}`)
  })
  assert.deepEqual(issues, [])

  for (const file of clientCodeFilesUnder('components/widgets')) {
    const source = readClient(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    assert.doesNotMatch(source, /[\u3400-\u9fff]/, file)
    assert.doesNotMatch(source, /AIGShell/, file)
  }
})

test('batch operation copy follows preview language without remounting editor state', () => {
  const widgetForm = readClient('components/widgets/widget-form.jsx')
  const editor = readClient('components/batch-op/batch-op-editor.jsx')
  const logs = readClient('components/batch-op/batch-op-logs.jsx')
  const shortcuts = readClient('components/shortcuts/shortcuts.jsx')
  const shortcutEditor = readClient('components/shortcuts/shortcut-editor.jsx')

  assert.match(widgetForm, /<BatchOpEditor[\s\S]{0,100}languageVersion=\{languageVersion\}/)
  assert.match(editor, /<BatchOpLogs[\s\S]{0,100}languageVersion=\{languageVersion\}/)
  assert.doesNotMatch(editor, /key=\{languageVersion\}/)
  assert.doesNotMatch(logs, /key=\{languageVersion\}/)
  assert.match(shortcuts, /e\('shellpilotNumberColumn'\)/)
  assert.match(shortcutEditor, /window\.translate\('shellpilotShortcutModifierRequired'\)/)
  assert.match(shortcutEditor, /window\.translate\('shellpilotShortcutAlreadyExists'\)/)
})

test('simple editor search control can shrink in narrow tool panels', async () => {
  const source = readClient('css/includes/secondary-ui.styl')
  const filename = path.join(clientRoot, 'css/includes/secondary-ui.styl')
  const css = await compileStylusSource(source, filename)
  const blocks = topLevelCssBlocks(css)
  assertCssRule(blocks, '.simple-editor > .ant-flex > .ant-input-search', {
    'min-width': '0',
    flex: '1 1 auto'
  })
})

test('batch operation formatted copy preserves technical and backend details', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const { formatBatchOpMessage } = await import(moduleUrl('components/batch-op/batch-op-i18n.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key

  assert.equal(
    formatBatchOpMessage('shellpilotBatchInvalidJson', { detail: 'Unexpected token ]' }, translate('zh_cn')),
    '任务 JSON 无效：Unexpected token ]'
  )
  assert.equal(
    formatBatchOpMessage('shellpilotBatchConnectionFailed', { detail: 'ECONNREFUSED 10.0.0.8:22' }, translate('en_us')),
    'Connection failed: ECONNREFUSED 10.0.0.8:22'
  )
  assert.equal(
    formatBatchOpMessage('shellpilotBatchUnknownAction', { action: 'custom_action' }, translate('en_us')),
    'Unknown action: custom_action'
  )
})

test('batch operation workflow generator localizes names without changing executable structure', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const batch = await import(moduleUrl('components/batch-op/batch-op-i18n.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key
  assert.equal(typeof batch.createWorkflowExample, 'function')

  const chinese = JSON.parse(batch.createWorkflowExample(translate('zh_cn')))
  const english = JSON.parse(batch.createWorkflowExample(translate('en_us')))
  assert.deepEqual(chinese.map(step => step.name), [
    '连接 SSH',
    '创建 5M 测试文件',
    '记录文件信息',
    '下载 5M 文件',
    '记录下载结果',
    '删除远程测试文件',
    '上传文件到远程服务器',
    '记录上传结果',
    '校验并清理'
  ])
  assert.deepEqual(english.map(step => step.name), [
    'Connect SSH',
    'Create 5M test file',
    'Record file information',
    'Download 5M file',
    'Record download result',
    'Delete remote test file',
    'Upload file to remote server',
    'Record upload result',
    'Verify and clean up'
  ])
  const withoutNames = workflow => workflow.map(({ name, ...step }) => step)
  assert.deepEqual(withoutNames(chinese), withoutNames(english))
  assert.deepEqual(english.map(step => step.action), [
    'connect',
    'command',
    'command',
    'sftp_download',
    'command',
    'command',
    'sftp_upload',
    'command',
    'command'
  ])
})

test('settings preview language reaches AIConfig without remounting or source replacement', () => {
  const tabSettings = readClient('components/setting-panel/tab-settings.jsx')
  const aiConfig = readClient('components/ai/ai-config.jsx')

  assert.match(tabSettings, /languageVersion/)
  assert.match(tabSettings, /<SettingAi[\s\S]{0,160}languageVersion=\{languageVersion\}/)
  assert.match(aiConfig, /languageVersion/)
  assert.doesNotMatch(tabSettings, /key=\{languageVersion\}/)
  assert.doesNotMatch(aiConfig, /key=\{languageVersion\}/)
})

test('form validation rules resolve required and maximum copy when validation runs', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  assert.equal(typeof i18n.createShellPilotRequiredRule, 'function')
  assert.equal(typeof i18n.createShellPilotMaxRule, 'function')
  let language = 'zh_cn'
  const translate = key => {
    if (key === 'host') return language === 'zh_cn' ? '主机' : 'Host'
    return i18n.getShellPilotTranslation(key, language) || key
  }
  const required = i18n.createShellPilotRequiredRule(translate, 'host')
  const maximum = i18n.createShellPilotMaxRule(translate, 520)
  assert.deepEqual(required(), { required: true, message: '请填写主机' })
  assert.deepEqual(maximum(), { max: 520, message: '最多 520 个字符' })
  language = 'en_us'
  assert.deepEqual(required(), { required: true, message: 'Enter Host' })
  assert.deepEqual(maximum(), { max: 520, message: 'Maximum 520 characters' })

  const tabSettings = readClient('components/setting-panel/tab-settings.jsx')
  const terminalSettings = readClient('components/setting-panel/setting-terminal.jsx')
  assert.doesNotMatch(tabSettings, /message\.success\(['"]Saved['"]\)/)
  assert.doesNotMatch(terminalSettings, /message\.error\(['"]invalid log folder['"]\)/)
})

test('empty AI profile names use current display language without being persisted or translated as user data', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const profiles = await import(moduleUrl('components/ai/ai-profiles.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key
  const input = {
    activeAIProfileId: 'empty',
    aiProfiles: [
      { id: 'empty', nameAI: '', baseURLAI: '', apiKeyAI: '' },
      { id: 'named', nameAI: 'My Relay', baseURLAI: '', apiKeyAI: '' }
    ]
  }
  const before = structuredClone(input)

  assert.deepEqual(
    profiles.getAIProfileOptions(input, translate('zh_cn')).map(item => item.label),
    ['AI 配置', 'My Relay']
  )
  assert.deepEqual(
    profiles.getAIProfileOptions(input, translate('en_us')).map(item => item.label),
    ['AI Configuration', 'My Relay']
  )
  assert.deepEqual(input, before)
  assert.equal(profiles.migrateAIProfiles(input).aiProfiles[0].nameAI, '')
})

test('AI model status copy follows the current language without changing status values', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const profiles = await import(moduleUrl('components/ai/ai-profiles.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key
  const configured = {
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example'
  }

  assert.deepEqual(
    ['zh_cn', 'en_us'].map(langId => profiles.getAIModelStatus({}, translate(langId)).status),
    ['unconfigured', 'unconfigured']
  )
  assert.equal(profiles.getAIModelStatus({}, translate('zh_cn')).label, '未配置')
  assert.equal(profiles.getAIModelStatus({}, translate('en_us')).label, 'Not Configured')
  assert.equal(profiles.getAIModelStatus(configured, translate('zh_cn')).label, '\u5f85\u91cd\u65b0\u68c0\u6d4b')
  assert.equal(profiles.getAIModelStatus(configured, translate('en_us')).label, 'Check Required')
  assert.equal(profiles.getAIModelStatus(configured, translate('en_us')).status, 'stale')
  assert.equal(profiles.getAIModelStatus({
    ...configured,
    aiStatus: 'available'
  }, translate('en_us')).status, 'available')

  const aiConfigSource = readClient('components/ai/ai-config.jsx')
  assert.doesNotMatch(aiConfigSource, /saveProfileStatus\('(?:available|error)',\s*e\('shellpilotAi/)
  assert.match(aiConfigSource, /message\.error\(result\.message \|\| e\('shellpilotAiRecentFailure'\)\)/)
  const source = readClient('components/bookmark-form/ai-bookmark-form.jsx')
  assert.doesNotMatch(source, /message\.error\(['"]无法根据 AI 返回内容/)
})

test('visible English copy is routed through runtime translation with a narrow technical allowlist', () => {
  const files = [
    'components/setting-panel/setting-modal.jsx',
    'components/setting-sync/setting-sync-form.jsx',
    'components/ai/ai-config.jsx',
    'components/ai/ai-config-modal.jsx',
    'components/bookmark-form/common/submit-buttons.jsx',
    'components/theme/theme-form.jsx',
    'components/common/modal.jsx'
  ]

  for (const file of files) {
    assert.deepEqual(visibleHardcodedCopy(file), [], file)
  }
})

test('modal defaults resolve at invocation and update time while explicit copy wins', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  assert.equal(typeof i18n.resolveShellPilotModalCopy, 'function')

  let language = 'zh_cn'
  const translate = key => i18n.getShellPilotTranslation(key, language)
  assert.deepEqual(i18n.resolveShellPilotModalCopy({}, translate), {
    okText: '确定',
    cancelText: '取消'
  })
  language = 'en_us'
  assert.deepEqual(i18n.resolveShellPilotModalCopy({}, translate), {
    okText: 'OK',
    cancelText: 'Cancel'
  })
  assert.deepEqual(i18n.resolveShellPilotModalCopy({
    okText: 'Proceed',
    cancelText: 'Back'
  }, translate), {
    okText: 'Proceed',
    cancelText: 'Back'
  })

  const modalSource = readClient('components/common/modal.jsx')
  assert.match(modalSource, /resolveShellPilotModalCopy\(options, window\.translate\)/)
  assert.match(modalSource, /resolveShellPilotModalCopy\(updatedOptions, window\.translate\)/)
  assert.doesNotMatch(modalSource, /(?:okText|cancelText)[^\n]*=\s*['"](?:OK|Cancel)['"]/)
})

test('theme language preview revalidates only touched errors without remounting or losing drafts', async () => {
  const originalWindow = global.window
  global.window = global.window || { translate: value => value }
  const validation = await import(moduleUrl('common/theme-validation.js'))
  assert.equal(typeof validation.revalidateTouchedThemeFields, 'function')
  const validated = []
  const form = {
    isFieldTouched: name => name === 'themeName',
    validateFields: async names => {
      validated.push(names)
      throw new Error('the visible validation remains invalid')
    }
  }
  assert.deepEqual(
    await validation.revalidateTouchedThemeFields(form),
    ['themeName']
  )
  assert.deepEqual(validated, [['themeName']])

  const formSource = readClient('components/theme/theme-form.jsx')
  const tabSource = readClient('components/setting-panel/tab-themes.jsx')
  assert.match(formSource, /useEffect\([\s\S]*revalidateTouchedThemeFields\(form\)[\s\S]*\[props\.languageVersion\]/)
  assert.match(formSource, /name='themeName'[\s\S]{0,180}\brequired\b/)
  assert.doesNotMatch(formSource, /key=\{(?:language|languageVersion|previewLanguage)/)
  assert.match(tabSource, /<TerminalThemeForm[\s\S]{0,160}languageVersion=\{languageVersion\}/)
  if (originalWindow === undefined) delete global.window
  else global.window = originalWindow
})

test('menu builders keep action keys while exposing runtime bilingual label keys', async () => {
  const i18n = await import(moduleUrl('common/shellpilot-i18n-overrides.js'))
  const terminal = await import(moduleUrl('components/terminal/terminal-context-menu.js'))
  const bookmarks = await import(moduleUrl('components/tree-list/bookmark-context-menu.js'))
  const translate = langId => key => i18n.getShellPilotTranslation(key, langId) || key

  const terminalItems = terminal.buildTerminalContextMenuItems({ isSerial: true })
  assert.equal(terminalItems.find(item => item.key === 'analyzeTerminalWithAi').labelKey, 'shellpilotTerminalAnalyzeWithAi')
  assert.equal(terminalItems.find(item => item.key === 'onXmodemSend').labelKey, 'shellpilotXmodemSend')
  assert.equal(terminalItems.some(item => item.labelText), false)

  const args = {
    item: { id: 'server-1', type: 'ssh' },
    isGroup: false,
    staticList: false
  }
  const zhItems = bookmarks.buildBookmarkContextMenuItems({ ...args, translate: translate('zh_cn') })
  const enItems = bookmarks.buildBookmarkContextMenuItems({ ...args, translate: translate('en_us') })
  assert.deepEqual(
    zhItems.filter(item => item.type !== 'divider').map(item => item.key),
    enItems.filter(item => item.type !== 'divider').map(item => item.key)
  )
  assert.equal(zhItems.find(item => item.key === 'delete').label, '删除连接')
  assert.equal(enItems.find(item => item.key === 'delete').label, 'Delete Connection')
  assert.equal(enItems.find(item => item.key === 'delete').labelKey, 'shellpilotBookmarkDeleteConnection')
})

test('defines L0-L3 contracts without styling terminal canvases', async () => {
  const source = readClient('css/includes/secondary-ui.styl')
  await assertUiElevationContracts(source)
  assertNoTerminalCanvasSelectors(source)
})

test('elevation contract validator rejects tokens assigned to the wrong levels', async () => {
  const source = readClient('css/includes/secondary-ui.styl')
  const misplacedTokens = source
    .replace('var(--sp-shadow-control)', '__CONTROL_SHADOW__')
    .replace('var(--sp-shadow-overlay)', 'var(--sp-shadow-control)')
    .replace('__CONTROL_SHADOW__', 'var(--sp-shadow-overlay)')
  await assert.rejects(assertUiElevationContracts(misplacedTokens))
})

test('terminal selector guard rejects decorated terminal canvas selectors', () => {
  for (const selector of [
    '.xterm:hover',
    '.xterm.foo',
    '.xterm-screen',
    '.term-wrap:focus'
  ]) {
    assert.throws(() => assertNoTerminalCanvasSelectors(`${selector}\n  color red`))
  }
  for (const selector of ['.xterminal', '.term-wrapper']) {
    assert.doesNotThrow(() => assertNoTerminalCanvasSelectors(`${selector}\n  color red`))
  }
})

test('client chrome maps concrete shell selectors to restrained semantic depth', async () => {
  const files = [
    'components/main/aigshell-topbar.styl',
    'components/sidebar/sidebar.styl',
    'components/side-panel-r/right-side-panel.styl',
    'components/footer/footer.styl'
  ]
  for (const file of files) {
    assert.doesNotMatch(
      readClient(file),
      /#(?:f7f8fa|dfe3ea)\b/i,
      `${file} must not retain fixed legacy light chrome colors`
    )
  }

  const topbarBlocks = topLevelCssBlocks(await compileStylus(files[0]))
  assertCssRule(topbarBlocks, '.aigshell-topbar', {
    background: 'var(--sp-surface-elevated)',
    'border-bottom': '1px solid var(--sp-border)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-control)'
  })

  const sidebarBlocks = topLevelCssBlocks(await compileStylus(files[1]))
  assertCssRule(sidebarBlocks, '.sidebar', {
    background: 'var(--sp-surface)',
    'border-right': '1px solid var(--sp-border)'
  })
  assertCssRule(sidebarBlocks, '.sidebar .control-icon-wrap', {
    'box-shadow': 'none'
  })
  assertCssRule(sidebarBlocks, '.sidebar .control-icon-wrap:hover', {
    background: 'var(--sp-surface-elevated)',
    'box-shadow': 'var(--sp-shadow-control)'
  })
  assertCssRule(sidebarBlocks, '.sidebar .control-icon-wrap.active', {
    background: 'var(--sp-primary-soft)',
    'box-shadow': 'var(--sp-shadow-control)'
  })
  assertCssRule(sidebarBlocks, '.sidebar .control-icon-wrap:focus-visible', {
    outline: '2px solid var(--sp-primary)',
    'outline-offset': '2px'
  })

  const panelBlocks = topLevelCssBlocks(await compileStylus(files[2]))
  assertCssRule(panelBlocks, '.right-side-panel', {
    background: 'var(--sp-surface)',
    'border-left': '1px solid var(--sp-border)'
  })
  assertCssRule(panelBlocks, '.right-panel-title', {
    background: 'var(--sp-surface)',
    'border-bottom': '1px solid var(--sp-border)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-control)'
  })
  assertCssRule(panelBlocks, '.right-panel-ai-config-card', {
    background: 'var(--sp-surface-elevated)',
    border: '1px solid var(--sp-border)',
    'border-radius': 'var(--sp-radius-card)',
    'box-shadow': 'inset 0 1px 0 var(--sp-highlight-top), var(--sp-shadow-card)'
  })
  assertCssRule(panelBlocks, '.right-side-panel-content', {
    'overflow-y': 'auto'
  })

  const footerBlocks = topLevelCssBlocks(await compileStylus(files[3]))
  assertCssRule(footerBlocks, '.main-footer', {
    background: 'var(--sp-surface-elevated)',
    'border-top': '1px solid var(--sp-border)',
    'box-shadow': '0 -3px 8px -6px var(--sp-border-strong)'
  })
})

test('client chrome cannot decorate protected terminal surfaces with semantic UI elevation', async () => {
  const chromeFiles = [
    'components/main/aigshell-topbar.styl',
    'components/sidebar/sidebar.styl',
    'components/side-panel-r/right-side-panel.styl',
    'components/footer/footer.styl'
  ]
  const protectedSurfaceFiles = [
    ...chromeFiles,
    'components/tabs/tabs.styl',
    'components/terminal/terminal.styl'
  ]
  for (const file of protectedSurfaceFiles) {
    assertNoProtectedTerminalElevation(await compileStylus(file), file)
  }

  const tabs = readClient('components/tabs/tabs.styl')
  const terminal = readClient('components/terminal/terminal.styl')
  assert.match(tabs, /\.tabs\.terminal-session-tabs\s*\n\s*background var\(--shellpilot-terminal-background\)[\s\S]*?\.tab\s*\n\s*background var\(--shellpilot-terminal-background\)[\s\S]*?\.tab\.active\s*\n\s*background var\(--shellpilot-terminal-background\)/)
  assert.match(terminal, /shellPilotTerminalBackground\s*=\s*#0E0F12/)
  assert.match(terminal, /\.terms-box\s*\n\s*background shellPilotTerminalBackground/)
  assert.match(terminal, /\.term-wrap\s*\n\s*background shellPilotTerminalBackground/)
  assert.match(terminal, /#container[\s\S]*?\.xterm\s*\n\s*background shellPilotTerminalBackground/)
})

test('terminal elevation guard covers every rendered terminal layer and semantic shadow', () => {
  const selectors = [
    '.tabs.terminal-session-tabs',
    '.terms-box',
    '.terminal-control',
    '.term-wrap',
    '.xterm',
    '.xterm-screen',
    '.xterm-viewport'
  ]
  const states = ['', ':hover', ':focus-visible', '.active', '[data-state="active"]']
  const shadows = [
    '--sp-shadow-control',
    '--sp-shadow-card',
    '--sp-shadow-overlay',
    '--sp-shadow-future-token'
  ]
  for (const selector of selectors) {
    for (const state of states) {
      for (const shadow of shadows) {
        assert.throws(
          () => assertNoProtectedTerminalElevation(
            `${selector}${state} { box-shadow: var(${shadow}); }`,
            'terminal-shadow-mutation.css'
          ),
          `${selector}${state} must reject ${shadow}`
        )
      }
    }
  }
})

test('shell chrome E2E uses concrete scroll mutation, clipping ancestry and document overflow gates', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'test/e2e/022.secondary-ui-visual-matrix.spec.js'), 'utf8')
  const inspect = source.match(/async function inspectShellChrome \(page\) \{([\s\S]*?)\n\}\n\nfunction assertShellChrome/)
  const scrollExercise = source.match(/async function exerciseRightPanelScroll \(page\) \{([\s\S]*?)\n\}\n\nfunction assertShellChrome/)

  assert.ok(inspect)
  assert.ok(scrollExercise)
  assert.match(source, /async function exerciseRightPanelScroll/)
  assert.match(source, /\.right-side-panel-content \.ai-history-wrap/)
  assert.match(source, /scrollTop/)
  assert.match(source, /finally\s*\{/)
  assert.match(source, /scrollFixture\.remove\(\)/)
  assert.doesNotMatch(scrollExercise[1], /container\.style\.(?:height|minHeight|flex)\s*=/)
  assert.match(scrollExercise[1], /beforeClientHeight/)
  assert.doesNotMatch(inspect[1], /querySelectorAll\('\.right-side-panel-content, \.right-side-panel-content \*'\)/)
  for (const selector of ['.ai-icon', '.terminal-info-icon', 'a[href]', '[tabindex]']) {
    assert.ok(inspect[1].includes(selector), `${selector} must be included in shell interactive reachability`)
  }
  assert.match(inspect[1], /clippingAncestors/)
  assert.match(inspect[1], /horizontalScrollReachable/)
  assert.match(inspect[1], /scrollWidth > current\.clientWidth/)
  assert.match(inspect[1], /aria-disabled/)
  assert.match(inspect[1], /documentElement/)
  assert.match(inspect[1], /document\.body/)
  assert.match(inspect[1], /getElementById\('container'\)/)
})

test('footer uses per-text ellipsis instead of clipping the whole status and control row', () => {
  const source = readClient('components/footer/footer.styl')
  const flex = source.match(/\.terminal-footer-flex\r?\n([\s\S]*?)\r?\n\.terminal-footer-unit/)
  const status = source.match(/\.terminal-footer-status\r?\n((?: {2}[^\r\n]*(?:\r?\n|$))*)/)

  assert.ok(flex)
  assert.ok(status)
  assert.doesNotMatch(flex[1], /overflow hidden/)
  assert.doesNotMatch(status[1], /overflow hidden/)
  assert.match(source, /\.terminal-footer-status > span:not\(\.terminal-footer-dot\)[\s\S]*min-width 0[\s\S]*overflow hidden[\s\S]*text-overflow ellipsis/)
})

test('SFTP overflow more defaults safely to English and follows the current preview translator', async () => {
  const { splitOverflowMenu } = await import(moduleUrl('components/sftp/context-menu-utils.js'))
  const items = Array.from({ length: 10 }, (_, index) => ({ key: String(index) }))
  const originalWindow = global.window
  try {
    delete global.window
    assert.equal(
      splitOverflowMenu({ items, clientY: 590, windowHeight: 600 }).at(-1).label,
      'More'
    )
    global.window = { translate: key => key === 'more' ? '更多' : key }
    assert.equal(
      splitOverflowMenu({ items, clientY: 590, windowHeight: 600 }).at(-1).label,
      '更多'
    )
    global.window.translate = key => key === 'more' ? 'More' : key
    assert.equal(
      splitOverflowMenu({ items, clientY: 590, windowHeight: 600 }).at(-1).label,
      'More'
    )
  } finally {
    if (originalWindow === undefined) delete global.window
    else global.window = originalWindow
  }
})

async function compileStylus (relativePath) {
  const absolutePath = path.join(clientRoot, relativePath)
  return await compileStylusSource(readClient(relativePath), absolutePath)
}

test('long Chinese and English fixture copy remains visible at minimum window zoom equivalents', { timeout: 30000 }, async (t) => {
  let chromium
  let launchOptions = { headless: true }
  try {
    chromium = require('playwright').chromium
    const edge = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ].find(fs.existsSync)
    if (edge) {
      launchOptions = { ...launchOptions, executablePath: edge }
    } else if (!fs.existsSync(chromium.executablePath())) {
      return t.skip('No Chromium-compatible browser is installed')
    }
  } catch (error) {
    return t.skip('Playwright is not installed')
  }

  const css = (await Promise.all([
    compileStylus('components/setting-panel/setting.styl'),
    compileStylus('components/bookmark-form/bookmark-form.styl'),
    compileStylus('components/widgets/widgets.styl'),
    compileStylus('components/common/context-menu.styl')
  ])).join('\n')
  const browser = await chromium.launch(launchOptions)
  try {
    const page = await browser.newPage()
    const cases = [
      { width: 590, height: 400, zoom: 1 },
      { width: 820, height: 600, zoom: 1.25 },
      { width: 590, height: 400, zoom: 1.5 }
    ]
    const copy = [
      '保存并新建另一个具有完整高级配置的连接',
      'Save and Create Another Connection with Complete Advanced Configuration'
    ]
    for (const viewport of cases) {
      await page.setViewportSize({
        width: Math.floor(viewport.width / viewport.zoom),
        height: Math.floor(viewport.height / viewport.zoom)
      })
      await page.setContent(`<!doctype html><style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; overflow-x: hidden; font: 14px Arial, sans-serif; }
        .fixture { width: 100%; min-width: 0; }
        .sp-configuration-section { min-width: 0; }
        .ant-form-item-label, .ant-form-item-control, .ant-form-item-control-input, .ant-form-item-control-input-content { min-width: 0; }
        .ant-btn { max-width: 100%; }
        ${css}
      </style><main class="fixture sp-configuration-form">
        <section class="sp-card sp-configuration-section">
          <div class="ant-form-item"><div class="ant-form-item-label"><label data-critical-label>${copy.join(' / ')}</label></div></div>
        </section>
        <div class="ant-form-item sp-configuration-actions" data-action-scope><p class="sp-configuration-action-row">
          ${copy.map(text => `<button class="ant-btn"><span data-critical-button>${text}</span></button>`).join('')}
        </p></div>
        <section class="widgets-shell">
          <div class="widgets-panel-title"><div>
            <h3 data-critical-label>Tool Center / 工具中心</h3>
            <p data-critical-label>Local tools for SSH operations, secure file distribution, and AI integrations / 面向 SSH 运维、安全文件分发和 AI 集成的本地工具</p>
          </div></div>
          <div class="widget-form"><div class="widget-form-hero"><div>
            <div class="widget-form-kicker" data-critical-label>Operations Automation / 运维自动化</div>
            <h3 data-critical-label>Static File Service with Long Configuration Name / 具有较长配置名称的静态文件服务</h3>
          </div></div>
          <div class="ant-form-item"><div class="ant-form-item-explain-error" data-critical-validation>The selected log folder is invalid or not writable / 所选日志目录无效或不可写</div></div>
          <div data-action-scope><button class="ant-btn"><span data-critical-button>Start Service After Validating Configuration / 验证配置后启动服务</span></button></div>
          </div>
        </section>
        <section class="bookmark-form">
          <div class="ant-form-item"><div class="ant-form-item-label"><label data-critical-label>Hostname or IP Address / 主机名或 IP 地址</label></div>
          <div class="ant-form-item-explain-error" data-critical-validation>Maximum 520 characters / 最多 520 个字符</div></div>
          <div class="sp-configuration-actions" data-action-scope><button class="ant-btn"><span data-critical-button>Connect Without Saving / 不保存，直接连接</span></button></div>
        </section>
        <section class="batch-op-editor sp-card">
          <div data-action-scope>
            <button class="ant-btn"><span data-critical-button>Load Template / 载入模板</span></button>
            <button class="ant-btn"><span data-critical-button>Run Task / 执行任务</span></button>
          </div>
          <div class="batch-op-logs"><div class="bold" data-critical-label>Execution Log / 执行日志</div>
          <div class="batch-op-log-entry completed" data-critical-validation>Task completed successfully / 任务执行完成</div></div>
        </section>
        <div class="shellpilot-context-menu ant-dropdown"><ul class="ant-dropdown-menu"><li class="ant-dropdown-menu-item"><span class="ant-dropdown-menu-title-content" data-menu-copy>${copy.join(' / ')}</span></li></ul></div>
      </main>`)
      const geometry = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth
        const critical = [...document.querySelectorAll('[data-critical-label], [data-critical-button], [data-critical-validation], [data-menu-copy]')]
          .map(element => {
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            return {
              right: rect.right,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              whiteSpace: style.whiteSpace,
              textOverflow: style.textOverflow,
              overflowWrap: style.overflowWrap
            }
          })
        const buttons = [...document.querySelectorAll('[data-critical-button]')]
          .map(element => ({
            button: element.closest('button').getBoundingClientRect(),
            scope: element.closest('[data-action-scope]').getBoundingClientRect()
          }))
        return {
          viewportWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          critical,
          buttons
        }
      })
      assert.ok(geometry.pageScrollWidth <= geometry.viewportWidth, JSON.stringify(viewport))
      for (const item of geometry.critical) {
        assert.notEqual(item.textOverflow, 'ellipsis', JSON.stringify({ viewport, item }))
        assert.notEqual(item.whiteSpace, 'nowrap', JSON.stringify({ viewport, item }))
        assert.ok(item.right <= geometry.viewportWidth + 1, JSON.stringify({ viewport, item }))
        assert.ok(item.left >= -1, JSON.stringify({ viewport, item }))
      }
      for (const { button, scope } of geometry.buttons) {
        assert.ok(button.left >= scope.left - 1, JSON.stringify({ viewport, button, scope }))
        assert.ok(button.right <= scope.right + 1, JSON.stringify({ viewport, button, scope }))
      }
    }
  } finally {
    await browser.close()
  }
})

test('main workbench layout constants remain untouched by secondary UI copy work', () => {
  const layout = readClient('components/main/aigshell-layout.js')
  assert.match(layout, /aigshellTopBarHeight = 44/)
  assert.match(layout, /minRightPanelWidth = 320/)
})

test('injects a UI-only font variable and leaves terminal font fields separate', () => {
  const main = readClient('components/main/main.jsx')
  const basic = readClient('css/basic.styl')
  const injector = readClient('components/main/ui-font.jsx')
  assert.match(main, /<UiFont presetId=\{effectiveUiFontPresetId\}/)
  assert.match(basic, /font-family var\(--sp-ui-font-family/)
  assert.match(injector, /--sp-ui-font-family/)
  assert.match(injector, /getUiFontAvailability/)
  assert.match(injector, /getUiFontPreset\('system'\)/)
  assert.doesNotMatch(injector, /fontFamily|terminalBackgroundTextFontFamily/)
  assert.doesNotMatch(basic, /\.xterm[\s\S]{0,120}--sp-ui-font-family/)
})
