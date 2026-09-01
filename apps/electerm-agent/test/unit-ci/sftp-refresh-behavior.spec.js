const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default

function readSftpSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp', relativePath),
    'utf8'
  )
}

function readClientCommonSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common', relativePath),
    'utf8'
  )
}

function loadClassMethod (source, name, dependencies = {}) {
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining']
  })
  let method
  traverse(ast, {
    ClassMethod (nodePath) {
      if (nodePath.node.key?.name === name) method = nodePath.node
    }
  })
  assert.ok(method, `component must define ${name}`)
  return vm.runInNewContext(`(${generate({
    ...method,
    type: 'FunctionExpression',
    id: null
  }).code})`, dependencies)
}

function startSingleExplicitInitialization (entry, task) {
  if (entry.sftpExplicitInitialization) {
    return entry.sftpExplicitInitialization
  }
  let resolveStart
  let rejectStart
  const start = new Promise((resolve, reject) => {
    resolveStart = resolve
    rejectStart = reject
  })
  const shared = start.finally(() => {
    if (entry.sftpExplicitInitialization === shared) {
      entry.sftpExplicitInitialization = null
    }
  })
  entry.sftpExplicitInitialization = shared
  try {
    resolveStart(task())
  } catch (error) {
    rejectStart(error)
  }
  return shared
}

test('sftp file item refresh reloads the active side list', () => {
  const source = readSftpSource('file-item.jsx')
  const start = source.indexOf('refresh = () => {')
  const end = source.indexOf('shouldShowSelectedMenu = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /this\.props\.onGoto\(this\.props\.file\.type\)/)
})

test('sftp address bar shows reload when path is unchanged and jump when edited', () => {
  const source = readSftpSource('address-bar.jsx')

  assert.match(
    source,
    /const GoIcon = isLoadingRemote\s*\?[\s\S]*LoadingOutlined[\s\S]*:\s*\(realPath === path \? ReloadOutlined : ArrowRightOutlined\)/
  )
  assert.match(source, /onPressEnter=\{e => props\.onGoto\(type,\s*e\)\}/)
  assert.match(source, /onClick=\{handleClick\}/)
})

test('sftp onGoto refreshes current local or remote path through the list loader', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('onGoto = async (type, e) => {')
  const end = source.indexOf('goParent = (type) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /e && e\.preventDefault\(\)/)
  assert.match(body, /const oldPath = this\.state\[type \+ 'Path'\]/)
  assert.match(body, /let np = await this\.parsePath\(type,\s*this\.state\[nt\]\)/)
  assert.match(body, /np = normalizeRemotePath\(np\)/)
  assert.match(body, /this\.setState\(\{[\s\S]*\[n\]: np[\s\S]*\[nt\]: np[\s\S]*\}/)
  assert.match(body, /this\[`\$\{type\}List`\]\(undefined,\s*undefined,\s*oldPath\)/)
})

test('sftp history click updates path temp and reloads that side', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('onClickHistory = (type, path) => {')
  const end = source.indexOf('handleReloadRemoteSftp = async () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const oldPath = this\.state\[type \+ 'Path'\]/)
  assert.match(body, /\[n\]: path/)
  assert.match(body, /\[`\$\{n\}Temp`\]: path/)
  assert.match(body, /this\[`\$\{type\}List`\]\(undefined,\s*undefined,\s*oldPath\)/)
})

test('only an explicit full or split SFTP open starts or retries remote loading', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const componentDidUpdate = loadClassMethod(source, 'componentDidUpdate', {
    paneMap: { fileManager: 'fileManager' },
    typeMap: { local: 'local', remote: 'remote' },
    startSftpEntryExplicitInitialization: (_entry, task) => task()
  })
  let retries = 0
  const initOptions = []
  const entry = {
    props: {
      pane: 'fileManager',
      sshSftpSplitView: false,
      enableSftp: false,
      tab: { sftpCreated: false },
      config: { autoRefreshWhenSwitchToSftp: false }
    },
    state: {
      inited: true,
      loadingSftp: false,
      remoteLoading: false,
      selectedType: '',
      localPath: 'C:\\Users\\shellpilot',
      remotePath: ''
    },
    sftp: { isSshFsFallback: true },
    shouldRenderRemote: () => true,
    initRemoteAll: async options => {
      retries += 1
      initOptions.push(options)
    },
    runSftpBackgroundTask: task => task(),
    onGoto: () => {},
    setState: () => {}
  }

  componentDidUpdate.call(entry, {
    ...entry.props,
    pane: 'terminal'
  }, { ...entry.state })

  assert.equal(retries, 0)

  entry.props.enableSftp = true
  componentDidUpdate.call(entry, {
    ...entry.props,
    pane: 'terminal'
  }, { ...entry.state })

  assert.equal(retries, 1)
  assert.equal(initOptions.length, 1)
  assert.equal(initOptions[0].explicitOpen, true)

  entry.props.tab.sftpCreated = true
  componentDidUpdate.call(entry, {
    ...entry.props,
    pane: 'terminal'
  }, { ...entry.state })

  assert.equal(retries, 1)

  entry.props.pane = 'terminal'
  entry.props.sshSftpSplitView = true
  entry.props.tab.sftpCreated = false
  componentDidUpdate.call(entry, {
    ...entry.props,
    sshSftpSplitView: false
  }, { ...entry.state })

  assert.equal(retries, 2)
  assert.equal(initOptions.length, 2)
  assert.equal(initOptions[0].explicitOpen, true)
  assert.equal(initOptions[1].explicitOpen, true)
})

test('rapid explicit SFTP close and reopen shares the first initialization', async () => {
  const source = readSftpSource('sftp-entry.jsx')
  const componentDidUpdate = loadClassMethod(source, 'componentDidUpdate', {
    paneMap: { fileManager: 'fileManager' },
    typeMap: { local: 'local', remote: 'remote' },
    startSftpEntryExplicitInitialization:
      startSingleExplicitInitialization
  })
  let resolveInitialization
  const initialization = new Promise(resolve => {
    resolveInitialization = resolve
  })
  let attempts = 0
  const entry = {
    props: {
      pane: 'terminal',
      sshSftpSplitView: true,
      enableSftp: true,
      tab: { sftpCreated: false },
      config: { autoRefreshWhenSwitchToSftp: false }
    },
    state: {
      inited: false,
      loadingSftp: false,
      remoteLoading: false,
      selectedType: '',
      localPath: 'C:\\Users\\shellpilot',
      remotePath: ''
    },
    shouldRenderRemote: () => true,
    initRemoteAll: async () => {
      attempts += 1
      return initialization
    },
    runSftpBackgroundTask: task => task(),
    onGoto: () => {},
    setState: () => {}
  }

  componentDidUpdate.call(entry, {
    ...entry.props,
    sshSftpSplitView: false
  }, { ...entry.state })

  entry.props.sshSftpSplitView = false
  componentDidUpdate.call(entry, {
    ...entry.props,
    sshSftpSplitView: true
  }, { ...entry.state })

  entry.props.sshSftpSplitView = true
  componentDidUpdate.call(entry, {
    ...entry.props,
    sshSftpSplitView: false
  }, { ...entry.state })

  assert.equal(attempts, 1)
  resolveInitialization()
  await initialization
})

test('hidden SFTP preload failures are cleaned up without interrupting SSH', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('remoteListUncoalesced = async (')
  const end = source.indexOf('updateRemoteList = async (', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /candidateSftp = sftp/)
  assert.match(body, /await destroyCandidate\(\)/)
  assert.match(body, /sftpCreated: false/)
  assert.match(body, /if \(this\.isSftpVisible\(\)\) \{/)
  assert.match(body, /const normalizedError = this\.normalizeSftpError\(error\)/)
  assert.match(body, /this\.onError\(normalizedError\)/)
})

test('SFTP transport supplies a localized fallback for empty backend errors', () => {
  const source = readClientCommonSource('sftp.js')

  assert.match(source, /window\.translate\('shellpilotSftpUnavailable'\)/)
  assert.match(source, /reconstructSftpError\(arg\.error, fallback\)/)
})

test('safe delete updates the list immediately and calibrates once in background', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('delFiles = async')
  const end = source.indexOf('\n  renderDelConfirmTitle', start)
  const body = source.slice(start, end)
  assert.match(body, /applyOptimisticRemoteDelete/)
  assert.match(body, /this\.calibrateRemoteAfterSafeDelete\(\)/)
  assert.doesNotMatch(body, /wait\(500\)/)
  assert.equal((body.match(/calibrateRemoteAfterSafeDelete/g) || []).length, 1)
})

test('background safe delete calibration can surface one actionable warning', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('calibrateRemoteAfterSafeDelete = async')
  const end = source.indexOf('\n  delFiles = async', start)
  const body = source.slice(start, end)
  assert.match(body, /remoteList\(false, undefined, undefined, \{[\s\S]*rethrow: true/)
  assert.match(body, /suppressLoading: true/)
  assert.match(body, /shellpilotSftpStateCalibrationFailed/)
  assert.equal((body.match(/message\.warning/g) || []).length, 1)
})

test('background safe delete calibration does not block the remote file list', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('remoteListUncoalesced = async')
  const end = source.indexOf('\n  updateRemoteList = async', start)
  const body = source.slice(start, end)
  assert.match(body, /if \(!returnList && !options\.suppressLoading\)/)
})

test('SFTP cached refresh preserves visible rows and exposes live status', () => {
  const source = readSftpSource('sftp-entry.jsx')
  assert.match(source, /remoteDirectoryCache\.get\(cacheKey\)/)
  assert.match(source, /remoteRefreshState:\s*'cached-refreshing'/)
  assert.match(source, /shellpilotSftpShowingCachedRefreshing/)
  assert.doesNotMatch(
    source.slice(
      source.indexOf('applyCachedRemoteDirectory'),
      source.indexOf('remoteListUncoalesced')
    ),
    /remote:\s*\[\]/
  )
})

test('ordinary remote refresh does not schedule an unconditional second list', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const start = source.indexOf('remoteListUncoalesced = async')
  const end = source.indexOf('updateRemoteList = async', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.doesNotMatch(body, /replaceSftpEntryTimer\(this, 'timer5'/)
})

test('SFTP records cached paint, first authoritative ready and refresh duration at render boundaries', () => {
  const source = readSftpSource('sftp-entry.jsx')
  const cachedStart = source.indexOf('applyCachedRemoteDirectory =')
  const refreshStart = source.indexOf('remoteListUncoalesced = async')
  const refreshEnd = source.indexOf('updateRemoteList = async', refreshStart)
  const cachedBody = source.slice(cachedStart, refreshStart)
  const refreshBody = source.slice(refreshStart, refreshEnd)

  assert.match(cachedBody, /'sftp_cached_paint_ms'/)
  assert.match(cachedBody, /let cachedPaintCommitted = false/)
  assert.match(cachedBody, /cachedPaintCommitted = true/)
  assert.match(cachedBody, /if \(!cachedPaintCommitted \|\|/)
  assert.match(cachedBody, /isCurrentSftpEntryRemoteTask\(this, task\)/)
  assert.match(cachedBody, /trackSftpEntryMetric\(this,/)
  assert.match(cachedBody, /Promise\.allSettled/)
  assert.match(
    refreshBody,
    /globalThis\.performance\?\.now\?\.\(\) \?\? Date\.now\(\)/
  )
  assert.match(refreshBody, /'sftp_refresh_ms'/)
  assert.match(refreshBody, /'first_sftp_ready_ms'/)
  assert.match(refreshBody, /this\.firstSftpReadyRecorded/)
})
