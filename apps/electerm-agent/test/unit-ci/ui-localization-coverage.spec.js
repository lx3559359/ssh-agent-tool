const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const clientRoot = path.resolve(__dirname, '../../src/client')
const catalogUrl = pathToFileURL(path.join(
  clientRoot,
  'common/shellpilot-i18n-overrides.js'
)).href
const allowedTechnicalCopy = new Set([
  'ShellPilot', 'SSH', 'SFTP', 'AI', 'API', 'MCP', 'CLI', 'GitHub',
  'ModelScope', 'Windows', 'macOS', 'Linux', 'RDP', 'VNC', 'SPICE',
  'Telnet', 'Serial', 'FTP', 'HTTP', 'HTTPS', 'WebSocket', 'JSON',
  'XMODEM', 'trz', 'rz', 'src:', 'GitHub ➾', 'Markdown', 'HTML',
  'Groq', 'xAI Grok', 'Together AI', 'stdio', 'AtlasCloud',
  'Digest', 'Digest:', 'CPU', 'PID', 'DNS', 'inode',
  'CAPS', 'SSH Agent', 'Try', 'Shift + Backspace', 'wiki', 'Shift+Enter',
  'root@server:~#', 'systemctl status nginx', '● active (running)',
  'connect, command, sftp_upload, sftp_download'
])
const allowedTechnicalCopyLower = new Set(
  [...allowedTechnicalCopy].map(value => value.toLowerCase())
)
const userFacingAttributes = new Set([
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'description',
  'moduleName'
])
const userFacingPropertyNames = /^(?:label|title|description|message|placeholder)$/i

function meaningfulCopy (value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || allowedTechnicalCopyLower.has(text.toLowerCase())) return false
  if (/^shellpilot[A-Z]/.test(text)) return false
  if (/^[a-z][\w+.-]*:\/\//i.test(text)) return false
  if (/\p{Script=Han}/u.test(text)) return true
  return /[A-Za-z]{3,}/.test(text)
}

function location (file, node, value) {
  return `${file}:${node.loc?.start.line || 0}: ${String(value).replace(/\s+/g, ' ').trim()}`
}

function parseFile (relativeFile) {
  const absolute = path.join(clientRoot, relativeFile)
  const source = fs.readFileSync(absolute, 'utf8')
  return parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining', 'classProperties']
  })
}

function isTranslationArgument (item) {
  const call = item.findParent(parent => parent.isCallExpression())
  const callee = call?.node?.callee
  const name = callee?.name || callee?.property?.name || ''
  return ['e', 'translate', 'tf', 'formatShellPilotTranslation'].includes(name)
}

function objectPropertyName (item) {
  const property = item.findParent(parent => parent.isObjectProperty())
  const key = property?.node?.key
  return key?.name || key?.value || ''
}

function isVisibleJsxString (item) {
  const attribute = item.findParent(parent => parent.isJSXAttribute())
  if (attribute) {
    if (!userFacingAttributes.has(attribute.node.name?.name)) return false
    let current = item.parentPath
    while (current && current !== attribute) {
      if (current.isBinaryExpression() || current.isUnaryExpression() || current.isCallExpression()) return false
      current = current.parentPath
    }
    return true
  }
  const container = item.findParent(parent => parent.isJSXExpressionContainer())
  if (!container) return false
  let current = item.parentPath
  while (current && current !== container) {
    if (current.isBinaryExpression() || current.isUnaryExpression()) return false
    current = current.parentPath
  }
  const call = item.findParent(parent => parent.isCallExpression())
  return !call || !call.findParent(parent => parent === container)
}

function isUserFacingMapValue (item) {
  const property = item.findParent(parent => parent.isObjectProperty())
  if (!property || property.node.value !== item.node) return false
  return userFacingPropertyNames.test(objectPropertyName(item))
}

function collectViolations (relativeFile) {
  const ast = parseFile(relativeFile)
  const violations = []
  traverse(ast, {
    JSXText (item) {
      if (meaningfulCopy(item.node.value)) {
        violations.push(location(relativeFile, item.node, item.node.value))
      }
    },
    JSXAttribute (item) {
      const name = item.node.name?.name
      const value = item.node.value?.type === 'StringLiteral'
        ? item.node.value.value
        : ''
      if (userFacingAttributes.has(name) && meaningfulCopy(value)) {
        violations.push(location(relativeFile, item.node, value))
      }
    },
    StringLiteral (item) {
      if (isTranslationArgument(item)) return
      if ((isVisibleJsxString(item) || isUserFacingMapValue(item)) && meaningfulCopy(item.node.value)) {
        violations.push(location(relativeFile, item.node, item.node.value))
      }
    },
    TemplateLiteral (item) {
      const value = item.node.quasis.map(part => part.value.cooked).join(' ')
      if ((isVisibleJsxString(item) || isUserFacingMapValue(item)) && meaningfulCopy(value)) {
        violations.push(location(relativeFile, item.node, value))
      }
    }
  })
  return [...new Set(violations)]
}

function collectShellPilotKeys (relativeFile) {
  const ast = parseFile(relativeFile)
  const keys = []
  traverse(ast, {
    StringLiteral (item) {
      if (/^shellpilot[A-Z]/.test(item.node.value)) keys.push(item.node.value)
    }
  })
  return [...new Set(keys)]
}

function jsxFilesUnder (relativeDirectory) {
  const directory = path.join(clientRoot, relativeDirectory)
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name.endsWith('.jsx')) {
        files.push(path.relative(clientRoot, absolute).replace(/\\/g, '/'))
      }
    }
  }
  visit(directory)
  return files.sort()
}

const coreSurfaceFiles = [
  'components/main/aigshell-topbar.jsx',
  'components/setting-panel/setting-header.jsx',
  'components/setting-panel/setting-common.jsx',
  'components/setting-panel/setting-modal.jsx',
  'components/theme/theme-gallery.jsx',
  'components/theme/theme-form.jsx',
  'components/theme/theme-editor.jsx',
  'components/common/modal.jsx',
  'components/common/notification.jsx'
]
const connectionSurfaceFiles = [
  ...jsxFilesUnder('components/bookmark-form'),
  ...jsxFilesUnder('components/profile'),
  ...jsxFilesUnder('components/sidebar'),
  ...jsxFilesUnder('components/sftp'),
  ...jsxFilesUnder('components/file-transfer'),
  ...jsxFilesUnder('components/terminal')
]
const finalSurfaceFiles = [
  ...jsxFilesUnder('components/ai'),
  ...jsxFilesUnder('components/fleet-status'),
  ...jsxFilesUnder('components/widgets'),
  ...jsxFilesUnder('components/batch-op'),
  ...jsxFilesUnder('components/server-status'),
  ...jsxFilesUnder('components/main')
]
const allAuditedSurfaceFiles = [...new Set([
  ...jsxFilesUnder('components'),
  ...coreSurfaceFiles,
  ...connectionSurfaceFiles,
  ...finalSurfaceFiles
])]
const auditedSurfaceFiles = process.env.SHELLPILOT_LOCALIZATION_SCOPE
  ? allAuditedSurfaceFiles.filter(file => file.startsWith(process.env.SHELLPILOT_LOCALIZATION_SCOPE))
  : allAuditedSurfaceFiles

test('audited UI surfaces contain no hard-coded presentation copy', () => {
  const violations = auditedSurfaceFiles.flatMap(collectViolations)
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('audited ShellPilot translation keys exist in both complete catalogs', async () => {
  const { getShellPilotCatalogKeys } = await import(catalogUrl)
  const chineseKeys = new Set(getShellPilotCatalogKeys('zh_cn'))
  const englishKeys = new Set(getShellPilotCatalogKeys('en_us'))
  const referencedKeys = auditedSurfaceFiles.flatMap(collectShellPilotKeys)
  const missing = referencedKeys.flatMap(key => [
    ...(!chineseKeys.has(key) ? [`zh_cn:${key}`] : []),
    ...(!englishKeys.has(key) ? [`en_us:${key}`] : [])
  ])
  assert.deepEqual(missing, [], missing.join('\n'))
})
