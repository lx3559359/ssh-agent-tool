const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src', relativePath), 'utf8')
}

test('update center shows the complete user-facing update state', () => {
  const source = readSource('client/components/main/update-center-modal.jsx')

  assert.match(source, /shellpilotUpdateCurrentVersion/)
  assert.match(source, /shellpilotUpdateLatestVersion/)
  assert.match(source, /shellpilotUpdateStatus/)
  assert.match(source, /shellpilotUpdateDownloadProgress/)
  assert.match(source, /shellpilotUpdateChangelog/)
  assert.match(source, /shellpilotUpdateRestartInstall/)
  assert.match(source, /refsStatic\.get\('upgrade'\)/)
  assert.match(source, /shellpilotUpdateSource/)
  assert.match(source, /updateSource/)
  assert.match(source, /shellpilotUpdateSourceModelScope/)
  assert.match(source, /GitHub/)
  assert.match(source, /setConfig/)
})

test('update center renders structured state and semantic Markdown release notes', () => {
  const source = readSource('client/components/main/update-center-modal.jsx')
  const styles = readSource('client/components/main/update-center-modal.styl')
  const markdown = readSource('client/components/common/markdown.jsx')
  const markdownStyles = readSource('client/components/common/markdown.styl')

  assert.match(source, /<dl className='update-center-summary'/)
  assert.match(source, /<dt>/)
  assert.match(source, /<dd>/)
  assert.match(source, /role='status'/)
  assert.match(source, /<h2 className='update-center-section-title'/)
  assert.match(source, /<Markdown text=\{info\.releaseInfo\.body\} \/>/)
  assert.doesNotMatch(source, /<pre[^>]*>\{info\.releaseInfo\.body\}/)
  assert.match(markdown, /ReactMarkdown/)
  assert.match(markdown, /import Link from '\.\/external-link'/)
  assert.match(markdown, /components=\{markdownComponents\}/)
  assert.match(markdown, /<Link to=\{href\}>/)
  assert.match(markdown, /import '\.\/markdown\.styl'/)
  assert.match(markdownStyles, /\.markdown-wrap[\s\S]*h1[\s\S]*h2/)
  assert.match(markdownStyles, /ul,[\s\S]*ol/)
  assert.match(markdownStyles, /p/)
  assert.match(styles, /\.update-center-summary[\s\S]*grid-template-columns/)
})

test('top bar opens the update center before checking for updates', () => {
  const source = readSource('client/components/main/aigshell-topbar.jsx')

  assert.match(source, /setShowUpdateCenter\(true\)/)
  assert.match(source, /<UpdateCenterModal/)
  assert.match(source, /onCheckUpdate\(true\)/)
})

test('automatic update checks stay minimized and cannot cover active workflows', () => {
  const upgrade = readSource('client/components/main/upgrade.jsx')
  const sidebar = readSource('client/components/sidebar/index.jsx')

  assert.match(
    upgrade,
    /showUpgradeModal:\s*Boolean\(isManual && !window\.store\.upgradeInfo\.showUpdateCenter\)/
  )
  assert.match(sidebar, /!showUpgradeModal && shouldUpgrade/)
})

test('explicit system-menu update checks are marked as manual', () => {
  const source = readSource('client/components/sys-menu/menu-btn.jsx')

  assert.match(source, /onCheckUpdate\s*=\s*\(\)\s*=>\s*\{[\s\S]*?window\.store\.onCheckUpdate\(true\)/)
})

test('upgrade flow only offers restart after the native updater confirms download completion', () => {
  const source = readSource('client/components/main/upgrade.jsx')

  assert.match(source, /if \(!finalState\?\.downloaded\)/)
  assert.match(source, /upgradeReady:\s*Boolean\(finalState\?\.downloaded\)/)
  assert.doesNotMatch(source, /upgradeReady:\s*true/)
  assert.match(source, /shouldUpgrade:\s*false/)
  assert.match(source, /canAutoUpgrade:\s*false/)
})

test('legacy websocket updater is disabled so every desktop update uses approval checks', () => {
  const source = readSource('app/server/dispatch-center.js')

  assert.doesNotMatch(source, /\/upgrade\/:id/)
  assert.doesNotMatch(source, /require\('\.\/download-upgrade'\)/)
  assert.doesNotMatch(source, /upgrade-new/)
})
