const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const stylus = require('stylus')

const projectRoot = path.resolve(__dirname, '../..')

function read (relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8')
}

function parse (relativePath) {
  return parser.parse(read(relativePath), {
    sourceType: 'module',
    plugins: ['jsx']
  })
}

function nodeName (node) {
  if (!node) return ''
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name
  if (node.type === 'MemberExpression' || node.type === 'JSXMemberExpression') {
    return `${nodeName(node.object)}.${nodeName(node.property)}`
  }
  return ''
}

function walk (node, visitor) {
  if (!node || typeof node !== 'object') return
  visitor(node)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end'].includes(key)) continue
    if (Array.isArray(value)) {
      value.forEach(child => walk(child, visitor))
    } else if (value && typeof value === 'object') {
      walk(value, visitor)
    }
  }
}

function findFunction (ast, name) {
  let result
  traverse(ast, {
    FunctionDeclaration (item) {
      if (item.node.id && item.node.id.name === name) result = item.node
    },
    VariableDeclarator (item) {
      if (item.node.id.type === 'Identifier' && item.node.id.name === name) {
        result = item.node.init
      }
    }
  })
  assert.ok(result, `function ${name} must exist`)
  return result
}

function getJsxAttribute (openingElement, name) {
  return openingElement.attributes.find(attribute => (
    attribute.type === 'JSXAttribute' && attribute.name.name === name
  ))
}

function attributeValue (attribute) {
  if (!attribute || !attribute.value) return true
  if (attribute.value.type === 'StringLiteral') return attribute.value.value
  if (attribute.value.type === 'JSXExpressionContainer') {
    const expression = attribute.value.expression
    if (expression.type === 'Identifier' || expression.type === 'MemberExpression') {
      return nodeName(expression)
    }
    if (expression.type === 'BooleanLiteral') return expression.value
  }
  return null
}

function jsxElements (ast, name) {
  const result = []
  traverse(ast, {
    JSXOpeningElement (item) {
      if (nodeName(item.node.name) === name) result.push(item.node)
    }
  })
  return result
}

function objectPropertyValues (ast, name) {
  const result = []
  traverse(ast, {
    ObjectProperty (item) {
      if (nodeName(item.node.key) === name) result.push(literalValue(item.node.value))
    }
  })
  return result
}

function classNames (ast) {
  const result = []
  traverse(ast, {
    JSXOpeningElement (item) {
      const value = attributeValue(getJsxAttribute(item.node, 'className'))
      if (typeof value === 'string') result.push(value)
    }
  })
  return result
}

function literalValue (node) {
  if (node.type === 'StringLiteral' || node.type === 'BooleanLiteral') return node.value
  if (node.type === 'Identifier' || node.type === 'MemberExpression') return nodeName(node)
  return node.type
}

function callsIn (fn, callee) {
  const calls = []
  walk(fn.body, node => {
    if (node.type === 'CallExpression' && nodeName(node.callee) === callee) {
      calls.push(node.arguments.map(literalValue))
    }
  })
  return calls
}

function buttonHandlersIn (fn) {
  const handlers = []
  walk(fn.body, node => {
    if (node.type !== 'JSXOpeningElement' || nodeName(node.name) !== 'Button') return
    handlers.push({
      htmlType: attributeValue(getJsxAttribute(node, 'htmlType')),
      onClick: attributeValue(getJsxAttribute(node, 'onClick'))
    })
  })
  return handlers
}

async function compileStylus (relativePath) {
  const source = read(relativePath)
  return await new Promise((resolve, reject) => {
    stylus(source).set('filename', path.resolve(projectRoot, relativePath)).render((error, css) => {
      if (error) reject(error)
      else resolve(css)
    })
  })
}

test('bookmark presentation preserves submit routing, button order and tab mounting', () => {
  const renderer = parse('src/client/components/bookmark-form/form-renderer.jsx')
  const buttons = parse('src/client/components/bookmark-form/common/submit-buttons.jsx')

  assert.deepEqual(callsIn(findFunction(renderer, 'handleFinish'), 'handleSubmit'), [
    ['save', 'res', false],
    ['saveAndCreateNew', 'res', false],
    ['connect', 'res', false],
    ['test', 'res', true],
    ['submit', 'res', false]
  ])
  assert.deepEqual(buttonHandlersIn(findFunction(buttons, 'SubmitButtons')), [
    { htmlType: 'submit', onClick: true },
    { htmlType: true, onClick: 'onSaveAndCreateNew' },
    { htmlType: true, onClick: 'onSave' },
    { htmlType: true, onClick: 'onConnect' },
    { htmlType: true, onClick: 'onTestConnection' }
  ])

  const rendererClasses = classNames(renderer)
  assert.ok(rendererClasses.includes('sp-card sp-configuration-section'))
  assert.ok(rendererClasses.includes('sp-configuration-tabs'))
  const form = jsxElements(renderer, 'Form')[0]
  assert.equal(attributeValue(getJsxAttribute(form, 'onFinish')), 'handleFinish')
  assert.equal(attributeValue(getJsxAttribute(form, 'className')), 'sp-configuration-form')
  assert.deepEqual(objectPropertyValues(renderer, 'forceRender'), [true])

  const formItem = jsxElements(buttons, 'FormItem')[0]
  assert.equal(attributeValue(getJsxAttribute(formItem, 'className')), 'sp-configuration-actions')
})

test('AI configuration keeps save and test handlers while opting into the scoped card form', () => {
  const ast = parse('src/client/components/ai/ai-config.jsx')
  const modalAst = parse('src/client/components/ai/ai-config-modal.jsx')
  const form = jsxElements(ast, 'Form').find(item => (
    attributeValue(getJsxAttribute(item, 'onFinish')) === 'handleSubmit'
  ))

  assert.ok(form)
  assert.equal(attributeValue(getJsxAttribute(form, 'onFinish')), 'handleSubmit')
  assert.equal(
    attributeValue(getJsxAttribute(form, 'className')),
    'ai-config-form sp-card sp-configuration-section sp-ai-config-form'
  )
  assert.deepEqual(callsIn(findFunction(ast, 'handleSubmit'), 'onSubmit'), [['ObjectExpression']])
  assert.deepEqual(callsIn(findFunction(ast, 'handleSubmit'), 'addHistoryItem'), [
    ['STORAGE_KEY_CONFIG', 'nextValues', 'EVENT_NAME_CONFIG']
  ])

  const buttons = buttonHandlersIn(findFunction(ast, 'AIConfigForm'))
  assert.deepEqual(buttons.slice(-2), [
    { htmlType: 'submit', onClick: true },
    { htmlType: true, onClick: 'handleTest' }
  ])

  const modal = jsxElements(modalAst, 'Modal')[0]
  assert.equal(attributeValue(getJsxAttribute(modal, 'onCancel')), 'handleClose')
  assert.equal(attributeValue(getJsxAttribute(modal, 'destroyOnClose')), true)
  assert.deepEqual(callsIn(findFunction(ast, 'handleTest'), 'form.validateFields'), [
    ['ArrayExpression']
  ])
})

test('sync presentation preserves tab selection, persistence, transfer and clearing callbacks', () => {
  const entry = parse('src/client/components/setting-sync/setting-sync.jsx')
  const formAst = parse('src/client/components/setting-sync/setting-sync-form.jsx')
  const entryClasses = classNames(entry)

  assert.ok(entryClasses.includes('pd2l sp-sync-config'))
  assert.ok(entryClasses.includes('sp-card sp-configuration-section sp-sync-transport'))
  assert.ok(entryClasses.includes('sp-card sp-configuration-section sp-sync-data-selector'))

  const tabs = jsxElements(entry, 'Tabs')[0]
  assert.equal(attributeValue(getJsxAttribute(tabs, 'activeKey')), 'store.syncType')
  assert.equal(attributeValue(getJsxAttribute(tabs, 'onChange')), 'handleChange')
  assert.equal(
    attributeValue(getJsxAttribute(tabs, 'className')),
    'sp-configuration-tabs sp-sync-config-tabs'
  )

  const form = jsxElements(formAst, 'Form')[0]
  assert.equal(attributeValue(getJsxAttribute(form, 'onFinish')), 'save')
  assert.equal(
    attributeValue(getJsxAttribute(form, 'className')),
    'form-wrap pd1x sp-card sp-configuration-section sp-sync-config-form'
  )
  assert.deepEqual(callsIn(findFunction(formAst, 'upload'), 'window.store.uploadSetting'), [['props.syncType']])
  assert.deepEqual(callsIn(findFunction(formAst, 'download'), 'window.store.downloadSetting'), [['props.syncType']])
  assert.deepEqual(callsIn(findFunction(formAst, 'save'), 'window.store.updateSyncSetting'), [['up']])
  assert.deepEqual(callsIn(findFunction(formAst, 'save'), 'window.store.testSyncToken'), [
    ['syncType', 'res.gistId']
  ])

  const syncForm = jsxElements(entry, 'SyncForm')[0]
  assert.equal(attributeValue(getJsxAttribute(syncForm, 'encrypt')), 'syncSetting.syncEncrypt')
  assert.equal(jsxElements(entry, 'DataTransport').length, 1)
  assert.equal(jsxElements(entry, 'DataSelect').length, 1)

  const buttons = buttonHandlersIn(findFunction(formAst, 'SyncForm')).slice(-4)
  assert.deepEqual(buttons, [
    { htmlType: 'submit', onClick: true },
    { htmlType: true, onClick: 'upload' },
    { htmlType: true, onClick: 'download' },
    { htmlType: true, onClick: 'window.store.handleClearSyncSetting' }
  ])
})

test('configuration styles compile and constrain cards, sticky actions and local tab rails', async () => {
  const bookmark = read('src/client/components/bookmark-form/bookmark-form.styl')
  const ai = read('src/client/components/ai/ai.styl')
  const setting = read('src/client/components/setting-panel/setting.styl')

  await Promise.all([
    compileStylus('src/client/components/bookmark-form/bookmark-form.styl'),
    compileStylus('src/client/components/ai/ai.styl'),
    compileStylus('src/client/components/setting-panel/setting.styl')
  ])

  assert.match(bookmark, /\.sp-configuration-form[\s\S]*padding-bottom 104px/)
  assert.match(bookmark, /\.sp-configuration-actions[\s\S]*position sticky[\s\S]*bottom 0[\s\S]*flex-wrap wrap/)
  assert.match(bookmark, /@media \(max-width: 760px\)[\s\S]*\.sp-configuration-tabs[\s\S]*overflow-x auto/)
  assert.match(bookmark, /@media \(max-width: 760px\) and \(max-height: 520px\)[\s\S]*padding-bottom 16px[\s\S]*\.sp-configuration-actions[\s\S]*position static/)
  assert.match(ai, /\.sp-ai-config-form[\s\S]*var\(--sp-surface\)[\s\S]*overflow-wrap/)
  assert.match(ai, /@media \(max-width: 680px\)[\s\S]*\.sp-ai-config-form[\s\S]*\.ant-space-compact[\s\S]*flex-wrap wrap/)
  assert.match(setting, /\.sp-sync-config[\s\S]*overflow-x hidden/)
  assert.match(setting, /\.sp-sync-config-form[\s\S]*var\(--sp-border\)[\s\S]*min-width 0/)
  assert.match(setting, /\.sp-sync-config-actions[\s\S]*flex-wrap wrap/)
  assert.match(setting, /@media \(max-width: 760px\)[\s\S]*\.sp-sync-config-tabs[\s\S]*overflow-x auto/)

  for (const effectiveWidth of [590, 472, 393]) {
    assert.ok(effectiveWidth <= 760, `${effectiveWidth}px must use the local rail contract`)
  }

  for (const [source, marker] of [
    [bookmark, '// ShellPilot connection configuration surfaces'],
    [ai, '// ShellPilot model API configuration card'],
    [setting, '// ShellPilot data synchronization configuration cards']
  ]) {
    const scopedStyles = source.slice(source.indexOf(marker))
    assert.doesNotMatch(scopedStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i)
    assert.doesNotMatch(scopedStyles, /^\.ant-/m)
  }
})
