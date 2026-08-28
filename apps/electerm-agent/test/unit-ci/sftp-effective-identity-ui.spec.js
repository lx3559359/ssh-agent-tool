const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const { pathToFileURL } = require('node:url')

const agentRoot = path.resolve(__dirname, '../..')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(agentRoot, relativePath), 'utf8')
}

const entrySource = readSource('src/client/components/sftp/sftp-entry.jsx')
const entryAst = parser.parse(entrySource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})

function topLevelFunction (name, dependencies = {}) {
  let declaration
  traverse(entryAst, {
    FunctionDeclaration (nodePath) {
      if (nodePath.node.id?.name === name) declaration = nodePath.node
    }
  })
  assert.ok(declaration, `sftp-entry.jsx must define ${name}`)
  return vm.runInNewContext(`(${generate(declaration).code})`, dependencies)
}

function installClassField (entry, name) {
  let initializer
  traverse(entryAst, {
    ClassProperty (nodePath) {
      if (nodePath.node.key?.name === name) initializer = nodePath.node.value
    }
  })
  assert.ok(initializer, `sftp-entry.jsx must define ${name}`)
  const resolveRemoteFileStatus = topLevelFunction('resolveRemoteFileStatus')
  entry[name] = vm.runInNewContext(`
    (function installClassField () {
      return (${generate(initializer).code})
    }).call(__entry)
  `, { __entry: entry, resolveRemoteFileStatus })
  return entry[name]
}

function createEntryStateHarness () {
  return {
    props: { tab: { username: 'hik' } },
    state: {
      remoteFileIdentity: {
        loginUsername: 'hik',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: 'idle'
    },
    activeRootFileCapabilities: new Set(),
    setState (update) {
      const patch = typeof update === 'function'
        ? update(this.state)
        : update
      if (patch) this.state = { ...this.state, ...patch }
    }
  }
}

function formatTemplate (translate, key, variables) {
  return Object.entries(variables || {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    translate(key)
  )
}

test('remote panel shows login and effective file identities without rewriting the tab', () => {
  assert.match(entrySource, /remoteFileIdentity/)
  assert.match(entrySource, /shellpilotSftpLoginIdentity/)
  assert.match(entrySource, /shellpilotSftpEffectiveFileIdentity/)
  assert.match(entrySource, /sftp-panel-identities/)
  assert.doesNotMatch(entrySource, /tab\.username\s*=\s*.*effective/)
})

test('effective identity formatting covers native SFTP, current root terminal, and unknown', () => {
  const copy = {
    shellpilotSftpEffectiveFileIdentity: 'File operations: {username} ({channel})',
    shellpilotSftpEffectiveFileIdentityUnknown: 'File operations: Unknown',
    shellpilotSftpCurrentTerminal: 'current terminal',
    shellpilotSftpNativeChannel: 'SFTP'
  }
  const formatEffectiveFileIdentity = topLevelFunction(
    'formatEffectiveFileIdentity',
    { formatShellPilotTranslation: formatTemplate }
  )
  const translate = key => copy[key] || key

  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: 'hik',
    channel: 'sftp'
  }, translate), 'File operations: hik (SFTP)')
  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: 'root',
    channel: 'pty-root'
  }, translate), 'File operations: root (current terminal)')
  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: '',
    channel: 'unknown'
  }, translate), 'File operations: Unknown')
})

test('remote file status is derived from live leases and acquisition availability', () => {
  const resolveRemoteFileStatus = topLevelFunction('resolveRemoteFileStatus')

  assert.equal(resolveRemoteFileStatus(), 'idle')
  assert.equal(resolveRemoteFileStatus({ rootLeaseCount: 1 }), 'busy')
  assert.equal(resolveRemoteFileStatus({ unavailable: true }), 'unavailable')
  assert.equal(resolveRemoteFileStatus({
    rootLeaseCount: 1,
    unavailable: true
  }), 'busy')
})

test('root lease busy state follows capability acquisition and release', async () => {
  const entry = createEntryStateHarness()
  installClassField(entry, 'publishRemoteFileCapabilityIdentity')
  installClassField(entry, 'clearRemoteFileCapabilityIdentity')
  installClassField(entry, 'releaseRemoteFileCapability')
  let releases = 0
  const capability = {
    async release () {
      releases += 1
      return true
    }
  }

  entry.publishRemoteFileCapabilityIdentity(capability, {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  })
  assert.equal(entry.state.remoteFileStatus, 'busy')
  assert.equal(entry.activeRootFileCapabilities.size, 1)

  assert.equal(await entry.releaseRemoteFileCapability(capability), true)
  assert.equal(releases, 1)
  assert.equal(entry.activeRootFileCapabilities.size, 0)
  assert.equal(entry.state.remoteFileStatus, 'idle')
})

test('failed root capability release becomes unavailable instead of claiming idle', async () => {
  const entry = createEntryStateHarness()
  installClassField(entry, 'publishRemoteFileCapabilityIdentity')
  installClassField(entry, 'clearRemoteFileCapabilityIdentity')
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  installClassField(entry, 'releaseRemoteFileCapability')
  const capability = {
    async release () {
      throw new Error('terminal release failed')
    }
  }

  entry.publishRemoteFileCapabilityIdentity(capability, {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  })
  await assert.rejects(
    entry.releaseRemoteFileCapability(capability),
    /terminal release failed/
  )
  assert.equal(entry.activeRootFileCapabilities.size, 0)
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.state.remoteFileStatus, 'unavailable')
})

test('failed acquisition publishes an unknown unavailable state without sending work', () => {
  const entry = createEntryStateHarness()
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  entry.publishRemoteFileIdentityUnavailable()

  assert.deepEqual({ ...entry.state.remoteFileIdentity }, {
    loginUsername: 'hik',
    effectiveUid: '',
    effectiveUsername: '',
    channel: 'unknown'
  })
  assert.equal(entry.state.remoteFileStatus, 'unavailable')

  const start = entrySource.indexOf('acquireRemoteFileOperation = async')
  const end = entrySource.indexOf('\n  reserveTransferFileSession', start)
  const acquireSource = entrySource.slice(start, end)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(acquireSource, /REMOTE_FILE_IDENTITY_UNAVAILABLE/)
  assert.match(acquireSource, /publishRemoteFileIdentityUnavailable/)
})

test('busy and unavailable notices are live regions beside the transfer progress dock', () => {
  assert.match(entrySource, /remoteFileStatus === 'busy'/)
  assert.match(entrySource, /shellpilotSftpRootLeaseBusy/)
  assert.match(entrySource, /remoteFileStatus === 'unavailable'/)
  assert.match(entrySource, /shellpilotSftpIdentityUnavailable/)
  assert.match(entrySource, /aria-live='polite'/)
  assert.match(entrySource, /SftpTransferProgressDock/)
  assert.match(entrySource, /sftp-file-identity-marker/)
})

test('identity UI copy is bilingual and documents terminal locking', async () => {
  const i18nPath = path.resolve(
    agentRoot,
    'src/client/common/shellpilot-i18n-overrides.js'
  )
  const { getShellPilotTranslation } = await import(pathToFileURL(i18nPath).href)
  const expected = {
    shellpilotSftpLoginIdentity: ['SSH \u767b\u5f55\uff1a{username}', 'SSH login: {username}'],
    shellpilotSftpEffectiveFileIdentity: [
      '\u6587\u4ef6\u64cd\u4f5c\uff1a{username}\uff08{channel}\uff09',
      'File operations: {username} ({channel})'
    ],
    shellpilotSftpEffectiveFileIdentityUnknown: [
      '\u6587\u4ef6\u64cd\u4f5c\uff1a\u672a\u77e5',
      'File operations: Unknown'
    ],
    shellpilotSftpCurrentTerminal: ['\u5f53\u524d\u7ec8\u7aef', 'current terminal'],
    shellpilotSftpNativeChannel: ['SFTP', 'SFTP'],
    shellpilotSftpRootLeaseBusy: [
      '\u8fdc\u7a0b\u6587\u4ef6\u64cd\u4f5c\u6b63\u5728\u4f7f\u7528\u5f53\u524d\u7ec8\u7aef\uff1b\u5b8c\u6210\u6216\u53d6\u6d88\u524d\u7ec8\u7aef\u8f93\u5165\u5df2\u9501\u5b9a\u3002',
      'Remote file operations are using the current terminal; terminal input is locked until completion or cancellation.'
    ],
    shellpilotSftpIdentityUnavailable: [
      '\u65e0\u6cd5\u786e\u8ba4\u5f53\u524d Shell \u8eab\u4efd\uff0c\u8fdc\u7a0b\u6587\u4ef6\u64cd\u4f5c\u5c1a\u672a\u53d1\u9001\u3002',
      'The current Shell identity could not be confirmed; the remote file operation was not sent.'
    ]
  }

  for (const [key, [chinese, english]] of Object.entries(expected)) {
    assert.equal(getShellPilotTranslation(key, 'zh_cn'), chinese)
    assert.equal(getShellPilotTranslation(key, 'en_us'), english)
  }
})

test('guide explains effective root routing and removes the obsolete absolute claim', () => {
  const guide = readSource('docs/USER_GUIDE_ZH.md')
  assert.doesNotMatch(guide, /终端内?里?的? `?su`?(?: 或|\/)? `?sudo`?[^。]*不会改变(?:该身份|文件操作)/)
  assert.match(guide, /原生 SFTP[^。]*登录身份[^。]*不会改变/)
  assert.match(guide, /UID 0/)
  assert.match(guide, /受控终端/)
  assert.match(guide, /私有 SFTP 暂存区/)
  assert.match(guide, /终端[^。]*(?:忙|占用)/)
  assert.match(guide, /chroot/)
  assert.match(guide, /基础命令/)
  assert.match(guide, /退出 root/)
})
