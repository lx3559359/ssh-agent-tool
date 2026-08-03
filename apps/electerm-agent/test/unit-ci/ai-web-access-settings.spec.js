const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const clientRoot = path.join(root, 'src/client')

function readClientSource (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

test('registers a dedicated AI web access setting route', () => {
  const constants = readClientSource('common/constants.js')
  const list = readClientSource('common/setting-list.js')
  const tabs = readClientSource('components/setting-panel/tab-settings.jsx')

  assert.match(
    constants,
    /settingAiWebAccessId = 'setting-ai-web-access'/
  )
  assert.match(list, /settingAiWebAccessId/)
  assert.match(list, /shellpilotAiWebAccessSettings/)
  assert.match(tabs, /import SettingAiWebAccess/)
  assert.match(tabs, /sid === settingAiWebAccessId/)
  assert.match(tabs, /<SettingAiWebAccess/)
})

test('web access settings manage grants and isolated login data safely', () => {
  const source = readClientSource(
    'components/setting-panel/setting-ai-web-access.jsx'
  )

  for (const operation of [
    'listAIWebGrants',
    'revokeAIWebGrant',
    'clearAIWebGrants',
    'clearAIWebSessionData'
  ]) {
    assert.match(source, new RegExp(`runGlobalAsync\\('${operation}'`))
  }
  assert.ok((source.match(/<Popconfirm/g) || []).length >= 3)
  assert.match(source, /dataIndex: 'origin'/)
  assert.match(source, /dataIndex: 'addressClass'/)
  assert.match(source, /dataIndex: 'createdAt'/)
  assert.match(source, /dataIndex: 'lastUsedAt'/)
  assert.doesNotMatch(source, /cookie|resolvedAddress|requestHeaders/i)
})

test('provides complete bilingual web access copy and updated guidance', async () => {
  const i18nUrl = pathToFileURL(path.join(
    clientRoot,
    'common/shellpilot-i18n-overrides.js'
  )).href
  const { getShellPilotTranslation } = await import(i18nUrl)
  const keys = [
    'shellpilotAiWebAccessSettings',
    'shellpilotAiWebAccessSettingsDescription',
    'shellpilotAiWebAccessTitle',
    'shellpilotAiWebAccessOrigin',
    'shellpilotAiWebAccessPrivateWarning',
    'shellpilotAiWebAccessLoopbackWarning',
    'shellpilotAiWebAccessSendWarning',
    'shellpilotAiWebAllowOnce',
    'shellpilotAiWebAllowAlways',
    'shellpilotAiWebClassPrivate',
    'shellpilotAiWebClassLoopback',
    'shellpilotAiWebGrantCreatedAt',
    'shellpilotAiWebGrantLastUsedAt',
    'shellpilotAiWebRevokeConfirm',
    'shellpilotAiWebClearGrantsConfirm',
    'shellpilotAiWebClearSessionConfirm',
    'shellpilotAiWebReaderLoading',
    'shellpilotAiWebReaderReadCurrent',
    'shellpilotAiWebErrorBlocked',
    'shellpilotAiWebErrorNetwork',
    'shellpilotAiWebErrorCertificate',
    'shellpilotAiWebErrorTimeout',
    'shellpilotAiWebErrorLoginRequired',
    'shellpilotAiWebErrorEmpty',
    'shellpilotAiWebErrorRedirectLimit'
  ]

  for (const locale of ['zh_cn', 'en_us']) {
    for (const key of keys) {
      const value = getShellPilotTranslation(key, locale)
      assert.equal(typeof value, 'string', `${locale}.${key}`)
      assert.ok(value.trim(), `${locale}.${key}`)
    }
  }

  const hint = getShellPilotTranslation('shellpilotAiWebUrlHint', 'zh_cn')
  assert.doesNotMatch(hint, /仅.*公网/)
  assert.match(hint, /内网/)

  const guide = fs.readFileSync(
    path.join(root, 'docs/USER_GUIDE_ZH.md'),
    'utf8'
  )
  assert.match(guide, /按来源授权/)
  assert.match(guide, /隔离登录会话/)
  assert.match(guide, /链路本地|云元数据/)
})
