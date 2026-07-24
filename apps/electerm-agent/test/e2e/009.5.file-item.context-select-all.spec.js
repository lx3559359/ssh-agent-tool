const { _electron: electron } = require('@playwright/test')
const {
  test: it,
  expect
} = require('@playwright/test')
const { describe } = it
it.setTimeout(100000)
const delay = require('./common/wait')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const {
  setupSftpConnection,
  createFolder,
  selectAllContextMenu
} = require('./common/common')

describe('File List Context Menu Select All Operation', function () {
  it('should select all items using context menu and verify single click behavior for both local and remote file lists', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    // Establish the SSH/SFTP session before exercising both file lists.
    await setupSftpConnection(client)

    await cleanupStaleTestFolders(client, 'local')
    await cleanupStaleTestFolders(client, 'remote')

    // Test for both local and remote
    await testSelectAll(client, 'local')
    await testSelectAll(client, 'remote')

    await electronApp.close()
  })
})

async function testSelectAll (client, type) {
  // Create two test folders
  const folderName1 = `test-folder-1-${Date.now()}`
  const folderName2 = `test-folder-2-${Date.now()}`

  try {
    await createFolder(client, type, folderName1)
    await createFolder(client, type, folderName2)

    // Select all items using context menu
    await selectAllContextMenu(client, type)

    await expect.poll(async () => client.evaluate(type => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      const list = sftp.getFileList(type)
      return list.length >= 2 &&
        list.every(item => sftp.state.selectedFiles.has(item.id))
    }, type)).toBe(true)

    const selectedKeys = await client.evaluate(type => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      return sftp.getFileList(type)
        .filter(item => sftp.state.selectedFiles.has(item.id))
        .map(item => `${item.type}\u0000${item.path}\u0000${item.name}`)
        .sort()
    }, type)

    // A refresh regenerates row ids; the same files must remain selected.
    await client.evaluate(async type => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      await sftp[`${type}List`]()
    }, type)
    await expect.poll(async () => client.evaluate(({ type, selectedKeys }) => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      const selected = sftp.getFileList(type)
        .filter(item => sftp.state.selectedFiles.has(item.id))
        .map(item => `${item.type}\u0000${item.path}\u0000${item.name}`)
        .sort()
      return JSON.stringify(selected) === JSON.stringify(selectedKeys)
    }, { type, selectedKeys })).toBe(true)

    // Check that the refreshed selected files keep their visible state.
    let fileItems = client.locator(`.session-current .file-list.${type} .real-file-item`)
    await expect.poll(async () => fileItems.evaluateAll(items => (
      items.length >= 2 && items.every(item => item.classList.contains('selected'))
    ))).toBe(true)

    // Click on a single file item to deselect all except the clicked one
    await client.click(`.session-current .file-list.${type} .real-file-item`)
    await delay(500)

    // Check that only the clicked item has the 'selected' class
    fileItems = client.locator(`.session-current .file-list.${type} .real-file-item`)
    await expect.poll(async () => fileItems.evaluateAll(items => (
      items.filter(item => item.classList.contains('selected')).length
    ))).toBe(1)

    // Deselect without clicking the same row twice (which would enter a folder).
    await client.click('.session-current .sftp-panel-title')
    await delay(500)
  } finally {
    await cleanupTestFolders(client, type, [folderName1, folderName2])
  }
}

async function cleanupTestFolders (client, type, folderNames) {
  await client.evaluate(async ({ type, folderNames }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const base = sftp.state[`${type}Path`].replace(/[\\/]$/, '')
    const separator = type === 'local' ? '\\' : '/'
    for (const folderName of folderNames) {
      const path = `${base}${separator}${folderName}`
      if (type === 'local') {
        await window.fs.rmrf(path).catch(() => {})
      } else {
        await sftp.sftp.removeEntry(path).catch(() => {})
      }
    }
    await sftp[`${type}List`]()
  }, { type, folderNames })
}

async function cleanupStaleTestFolders (client, type) {
  const folderNames = await client.evaluate(type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    return sftp.getFileList(type)
      .filter(item => (
        item.isDirectory &&
        /^test-folder-[12]-\d+$/.test(item.name)
      ))
      .map(item => item.name)
  }, type)
  await cleanupTestFolders(client, type, folderNames)
}
