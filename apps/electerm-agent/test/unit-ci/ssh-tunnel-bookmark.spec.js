const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

async function loadBookmarkHelpers () {
  return importModule(
    'src/client/components/ssh-tunnel/ssh-tunnel-bookmark.js'
  )
}

const mysqlTunnel = {
  id: 'mysql-local',
  name: 'MySQL',
  sshTunnel: 'forwardLocalToRemote',
  sshTunnelLocalHost: '127.0.0.1',
  sshTunnelLocalPort: 3307,
  sshTunnelRemoteHost: '127.0.0.1',
  sshTunnelRemotePort: 3306,
  autoStart: true
}

test('bookmark tunnel helper keeps unrelated bookmark data when saving', async () => {
  const { upsertBookmarkTunnel } = await loadBookmarkHelpers()
  const bookmark = {
    id: 'server-1',
    title: '生产数据库',
    host: '10.0.0.8',
    sshTunnels: []
  }

  const result = upsertBookmarkTunnel(bookmark, mysqlTunnel)

  assert.equal(result.id, bookmark.id)
  assert.equal(result.title, bookmark.title)
  assert.equal(result.host, bookmark.host)
  assert.deepEqual(result.sshTunnels, [mysqlTunnel])
  assert.notEqual(result, bookmark)
})

test('bookmark tunnel helper updates by id without creating duplicates', async () => {
  const { upsertBookmarkTunnel } = await loadBookmarkHelpers()
  const bookmark = {
    sshTunnels: [mysqlTunnel]
  }

  const result = upsertBookmarkTunnel(bookmark, {
    ...mysqlTunnel,
    sshTunnelLocalPort: 13307
  })

  assert.equal(result.sshTunnels.length, 1)
  assert.equal(result.sshTunnels[0].sshTunnelLocalPort, 13307)
})

test('bookmark tunnel helper removes one tunnel and leaves the rest intact', async () => {
  const { removeBookmarkTunnel } = await loadBookmarkHelpers()
  const bookmark = {
    sshTunnels: [
      mysqlTunnel,
      { ...mysqlTunnel, id: 'redis-local', name: 'Redis' }
    ]
  }

  const result = removeBookmarkTunnel(bookmark, mysqlTunnel.id)

  assert.deepEqual(result.sshTunnels.map(item => item.id), ['redis-local'])
})

test('bookmark tunnel helper reads legacy single-tunnel bookmarks', async () => {
  const { getBookmarkTunnels } = await loadBookmarkHelpers()
  const bookmark = {
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080
  }

  const result = getBookmarkTunnels(bookmark)

  assert.equal(result.length, 1)
  assert.equal(result[0].sshTunnel, 'dynamicForward')
  assert.equal(result[0].sshTunnelLocalPort, 1080)
})

test('auto-start selection excludes disabled or incomplete tunnels', async () => {
  const { getAutoStartTunnels } = await loadBookmarkHelpers()
  const bookmark = {
    sshTunnels: [
      mysqlTunnel,
      { ...mysqlTunnel, id: 'manual', autoStart: false },
      { ...mysqlTunnel, id: 'invalid', sshTunnelLocalPort: '' }
    ]
  }

  const result = getAutoStartTunnels(bookmark)

  assert.deepEqual(result.map(item => item.id), [mysqlTunnel.id])
})

test('bookmark resolution uses the active tab source bookmark id', async () => {
  const { findBookmarkForTab } = await loadBookmarkHelpers()
  const bookmarks = [
    { id: 'server-1', title: '服务器一' },
    { id: 'server-2', title: '服务器二' }
  ]

  assert.equal(
    findBookmarkForTab(bookmarks, { srcId: 'server-2', from: 'bookmarks' }).title,
    '服务器二'
  )
  assert.equal(findBookmarkForTab(bookmarks, { id: 'runtime-tab' }), null)
})
