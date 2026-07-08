const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing server management evidence: ${label}`)
}

test('服务器管理矩阵覆盖常规连接管理流程', () => {
  const flow = readFile('bookmark-management-flow.spec.js')
  const management = readFile('bookmark-management.spec.js')
  const contextMenu = readFile('bookmark-context-menu.spec.js')
  const search = readFile('bookmark-search.spec.js')
  const tags = readFile('bookmark-tags.spec.js')
  const favorite = readFile('bookmark-favorite.spec.js')
  const group = readFile('bookmark-group.spec.js')
  const backup = readFile('bookmark-backup.spec.js')
  const upload = readFile('bookmark-upload.spec.js')
  const all = [
    flow,
    management,
    contextMenu,
    search,
    tags,
    favorite,
    group,
    backup,
    upload
  ].join('\n')

  assertEvidence(flow, /bookmark toolbar exposes new bookmark new group edit import and export actions/, 'new edit import export toolbar')
  assertEvidence(flow, /bookmark form renders new and edit server modes/, 'new and edit server form')
  assertEvidence(flow, /tree list creates bookmark groups and sub groups through store operations/, 'group and subgroup creation')
  assertEvidence(flow, /tree list saves edited bookmark groups/, 'group editing')
  assertEvidence(management, /removeBookmarkIdFromGroups removes a deleted server from every group/, 'delete server removes group membership')
  assertEvidence(contextMenu, /bookmark context menu exposes common server actions without leaking credentials/, 'server context menu')
  assertEvidence(contextMenu, /bookmark group context menu exposes group actions/, 'group context menu')
  assertEvidence(search, /bookmark search matches server fields/, 'server search')
  assertEvidence(search, /bookmark search matches group titles and descriptions/, 'group search')
  assertEvidence(tags, /bookmark form exposes editable labels as tag input fields/, 'tag editing')
  assertEvidence(favorite, /bookmark favorite helper toggles a stable favorite boolean/, 'favorite toggle')
  assertEvidence(group, /removeCyclicBookmarkGroupIds removes nested group references/, 'group cycle protection')
  assertEvidence(backup, /creates an AIGShell bookmark backup package/, 'backup export')
  assertEvidence(backup, /creates a bookmark backup without credentials when requested/, 'export without credentials')
  assertEvidence(backup, /creates an encrypted bookmark backup/, 'encrypted backup export')
  assertEvidence(backup, /parses encrypted bookmark backups through the import helper/, 'encrypted import')
  assertEvidence(upload, /bookmark upload guard reports invalid backup files and restores watchers/, 'invalid import guard')
  assertEvidence(all, /copyPublicInfo|duplicate|move|delete|openAll/, 'common right click actions')
})
