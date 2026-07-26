# ShellPilot AI Office Artifact Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lazy-loaded ShellPilot artifact workspace that lets AI create, preview, lightly edit, version, export, and safely upload DOCX, XLSX, PDF, Markdown, and CSV operations deliverables without changing terminal startup behavior.

**Architecture:** The renderer owns bounded artifact drafts, UI state, previews, and Agent tool orchestration. The Electron main process owns atomic artifact storage, deterministic file generation, local export, and external opening. Existing SSH/SFTP, Agent cancellation, risk confirmation, audit, and rollback paths remain authoritative; artifact features integrate through their public adapters.

**Tech Stack:** Electron 41, React 19, Manate, Ant Design, Node.js, `docx@9.7.1`, `exceljs@4.4.0`, Electron `webContents.printToPDF`, Node test runner, Playwright.

---

## File Map

### Artifact domain and renderer client

- Create `src/client/components/artifacts/artifact-model.js`: bounded draft normalization, version projections, format metadata, and secret redaction.
- Create `src/client/components/artifacts/artifact-client.js`: typed renderer wrapper over artifact IPC operations.
- Create `src/client/store/ai-artifacts.js`: Manate actions and workspace state.
- Modify `src/client/store/init-state.js`: initialize artifact workspace state.
- Modify `src/client/store/store.js`: register the artifact store extension.

### Main-process storage and generation

- Create `src/app/lib/ai-artifacts/artifact-validator.js`: main-process trust-boundary validation.
- Create `src/app/lib/ai-artifacts/artifact-repository.js`: atomic manifests, versions, cleanup, and safe paths.
- Create `src/app/lib/ai-artifacts/artifact-service.js`: repository and generator orchestration.
- Create `src/app/lib/ai-artifacts/generator-registry.js`: format handler registry.
- Create `src/app/lib/ai-artifacts/markdown-generator.js`: Markdown output.
- Create `src/app/lib/ai-artifacts/csv-generator.js`: CSV output.
- Create `src/app/lib/ai-artifacts/docx-generator.js`: DOCX output.
- Create `src/app/lib/ai-artifacts/xlsx-generator.js`: XLSX output.
- Create `src/app/lib/ai-artifacts/report-html.js`: sandboxed printable HTML.
- Create `src/app/lib/ai-artifacts/pdf-printer.js`: hidden-window PDF adapter.
- Create `src/app/lib/ai-artifacts/pdf-generator.js`: PDF output using injected printer.
- Modify `src/app/lib/ipc.js`: expose bounded artifact operations.
- Modify `package.json` and `package-lock.json`: add exact document dependencies.

### Workspace and chat UI

- Create `src/client/components/artifacts/entry.jsx`: lazy workspace entry with module error boundary.
- Create `src/client/components/artifacts/artifact-workspace.jsx`: list, filters, editor, and preview shell.
- Create `src/client/components/artifacts/artifact-list.jsx`: searchable artifact list.
- Create `src/client/components/artifacts/artifact-preview.jsx`: format-specific preview router.
- Create `src/client/components/artifacts/document-preview.jsx`: paginated report preview and light editor.
- Create `src/client/components/artifacts/spreadsheet-preview.jsx`: virtualized spreadsheet preview and light editor.
- Create `src/client/components/artifacts/artifact-card.jsx`: compact chat card.
- Create `src/client/components/artifacts/create-artifact-menu.jsx`: visible “生成成果” menu.
- Create `src/client/components/artifacts/artifacts.styl`: day/night and responsive styles.
- Modify `src/client/components/main/main.jsx`: mount lazy artifact workspace.
- Modify `src/client/components/sidebar/index.jsx`: add the “成果” navigation icon.
- Modify `src/client/components/ai/ai-output.jsx`: render persisted artifact cards and legacy file blocks.
- Modify `src/client/components/ai/ai-chat.jsx`: mount the generation menu near the input actions.

### AI, operations, and SFTP integration

- Create `src/client/components/ai/artifact-agent-tools.js`: conversation-scoped artifact tool schemas and dispatch.
- Modify `src/client/components/ai/agent-tools.js`: register artifact tools.
- Modify `src/client/components/ai/agent.js`: persist artifact IDs created during an Agent run.
- Create `src/client/components/artifacts/artifact-templates.js`: initial operations report and table templates.
- Create `src/client/components/artifacts/artifact-source-context.js`: bounded context builders for diagnostics, fleet status, and safety records.
- Create `src/client/components/artifacts/artifact-export-actions.js`: local export, external open, and SFTP handoff.

### Tests

- Create `test/unit-ci/ai-artifact-model.spec.js`
- Create `test/unit-ci/ai-artifact-repository.spec.js`
- Create `test/unit-ci/ai-artifact-generators.spec.js`
- Create `test/unit-ci/ai-artifact-store.spec.js`
- Create `test/unit-ci/ai-artifact-agent-tools.spec.js`
- Create `test/unit-ci/ai-artifact-source-context.spec.js`
- Create `test/unit-ci/ai-artifact-ui.spec.js`
- Create `test/e2e/032.ai-office-artifacts.spec.js`
- Modify `build/bin/package-smoke-test.js`: assert lazy artifact chunks and bundled dependencies.

## Task 1: Define and Bound the Artifact Domain

**Files:**
- Create: `src/client/components/artifacts/artifact-model.js`
- Test: `test/unit-ci/ai-artifact-model.spec.js`

- [ ] **Step 1: Write failing model tests**

```js
test('normalizes a bounded operations report and strips secrets', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)
  const draft = normalizeArtifactDraft({
    type: 'diagnostic-report',
    title: '生产服务器诊断',
    server: 'prod-web-01',
    sections: [{ id: 'summary', title: '摘要', content: 'token=secret-token' }],
    tables: [{ id: 'ports', title: '端口', columns: ['端口'], rows: [[443]] }]
  })
  assert.equal(draft.schemaVersion, 1)
  assert.equal(draft.sections[0].content, 'token=[已隐藏]')
  assert.deepEqual(draft.tables[0].rows, [['443']])
})

test('rejects oversized and unsupported drafts', async () => {
  const { normalizeArtifactDraft } = await import(moduleUrl)
  assert.throws(
    () => normalizeArtifactDraft({ type: 'binary', title: 'x' }),
    error => error.code === 'ARTIFACT_TYPE_UNSUPPORTED'
  )
  assert.throws(
    () => normalizeArtifactDraft({
      type: 'diagnostic-report',
      title: 'x',
      sections: [{ title: 'x', content: 'x'.repeat(1_000_001) }]
    }),
    error => error.code === 'ARTIFACT_TOO_LARGE'
  )
})
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test test/unit-ci/ai-artifact-model.spec.js`

Expected: FAIL because `artifact-model.js` does not exist.

- [ ] **Step 3: Implement the bounded model**

Implement and export:

```js
export const ARTIFACT_TYPES = new Set([
  'diagnostic-report',
  'inspection-report',
  'asset-inventory',
  'change-record',
  'security-report',
  'incident-review',
  'custom-document',
  'custom-spreadsheet'
])

export const ARTIFACT_FORMATS = new Set(['docx', 'xlsx', 'pdf', 'md', 'csv'])

export function redactArtifactText (value) {
  return String(value ?? '')
    .replace(
      /\b(api[_ -]?key|token|password|passwd|cookie)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[已隐藏]'
    )
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[私钥已隐藏]')
}

export function normalizeArtifactDraft (input = {}) {
  const type = String(input.type || '').trim()
  if (!ARTIFACT_TYPES.has(type)) {
    throw artifactError('ARTIFACT_TYPE_UNSUPPORTED', '不支持的成果类型')
  }
  const draft = {
    schemaVersion: 1,
    type,
    title: bounded(input.title, 160, '未命名成果'),
    server: bounded(input.server, 160),
    summary: redactArtifactText(bounded(input.summary, 16000)),
    sections: normalizeSections(input.sections),
    tables: normalizeTables(input.tables),
    risks: normalizeTextArray(input.risks, 200),
    recommendations: normalizeTextArray(input.recommendations, 200)
  }
  if (JSON.stringify(draft).length > 1_000_000) {
    throw artifactError('ARTIFACT_TOO_LARGE', '成果内容超过 1,000,000 字符')
  }
  return Object.freeze(draft)
}
```

Keep all helper limits explicit: 128 sections, 32 tables, 2,000 rows per table, 64 columns, and 32,000 characters per cell.

- [ ] **Step 4: Run the model tests**

Run: `node --test test/unit-ci/ai-artifact-model.spec.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/client/components/artifacts/artifact-model.js test/unit-ci/ai-artifact-model.spec.js
git commit -m "feat: define bounded AI artifact model"
```

## Task 2: Add Atomic Artifact Storage Behind IPC

**Files:**
- Create: `src/app/lib/ai-artifacts/artifact-validator.js`
- Create: `src/app/lib/ai-artifacts/artifact-repository.js`
- Create: `src/app/lib/ai-artifacts/artifact-service.js`
- Create: `src/client/components/artifacts/artifact-client.js`
- Modify: `src/app/lib/ipc.js`
- Test: `test/unit-ci/ai-artifact-repository.spec.js`

- [ ] **Step 1: Write failing repository tests**

Cover:

```js
test('creates immutable versions with atomic manifests', async () => {
  const repository = createArtifactRepository({ rootPath: tempRoot, now: () => 1000 })
  const created = await repository.create({ title: '巡检', type: 'inspection-report', source: sourceDraft })
  const updated = await repository.createVersion(created.id, { ...sourceDraft, summary: 'v2' })
  assert.equal(created.version, 1)
  assert.equal(updated.version, 2)
  assert.equal((await repository.get(created.id)).versions.length, 2)
})

test('rejects traversal and limits artifact IDs', async () => {
  const repository = createArtifactRepository({ rootPath: tempRoot })
  await assert.rejects(
    repository.get('../outside'),
    error => error.code === 'ARTIFACT_ID_INVALID'
  )
})
```

- [ ] **Step 2: Verify the repository test fails**

Run: `node --test test/unit-ci/ai-artifact-repository.spec.js`

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement validator and repository**

The repository must:

```js
const ARTIFACT_ID = /^[a-z0-9][a-z0-9-]{7,79}$/

async function writeJsonAtomic (filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    flag: 'wx'
  })
  await fs.promises.rename(tempPath, filePath)
}
```

Store each artifact under:

```text
<root>/<artifact-id>/manifest.json
<root>/<artifact-id>/versions/0001/source.json
<root>/<artifact-id>/versions/0001/files/
```

Never accept an absolute path from the renderer. Resolve and verify every path remains below `rootPath`.

- [ ] **Step 4: Add the service and IPC facade**

Expose only:

```js
listAIArtifacts(filters)
getAIArtifact(id)
createAIArtifact(draft, provenance)
createAIArtifactVersion(id, draft)
generateAIArtifact(id, version, formats)
exportAIArtifactFile(id, version, format, destination)
deleteAIArtifact(id)
```

Return `{ ok, value }` or `{ ok: false, error: { code, message } }`; do not return local stack traces.

- [ ] **Step 5: Add the renderer client**

`artifact-client.js` must call `window.pre.runGlobalAsync` and normalize the result:

```js
export async function createArtifact (draft, provenance = {}) {
  return unwrapArtifactResult(
    await window.pre.runGlobalAsync('createAIArtifact', draft, provenance)
  )
}
```

- [ ] **Step 6: Run focused and existing IPC tests**

Run:

```powershell
node --test test/unit-ci/ai-artifact-repository.spec.js
node --test test/unit-ci/ai-health-backend.spec.js test/unit-ci/agent-skill-validator.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/lib/ai-artifacts src/app/lib/ipc.js src/client/components/artifacts/artifact-client.js test/unit-ci/ai-artifact-repository.spec.js
git commit -m "feat: add atomic AI artifact storage"
```

## Task 3: Generate Markdown and CSV Through a Registry

**Files:**
- Create: `src/app/lib/ai-artifacts/generator-registry.js`
- Create: `src/app/lib/ai-artifacts/markdown-generator.js`
- Create: `src/app/lib/ai-artifacts/csv-generator.js`
- Modify: `src/app/lib/ai-artifacts/artifact-service.js`
- Test: `test/unit-ci/ai-artifact-generators.spec.js`

- [ ] **Step 1: Write failing registry tests**

```js
test('generates consistent Markdown and CSV from one source', async () => {
  const registry = createGeneratorRegistry([markdownGenerator, csvGenerator])
  const md = await registry.generate('md', source)
  const csv = await registry.generate('csv', source)
  assert.match(md.content.toString('utf8'), /# 服务器巡检/)
  assert.match(csv.content.toString('utf8'), /服务,状态\r?\nnginx,运行中/)
})

test('rejects formats not registered by the client', async () => {
  const registry = createGeneratorRegistry([markdownGenerator])
  await assert.rejects(
    registry.generate('exe', source),
    error => error.code === 'ARTIFACT_FORMAT_UNSUPPORTED'
  )
})
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-generators.spec.js`

Expected: FAIL because the registry and generators are missing.

- [ ] **Step 3: Implement the registry contract**

```js
function createGeneratorRegistry (handlers) {
  const byFormat = new Map(handlers.map(handler => [handler.format, handler]))
  return Object.freeze({
    async generate (format, source, context = {}) {
      const handler = byFormat.get(String(format || '').toLowerCase())
      if (!handler) throw artifactError('ARTIFACT_FORMAT_UNSUPPORTED', '不支持的成果格式')
      const result = await handler.generate(source, context)
      if (!Buffer.isBuffer(result.content)) {
        throw artifactError('ARTIFACT_GENERATOR_INVALID', '生成器未返回文件内容')
      }
      return result
    }
  })
}
```

CSV generation must quote commas, quotes, and line breaks. Markdown must render headings, sections, risks, recommendations, and all tables from the normalized source.

- [ ] **Step 4: Persist generated files and checksums**

Update the service to write generated output into the selected version’s `files` directory, calculate SHA-256, and append:

```js
{
  format: 'md',
  filename: '生产服务器巡检报告.md',
  bytes: 1234,
  sha256: '...',
  generatedAt: 1000
}
```

- [ ] **Step 5: Run tests**

Run: `node --test test/unit-ci/ai-artifact-generators.spec.js test/unit-ci/ai-artifact-repository.spec.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/lib/ai-artifacts test/unit-ci/ai-artifact-generators.spec.js
git commit -m "feat: generate Markdown and CSV artifacts"
```

## Task 4: Add the Lazy Artifact Workspace and Store

**Files:**
- Create: `src/client/store/ai-artifacts.js`
- Create: `src/client/components/artifacts/entry.jsx`
- Create: `src/client/components/artifacts/artifact-workspace.jsx`
- Create: `src/client/components/artifacts/artifact-list.jsx`
- Create: `src/client/components/artifacts/artifact-preview.jsx`
- Create: `src/client/components/artifacts/artifacts.styl`
- Modify: `src/client/store/init-state.js`
- Modify: `src/client/store/store.js`
- Modify: `src/client/components/main/main.jsx`
- Modify: `src/client/components/sidebar/index.jsx`
- Test: `test/unit-ci/ai-artifact-store.spec.js`
- Test: `test/unit-ci/ai-artifact-ui.spec.js`

- [ ] **Step 1: Write failing navigation and store tests**

Assert:

```js
assert.equal(initial.mainWorkspaceMode, 'terminal')
store.openArtifactWorkspace('artifact-1')
assert.equal(store.mainWorkspaceMode, 'artifacts')
assert.equal(store.activeArtifactId, 'artifact-1')
store.closeArtifactWorkspace()
assert.equal(store.mainWorkspaceMode, 'terminal')
```

Source-level UI assertions must confirm the sidebar has one “成果” entry, `main.jsx` lazy-loads `artifacts/entry`, and the workspace is wrapped in `LazyModuleBoundary`.

- [ ] **Step 2: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-store.spec.js test/unit-ci/ai-artifact-ui.spec.js`

Expected: FAIL because artifact state and UI do not exist.

- [ ] **Step 3: Implement store actions**

State:

```js
mainWorkspaceMode: 'terminal',
activeArtifactId: '',
artifactItems: [],
artifactFilters: { category: 'recent', query: '', server: '', format: '' },
artifactLoading: false,
artifactError: ''
```

Actions:

```js
openArtifactWorkspace(id = '')
closeArtifactWorkspace()
loadArtifacts(filters)
selectArtifact(id)
createArtifactVersion(id, draft)
deleteArtifact(id)
```

Opening artifacts must close fleet status but must not close, reconnect, resize, or recreate terminal tabs.

- [ ] **Step 4: Implement the lazy workspace shell**

`entry.jsx`:

```jsx
const ArtifactWorkspace = lazy(() => import('./artifact-workspace'))

export default function ArtifactWorkspaceEntry (props) {
  return (
    <LazyModuleBoundary moduleName='成果中心'>
      <Suspense fallback={<div className='artifact-loading'>正在加载成果中心...</div>}>
        <ArtifactWorkspace {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}
```

The first workspace version must list artifacts, filter by title/server/format, open Markdown/CSV source previews, and expose save/open actions without DOCX/XLSX/PDF yet.

- [ ] **Step 5: Add responsive styling**

Use a fixed navigation rail, a `minmax(220px, 300px)` list column, and a flexible preview column. At widths below 1100px collapse the list into a drawer. Do not use viewport-scaled font sizes.

- [ ] **Step 6: Run focused tests, lint, and build**

Run:

```powershell
node --test test/unit-ci/ai-artifact-store.spec.js test/unit-ci/ai-artifact-ui.spec.js
npm run lint
npm run vite-build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/client/store src/client/components/artifacts src/client/components/main/main.jsx src/client/components/sidebar/index.jsx test/unit-ci/ai-artifact-store.spec.js test/unit-ci/ai-artifact-ui.spec.js
git commit -m "feat: add lazy AI artifact workspace"
```

## Task 5: Replace Raw Generated Files with Artifact Cards

**Files:**
- Create: `src/client/components/artifacts/artifact-card.jsx`
- Create: `src/client/components/artifacts/create-artifact-menu.jsx`
- Modify: `src/client/components/ai/ai-output.jsx`
- Modify: `src/client/components/ai/ai-chat.jsx`
- Test: `test/unit-ci/ai-artifact-ui.spec.js`

- [ ] **Step 1: Add failing UI behavior assertions**

Assert that:

- Completed chat entries render `ArtifactCard` for persisted artifact IDs.
- Streaming responses do not render incomplete cards.
- Legacy `<shellpilot-file>` blocks still download for backward compatibility.
- “生成成果” includes the seven confirmed templates.
- Clicking a card calls `openArtifactWorkspace(id)`.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/unit-ci/ai-artifact-ui.spec.js`

Expected: FAIL because the components are missing.

- [ ] **Step 3: Implement the compact card**

The card must show:

```jsx
<article className='artifact-card'>
  <FileDoneOutlined />
  <div className='artifact-card-copy'>
    <strong>{artifact.title}</strong>
    <span>{formatLabel} · {detailLabel} · {statusLabel}</span>
  </div>
  <Button onClick={onPreview}>预览</Button>
  <Dropdown menu={actions}><Button icon={<MoreOutlined />} /></Dropdown>
</article>
```

Actions: preview, save, external open, upload, regenerate, delete. Disabled actions must explain why in a tooltip.

- [ ] **Step 4: Implement the create menu**

Menu values must map to stable types:

```js
[
  ['diagnostic-report', '运维诊断报告'],
  ['inspection-report', '服务器巡检报告'],
  ['asset-inventory', '资产清单'],
  ['change-record', '变更记录'],
  ['incident-review', '故障复盘'],
  ['custom-document', '自定义文档'],
  ['custom-spreadsheet', '自定义表格']
]
```

Selecting a type should seed the chat input with a concise request and focus the input; it must not send automatically.

- [ ] **Step 5: Run tests and visual smoke**

Run:

```powershell
node --test test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/ai-generated-artifacts.spec.js
npm run vite-build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/artifacts src/client/components/ai/ai-output.jsx src/client/components/ai/ai-chat.jsx test/unit-ci/ai-artifact-ui.spec.js
git commit -m "feat: add AI artifact cards and creation menu"
```

## Task 6: Add DOCX and XLSX Generators

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/lib/ai-artifacts/docx-generator.js`
- Create: `src/app/lib/ai-artifacts/xlsx-generator.js`
- Modify: `src/app/lib/ai-artifacts/generator-registry.js`
- Test: `test/unit-ci/ai-artifact-generators.spec.js`

- [ ] **Step 1: Install exact bundled dependencies**

Run:

```powershell
npm install --save-exact docx@9.7.1 exceljs@4.4.0
```

Expected: `package.json` and `package-lock.json` contain the exact versions.

- [ ] **Step 2: Write failing office generator tests**

DOCX test must unzip the generated buffer with the already bundled ZIP reader and assert `word/document.xml` contains the Chinese title, sections, and table cells.

XLSX test must load the generated buffer with `ExcelJS.Workbook.xlsx.load`, then assert:

```js
assert.equal(workbook.worksheets.length, 2)
assert.equal(workbook.getWorksheet('汇总').getCell('A1').value, '生产服务器巡检')
assert.equal(workbook.getWorksheet('服务状态').autoFilter.from, 'A1')
```

- [ ] **Step 3: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-generators.spec.js`

Expected: FAIL because office generators are not registered.

- [ ] **Step 4: Implement DOCX generation**

Use `docx` document primitives, not HTML conversion. The handler must:

- apply Microsoft YaHei/SimSun fallback fonts;
- render title, summary, sections, code blocks, tables, risks, and recommendations;
- add header, footer, page number, and page breaks;
- cap tables and text using the normalized source limits;
- return a `Buffer` and `.docx` filename.

- [ ] **Step 5: Implement XLSX generation**

Use `exceljs`. The handler must:

- create a summary sheet and one sheet per source table;
- sanitize and uniquify 31-character sheet names;
- freeze the header row;
- add filters;
- apply number, percent, and date types only when declared by source metadata;
- use conditional colors for normal, warning, and critical states;
- return a `Buffer` and `.xlsx` filename.

- [ ] **Step 6: Run generator and package tests**

Run:

```powershell
node --test test/unit-ci/ai-artifact-generators.spec.js
npm run test-package-smoke
```

Expected: PASS and package smoke confirms `docx` and `exceljs` are included.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json src/app/lib/ai-artifacts test/unit-ci/ai-artifact-generators.spec.js
git commit -m "feat: generate DOCX and XLSX artifacts"
```

## Task 7: Add Sandboxed PDF Generation

**Files:**
- Create: `src/app/lib/ai-artifacts/report-html.js`
- Create: `src/app/lib/ai-artifacts/pdf-printer.js`
- Create: `src/app/lib/ai-artifacts/pdf-generator.js`
- Modify: `src/app/lib/ai-artifacts/generator-registry.js`
- Test: `test/unit-ci/ai-artifact-generators.spec.js`

- [ ] **Step 1: Write failing PDF tests**

Test printable HTML independently:

```js
const html = buildPrintableReportHtml(source)
assert.match(html, /<!doctype html>/i)
assert.match(html, /生产服务器巡检/)
assert.doesNotMatch(html, /<script|onerror=|javascript:/i)
```

Inject a fake printer and assert the PDF generator passes A4, print backgrounds, and bounded HTML:

```js
const pdf = createPdfGenerator({
  printHtml: async (html, options) => {
    observed = { html, options }
    return Buffer.from('%PDF-test')
  }
})
assert.equal(observed.options.pageSize, 'A4')
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-generators.spec.js`

Expected: FAIL because PDF files do not exist.

- [ ] **Step 3: Implement printable HTML**

Use escaped text only, local CSS only, no external resources, and CSS:

```css
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
table { width: 100%; border-collapse: collapse; break-inside: auto; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
```

- [ ] **Step 4: Implement the hidden PDF printer**

Create a hidden `BrowserWindow` with:

```js
{
  show: false,
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true
  }
}
```

Load a percent-encoded `data:text/html;charset=utf-8` URL, wait for `did-finish-load`, call `webContents.printToPDF`, enforce a 30-second timeout, and always destroy the window in `finally`.

- [ ] **Step 5: Run tests**

Run:

```powershell
node --test test/unit-ci/ai-artifact-generators.spec.js
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/lib/ai-artifacts test/unit-ci/ai-artifact-generators.spec.js
git commit -m "feat: generate sandboxed PDF artifacts"
```

## Task 8: Add Paginated Document and Virtual Spreadsheet Previews

**Files:**
- Create: `src/client/components/artifacts/document-preview.jsx`
- Create: `src/client/components/artifacts/spreadsheet-preview.jsx`
- Modify: `src/client/components/artifacts/artifact-preview.jsx`
- Modify: `src/client/components/artifacts/artifact-workspace.jsx`
- Modify: `src/client/components/artifacts/artifacts.styl`
- Test: `test/unit-ci/ai-artifact-ui.spec.js`

- [ ] **Step 1: Add failing preview tests**

Assert the preview router selects document view for DOCX/PDF/Markdown and spreadsheet view for XLSX/CSV. Assert document pages render bounded sections and spreadsheet rows render only the visible window.

- [ ] **Step 2: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-ui.spec.js`

Expected: FAIL because preview components are missing.

- [ ] **Step 3: Implement light document editing**

Edit the normalized source, not the generated binary. Support:

- title, summary, section title/content;
- add, remove, and reorder sections;
- report date, server label, header, and footer;
- undo/redo with a bounded 50-state stack;
- 800ms debounced draft autosave.

The page preview must use stable A4-like page dimensions and overflow into additional pages without changing terminal layout.

- [ ] **Step 4: Implement spreadsheet editing**

Render a fixed-height table viewport. Calculate visible rows from scroll offset and row height; keep a 10-row overscan. Support cell editing, column labels, sort, filter, and declared field types.

- [ ] **Step 5: Run UI tests and build**

Run:

```powershell
node --test test/unit-ci/ai-artifact-ui.spec.js
npm run vite-build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/artifacts test/unit-ci/ai-artifact-ui.spec.js
git commit -m "feat: preview and edit office artifacts"
```

## Task 9: Integrate Structured Artifact Tools with Agent Runs

**Files:**
- Create: `src/client/components/ai/artifact-agent-tools.js`
- Modify: `src/client/components/ai/agent-tools.js`
- Modify: `src/client/components/ai/agent.js`
- Modify: `src/client/components/ai/agent-runtime-context.js`
- Test: `test/unit-ci/ai-artifact-agent-tools.spec.js`
- Test: `test/unit-ci/ai-agent-tools.spec.js`

- [ ] **Step 1: Write failing Agent tool tests**

Assert:

- `create_artifact`, `update_artifact`, and `regenerate_artifact` are conversation-scoped.
- They do not require SSH takeover or mutation confirmation.
- `upload_artifact_to_sftp` is tab-scoped and uses existing SFTP safety handling.
- A created artifact ID is persisted on the chat entry.
- Cancelling the Agent cancels in-progress generation.

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/unit-ci/ai-artifact-agent-tools.spec.js test/unit-ci/ai-agent-tools.spec.js
```

Expected: FAIL because artifact tools are not registered.

- [ ] **Step 3: Define bounded tool schemas**

Expose:

```js
create_artifact({ draft, formats })
update_artifact({ artifactId, patch })
regenerate_artifact({ artifactId, formats })
export_artifact({ artifactId, format })
upload_artifact_to_sftp({ artifactId, format, remotePath, riskContext })
```

Do not expose local destination paths to the model. Local save always opens a user-controlled system file dialog.

- [ ] **Step 4: Persist created artifact IDs**

Add `createdArtifactIds: new Set()` to `agentRuntime`. The artifact tool adds IDs after successful creation. On completion, update the chat entry:

```js
updateChatEntry(chatEntry, {
  response: accumulatedContent,
  artifactIds: [...agentRuntime.createdArtifactIds],
  toolCalls: [...toolCallsLog],
  completionStatus: 'completed'
})
```

Sanitize and bound IDs before storage.

- [ ] **Step 5: Run Agent regression tests**

Run:

```powershell
node --test test/unit-ci/ai-artifact-agent-tools.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/ai-empty-response-consumers.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/ai src/client/components/artifacts test/unit-ci/ai-artifact-agent-tools.spec.js test/unit-ci/ai-agent-tools.spec.js
git commit -m "feat: let Agent create office artifacts"
```

## Task 10: Add Operations Templates and Bounded Source Context

**Files:**
- Create: `src/client/components/artifacts/artifact-templates.js`
- Create: `src/client/components/artifacts/artifact-source-context.js`
- Modify: `src/client/components/artifacts/create-artifact-menu.jsx`
- Modify: `src/client/components/fleet-status/fleet-status-ai-context.js`
- Modify: `src/client/components/main/safety-operation-center-model.js`
- Test: `test/unit-ci/ai-artifact-source-context.spec.js`

- [ ] **Step 1: Write failing template and source tests**

Test every confirmed template has a stable type, required sections, supported formats, and Chinese title. Test source builders:

- cap terminal output at 32 KiB;
- cap each log/file excerpt at 32 KiB;
- cap total context at 92 KiB;
- redact credentials;
- preserve server identity, capture time, and trace ID;
- include safety backup and rollback references without secret values.

- [ ] **Step 2: Verify failure**

Run: `node --test test/unit-ci/ai-artifact-source-context.spec.js`

Expected: FAIL because templates and builders are missing.

- [ ] **Step 3: Implement templates**

Templates:

```js
diagnostic-report
inspection-report
asset-inventory
change-record
security-report
incident-review
custom-document
custom-spreadsheet
```

Each template declares output formats, initial sections/tables, required provenance, and whether an active SSH session is optional or required.

- [ ] **Step 4: Implement bounded context builders**

Provide pure functions:

```js
buildTerminalArtifactContext()
buildFleetArtifactContext()
buildSafetyArtifactContext()
buildDiagnosticArtifactContext()
mergeArtifactContexts()
```

Do not pass raw passwords, API configuration, private keys, or unbounded tool output.

- [ ] **Step 5: Run tests**

Run:

```powershell
node --test test/unit-ci/ai-artifact-source-context.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/ai-conversation-safety.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/components/artifacts src/client/components/fleet-status/fleet-status-ai-context.js src/client/components/main/safety-operation-center-model.js test/unit-ci/ai-artifact-source-context.spec.js
git commit -m "feat: add operations artifact templates"
```

## Task 11: Add Local Export, External Open, and Safe SFTP Upload

**Files:**
- Create: `src/client/components/artifacts/artifact-export-actions.js`
- Modify: `src/app/lib/ai-artifacts/artifact-service.js`
- Modify: `src/app/lib/ipc.js`
- Modify: `src/client/components/artifacts/artifact-card.jsx`
- Modify: `src/client/components/artifacts/artifact-workspace.jsx`
- Test: `test/unit-ci/ai-artifact-repository.spec.js`
- Test: `test/unit-ci/ai-artifact-agent-tools.spec.js`

- [ ] **Step 1: Write failing export safety tests**

Assert:

- save to a new user-selected path needs no second confirmation;
- overwriting an existing local file requires an explicit overwrite result from the native dialog;
- external open only accepts a generated file owned by the repository;
- SFTP upload cannot run without an active exact SSH endpoint;
- remote overwrite uses the existing transfer confirmation;
- no API key or SSH password appears in manifests, files, or errors.

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/unit-ci/ai-artifact-repository.spec.js test/unit-ci/ai-artifact-agent-tools.spec.js
```

Expected: FAIL because export actions are missing.

- [ ] **Step 3: Implement local export**

The renderer asks `window.api.saveDialog` for a destination. It sends only the selected generated file ID and destination back to the main process. The main process verifies repository ownership and copies atomically.

- [ ] **Step 4: Implement external open**

Use Electron `shell.openPath` in the main process. Return a localized error code if no application is associated. Never pass arbitrary renderer paths to `shell.openPath`.

- [ ] **Step 5: Implement SFTP handoff**

Use the existing SFTP upload/transfer queue adapter with:

```js
{
  localPath: verifiedGeneratedPath,
  remotePath,
  tabId: exactEndpoint.tabId
}
```

Remote overwrite and cancellation must remain in the existing transfer and safety flow.

- [ ] **Step 6: Run safety regressions**

Run:

```powershell
node --test test/unit-ci/ai-artifact-repository.spec.js test/unit-ci/ai-artifact-agent-tools.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/agent-risk-transaction.spec.js
npm run smoke:safety
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/lib/ai-artifacts src/app/lib/ipc.js src/client/components/artifacts test/unit-ci/ai-artifact-repository.spec.js test/unit-ci/ai-artifact-agent-tools.spec.js
git commit -m "feat: export and upload AI artifacts safely"
```

## Task 12: Complete Localization, Accessibility, and Recovery

**Files:**
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `src/client/components/artifacts/artifacts.styl`
- Modify: `src/client/components/artifacts/entry.jsx`
- Modify: `src/client/components/common/chunk-load-recovery.js`
- Test: `test/unit-ci/ai-artifact-ui.spec.js`
- Test: `test/unit-ci/chunk-load-recovery.spec.js`

- [ ] **Step 1: Add failing localization and recovery tests**

Assert every visible artifact key has Chinese text, no English placeholder is visible, day/night status colors meet existing theme token rules, and a failed artifact chunk shows “重新加载文档模块” rather than blanking the main UI.

- [ ] **Step 2: Verify failure**

Run:

```powershell
node --test test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/chunk-load-recovery.spec.js
```

Expected: FAIL for missing translations/recovery labels.

- [ ] **Step 3: Implement complete Chinese copy**

Add labels for:

- outcomes, formats, versions, states, filters, menus, and tooltips;
- save/open/upload/regenerate/delete actions;
- loading, cancellation, timeout, retry, and module failure;
- redaction and overwrite warnings.

- [ ] **Step 4: Finish responsive and accessible behavior**

Ensure:

- icon buttons have tooltips and accessible labels;
- keyboard focus remains visible;
- long titles truncate with a tooltip;
- 1366×768 does not produce horizontal page overflow;
- Windows 125%/150% scaling keeps primary actions visible;
- the right AI panel auto-collapses below the existing threshold instead of compressing the workspace.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
node --test test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/chunk-load-recovery.spec.js
npm run lint
npm run vite-build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/client/common/shellpilot-i18n-overrides.js src/client/components/artifacts src/client/components/common/chunk-load-recovery.js test/unit-ci/ai-artifact-ui.spec.js test/unit-ci/chunk-load-recovery.spec.js
git commit -m "fix: harden artifact workspace UX"
```

## Task 13: Add End-to-End and Packaging Gates

**Files:**
- Create: `test/e2e/032.ai-office-artifacts.spec.js`
- Modify: `build/bin/package-smoke-test.js`
- Test: all quality gates below

- [ ] **Step 1: Write the E2E flow**

The Playwright test must:

1. start with no terminal connection;
2. open the成果中心 from the sidebar;
3. create a sample inspection artifact without sending a network AI request;
4. edit a title and table cell;
5. generate MD, CSV, DOCX, XLSX, and PDF;
6. verify cards and previews;
7. cancel one generation and retry it;
8. exercise save-as to a temporary directory;
9. switch day/night themes;
10. capture 1366×768 and 1920×1080 screenshots.

- [ ] **Step 2: Extend package smoke**

Assert the packaged app contains:

- lazy artifact workspace chunk;
- `docx` and `exceljs` runtime code;
- no development-only office dependency;
- no Python or Office executable dependency;
- ShellPilot product name and version consistency.

- [ ] **Step 3: Run focused E2E**

Run:

```powershell
npx playwright test test/e2e/032.ai-office-artifacts.spec.js --workers=1
```

Expected: PASS.

- [ ] **Step 4: Run full automated regression**

Run:

```powershell
npm run test-unit-ci
npm run lint
npm run vite-build
npm run test-package-smoke
npm run test-quality-e2e
npm run test-performance-e2e
```

Expected: all required tests PASS; documented skips remain unchanged.

- [ ] **Step 5: Run SSH/SFTP safety smoke**

Run:

```powershell
npm run smoke:ssh-sftp
npm run smoke:safety
npm run smoke:ai-takeover
```

Expected: PASS. No test may modify the real server unless it uses the established backup and rollback fixture.

- [ ] **Step 6: Build and verify the local Windows client**

Run:

```powershell
npm run b
npm run test-package-smoke
```

Expected:

- `dist/win-unpacked/ShellPilot.exe` starts normally;
- no database migration popup or restart loop;
- opening成果中心 does not open or reconnect a terminal;
- generated DOCX/XLSX/PDF files open on the test machine;
- closing成果中心 leaves SSH/SFTP state unchanged.

- [ ] **Step 7: Commit the test gate**

```powershell
git add test/e2e/032.ai-office-artifacts.spec.js build/bin/package-smoke-test.js
git commit -m "test: gate AI office artifact delivery"
```

## Final Manual Acceptance

- [ ] Generate a real server inspection report from read-only server status and diagnostics.
- [ ] Verify secrets are absent from source JSON, DOCX, XLSX, PDF, logs, and chat metadata.
- [ ] Edit the report title, a paragraph, and a spreadsheet cell; undo and redo each change.
- [ ] Save to a local user-selected folder and open with WPS or Microsoft Office.
- [ ] Upload one generated report to a temporary SFTP directory, then delete the test file through the normal safety flow.
- [ ] Verify Agent stop cancels generation and leaves a retryable draft.
- [ ] Verify SSH Enter, Ctrl+C, copy/paste, resizing, SFTP, online update, and safety rollback remain unchanged.
- [ ] Verify day/night themes at 100%, 125%, and 150% Windows scaling.
- [ ] Do not publish an online update until the user explicitly approves the locally verified build.
