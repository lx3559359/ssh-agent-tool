const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/connection-inventory.js')
).href

test('connection inventory exposes Chinese account fields and copy text', async () => {
  const {
    getConnectionInfoFields,
    formatConnectionInfoText
  } = await import(moduleUrl)

  const bookmark = {
    title: 'prod-web-01',
    type: 'ssh',
    host: '10.0.1.23',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret-password',
    privateKey: 'C:/keys/prod.pem',
    description: 'production server'
  }

  const hiddenFields = getConnectionInfoFields(bookmark)
  const visibleFields = getConnectionInfoFields(bookmark, { showSecrets: true })

  assert.deepEqual(hiddenFields.map(item => item.key), [
    'title',
    'groupName',
    'type',
    'connectionAddress',
    'host',
    'port',
    'username',
    'authType',
    'password',
    'privateKey',
    'passphrase',
    'profileId',
    'hoppingCount',
    'proxy',
    'createdAt',
    'updatedAt',
    'description'
  ])
  assert.equal(hiddenFields.find(item => item.key === 'title').label, '名称')
  assert.equal(hiddenFields.find(item => item.key === 'groupName').label, '所在分组')
  assert.equal(hiddenFields.find(item => item.key === 'connectionAddress').label, '连接地址')
  assert.equal(hiddenFields.find(item => item.key === 'password').value, '••••••••')
  assert.equal(visibleFields.find(item => item.key === 'password').value, 'secret-password')

  const text = formatConnectionInfoText(bookmark, { showSecrets: true })
  assert.match(text, /名称: prod-web-01/)
  assert.match(text, /IP \/ 主机: 10\.0\.1\.23/)
  assert.match(text, /账号: root/)
  assert.match(text, /密码: secret-password/)
})

test('connection inventory exports a single connection csv with credentials', async () => {
  const {
    createConnectionInventoryCsv
  } = await import(moduleUrl)

  const csv = createConnectionInventoryCsv([
    {
      title: 'prod,web',
      type: 'ssh',
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      password: 'secret"password'
    }
  ])

  assert.match(csv, /^"title","groupName","type","connectionAddress","host","port","username","authType","password"/)
  assert.match(csv, /"prod,web","","ssh","root@10\.0\.1\.23:22","10\.0\.1\.23","22","root","","secret""password"/)
})

test('connection inventory can export Chinese csv headers for client users', async () => {
  const {
    createConnectionInventoryCsv
  } = await import(moduleUrl)

  const csv = createConnectionInventoryCsv([
    {
      title: 'prod-web-01',
      type: 'ssh',
      host: '10.0.1.23',
      port: 22,
      username: 'root',
      password: 'secret-password'
    }
  ], {
    headerType: 'label'
  })

  assert.match(csv, /^"名称","所在分组","类型","连接地址","IP \/ 主机","端口","账号","认证方式","密码"/)
  assert.match(csv, /"prod-web-01","","ssh","root@10\.0\.1\.23:22","10\.0\.1\.23","22","root","","secret-password"/)
})

test('connection inventory csv includes migration fields and bookmark group names', async () => {
  const {
    createConnectionInventoryCsv
  } = await import(moduleUrl)

  const csv = createConnectionInventoryCsv([
    {
      id: 'server-1',
      title: 'prod-web-01',
      type: 'ssh',
      host: '10.0.1.23',
      port: 2222,
      username: 'root',
      authType: 'password',
      password: 'secret-password',
      proxy: 'socks5://127.0.0.1:1080',
      connectionHoppings: [
        { host: 'jump-01' },
        { host: 'jump-02' }
      ],
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: '2026-07-09T09:30:00.000Z'
    }
  ], {
    headerType: 'label',
    bookmarkGroups: [
      {
        id: 'group-prod',
        title: '生产环境',
        bookmarkIds: ['server-1'],
        bookmarkGroupIds: []
      }
    ]
  })

  assert.match(csv, /^"名称","所在分组","类型","连接地址","IP \/ 主机","端口","账号"/)
  assert.match(csv, /"prod-web-01","生产环境","ssh","root@10\.0\.1\.23:2222","10\.0\.1\.23","2222","root"/)
  assert.match(csv, /"2","socks5:\/\/127\.0\.0\.1:1080","2026-07-01T08:00:00\.000Z","2026-07-09T09:30:00\.000Z"/)
})

test('connection inventory center is reachable from bookmark UI with readable Chinese copy', () => {
  const root = path.resolve(__dirname, '../..')
  const toolbar = fs.readFileSync(path.join(root, 'src/client/components/tree-list/bookmark-toolbar.jsx'), 'utf8')
  const treeList = fs.readFileSync(path.join(root, 'src/client/components/tree-list/tree-list.jsx'), 'utf8')
  const topbar = fs.readFileSync(path.join(root, 'src/client/components/main/aigshell-topbar.jsx'), 'utf8')
  const inventoryModal = fs.readFileSync(path.join(root, 'src/client/components/tree-list/connection-inventory-modal.jsx'), 'utf8')
  const infoModal = fs.readFileSync(path.join(root, 'src/client/components/tree-list/connection-info-modal.jsx'), 'utf8')

  assert.match(toolbar, /服务器详情 \/ 连接信息/)
  assert.match(toolbar, /加密备份（推荐）/)
  assert.match(toolbar, /跨电脑迁移说明/)
  assert.match(treeList, /ConnectionInventoryModal/)
  assert.match(treeList, /onViewConnectionInfo/)
  assert.match(topbar, /label: '连接信息'/)
  assert.match(topbar, /label: '检查更新'/)
  assert.match(topbar, /未连接/)
  assert.match(inventoryModal, /title='服务器详情'/)
  assert.match(inventoryModal, /查看连接信息/)
  assert.match(inventoryModal, /导出连接清单 CSV/)
  assert.match(infoModal, /title='连接信息'/)
  assert.match(infoModal, /显示密码/)
  assert.match(infoModal, /复制全部/)
})
