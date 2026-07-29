const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

function parseClient (file) {
  return parser.parse(readClient(file), {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining']
  })
}

function assertJsxExists (file, name) {
  let found = false
  traverse(parseClient(file), {
    JSXOpeningElement (elementPath) {
      if (t.isJSXIdentifier(elementPath.node.name, { name })) {
        found = true
      }
    }
  })
  assert.ok(found, `${file} must render ${name}`)
}

function assertSourceMatches (file, expression) {
  assert.match(readClient(file), expression)
}

function findJsxOpening (ast, name) {
  let result
  traverse(ast, {
    JSXOpeningElement (elementPath) {
      if (!result && t.isJSXIdentifier(elementPath.node.name, { name })) {
        result = elementPath
      }
    }
  })
  return result
}

test('incident workspace renders a paginated list and detail region', () => {
  assertJsxExists('components/incidents/incident-workspace.jsx', 'IncidentList')
  assertJsxExists('components/incidents/incident-workspace.jsx', 'IncidentDetail')
  assertJsxExists('components/incidents/incident-list.jsx', 'Pagination')
  assertSourceMatches(
    'components/incidents/incident-list.jsx',
    /onChange=\{\(page, pageSize\) => store\.loadIncidentArchives/
  )
  assertSourceMatches(
    'components/incidents/incident-list.jsx',
    /shellpilotIncidentEmpty/
  )
})

test('incident list exposes bounded filters and a debounced search', () => {
  const source = readClient('components/incidents/incident-list.jsx')
  assert.match(source, /store\.bookmarks/)
  assert.match(source, /serviceTags/)
  assert.match(source, /customTags/)
  assert.match(source, /favoriteOnly/)
  assert.match(source, /updatedFrom/)
  assert.match(source, /updatedTo/)
  assert.match(source, /setTimeout\([^]*300\)/)
  assert.match(source, /pageSizeOptions=\{\[20, 40, 80\]\}/)
})

test('incident workspace layout is compact and does not use oversized text', () => {
  const styles = readClient('components/incidents/incidents.styl')
  assert.match(
    styles,
    /grid-template-columns\s+minmax\(260px,\s*340px\)\s+minmax\(0,\s*1fr\)/
  )
  assert.match(styles, /border-radius\s+6px/)
  assert.doesNotMatch(styles, /font-size\s+[2-9]\dpx/)
})

test('incident detail keeps a local draft and enforces verification', () => {
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /shellpilotIncidentVerificationRequired/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /setDraft\(toIncidentDraft\(incident\)\)/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /store\.updateActiveIncident/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /store\.transitionActiveIncident/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /passed_manual/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /passed_auto/
  )
})

test('incident notes and backup restore have explicit safety gates', () => {
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /store\.addActiveIncidentNote/
  )
  assertSourceMatches(
    'components/incidents/incident-detail.jsx',
    /event\.ctrlKey && event\.key === 'Enter'/
  )
  assertSourceMatches(
    'components/incidents/incident-storage-modal.jsx',
    /confirmation !== 'RESTORE'/
  )
  assertSourceMatches(
    'components/incidents/incident-storage-modal.jsx',
    /store\.restoreIncidentBackup/
  )
  assertSourceMatches(
    'components/incidents/incident-storage-modal.jsx',
    /shellpilotIncidentRestoreWarning/
  )
})

test('main lazily mounts incident archives without unmounting terminal or AI', () => {
  const source = readClient('components/main/main.jsx')
  assert.match(
    source,
    /const IncidentArchiveWorkspace = lazy\(\(\) => import\('\.\.\/incidents\/entry'\)\)/
  )
  assert.match(
    source,
    /store\.mainWorkspaceMode === 'incident-archives'/
  )
  assert.match(
    source,
    /incident:\$\{store\.activeIncidentId \|\| 'workspace'\}/
  )

  const ast = parseClient('components/main/main.jsx')
  const layout = findJsxOpening(ast, 'Layout')
  const incidents = findJsxOpening(ast, 'IncidentArchiveWorkspace')
  const rightPanel = findJsxOpening(ast, 'RightSidePanel')
  assert.ok(layout)
  assert.ok(incidents)
  assert.ok(rightPanel)
  assert.equal(
    Boolean(layout.findParent(parentPath => (
      parentPath.isConditionalExpression() || parentPath.isLogicalExpression()
    ))),
    false
  )
  assert.ok(incidents.node.start > layout.node.start)
  assert.ok(rightPanel.node.start > incidents.node.start)
})

test('sidebar exposes a dedicated incident archive entry', () => {
  assertSourceMatches(
    'components/sidebar/index.jsx',
    /shellpilotSidebarIncidents/
  )
  assertSourceMatches(
    'components/sidebar/index.jsx',
    /store\.openIncidentArchiveWorkspace\(\)/
  )
})

test('empty workspace surfaces unresolved incident summary', () => {
  assertJsxExists('components/tabs/no-session.jsx', 'IncidentHomeSummary')
  assertSourceMatches(
    'components/incidents/incident-home-summary.jsx',
    /store\.loadIncidentSummary\(\)/
  )
  assertSourceMatches(
    'components/incidents/incident-home-summary.jsx',
    /summary\.unresolvedCount/
  )
  assertSourceMatches(
    'components/incidents/incident-home-summary.jsx',
    /summary\.recentUnresolved/
  )
})
