const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/connection-inventory.js')
).href

test('connection inventory exposes visible account fields and copy text', async () => {
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
    'type',
    'host',
    'port',
    'username',
    'authType',
    'password',
    'privateKey',
    'passphrase',
    'profileId',
    'description'
  ])
  assert.equal(hiddenFields.find(item => item.key === 'password').value, '••••••••')
  assert.equal(visibleFields.find(item => item.key === 'password').value, 'secret-password')

  const text = formatConnectionInfoText(bookmark, { showSecrets: true })
  assert.match(text, /prod-web-01/)
  assert.match(text, /10\.0\.1\.23/)
  assert.match(text, /root/)
  assert.match(text, /secret-password/)
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

  assert.match(csv, /^"title","type","host","port","username","authType","password"/)
  assert.match(csv, /"prod,web","ssh","10\.0\.1\.23","22","root","","secret""password"/)
})

test('connection inventory center is reachable from bookmark UI', () => {
  const root = path.resolve(__dirname, '../..')
  const toolbar = fs.readFileSync(path.join(root, 'src/client/components/tree-list/bookmark-toolbar.jsx'), 'utf8')
  const treeList = fs.readFileSync(path.join(root, 'src/client/components/tree-list/tree-list.jsx'), 'utf8')
  const topbar = fs.readFileSync(path.join(root, 'src/client/components/main/aigshell-topbar.jsx'), 'utf8')
  const inventoryModal = fs.readFileSync(path.join(root, 'src/client/components/tree-list/connection-inventory-modal.jsx'), 'utf8')

  assert.match(toolbar, /服务器详情 \/ 连接信息/)
  assert.match(toolbar, /onConnectionInventory/)
  assert.match(treeList, /ConnectionInventoryModal/)
  assert.match(treeList, /onViewConnectionInfo/)
  assert.match(topbar, /label: '连接信息'/)
  assert.match(topbar, /ConnectionInventoryModal/)
  assert.match(inventoryModal, /title='服务器详情'/)
  assert.match(inventoryModal, /查看连接信息/)
  assert.match(inventoryModal, /导出连接清单 CSV/)
})
