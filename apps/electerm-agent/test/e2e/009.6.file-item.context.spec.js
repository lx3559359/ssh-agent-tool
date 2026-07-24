const { _electron: electron } = require('@playwright/test')
const {
  test: it
} = require('@playwright/test')
const { describe } = it
it.setTimeout(180000)
const delay = require('./common/wait')
const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve } = require('path')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { expect } = require('./common/expect')

const {
  setupSftpConnection,
  createFolder,
  deleteItem,
  accessFolderFromTerminal,
  renameItem,
  enterFolder,
  navigateToParentFolder,
  verifyFileExists,
  verifyCurrentPath,
  clickSftpTab,
  countFileListItems,
  setLocalSftpPath
} = require('./common/common')

describe('file-item-context-menu', function () {
  it('should test gotoFolderInTerminal function', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    // Click sftp tab first
    await clickSftpTab(client)

    // Create a new folder
    const folderName = 'test-folder-' + Date.now()
    await createFolder(client, 'local', folderName)

    // Access folder from terminal
    await accessFolderFromTerminal(client, 'local', folderName)

    // Verify the terminal received the target folder. Shells may suppress the
    // literal `cd` echo, so assert the stable path value instead.
    await client.waitForFunction(folder => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      return terminal?.getTerminalBufferText?.().includes(folder)
    }, folderName)

    // Clean up - delete the test folder
    await clickSftpTab(client)
    await deleteItem(client, 'local', folderName)

    await electronApp.close()
  })

  it('should test gotoFolderInTerminal function in SSH session', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    // Set up SSH connection
    await setupSftpConnection(client)

    // Create a new folder in remote
    const remoteFolderName = 'test-ssh-folder-' + Date.now()
    await createFolder(client, 'remote', remoteFolderName)

    // Access remote folder from terminal
    await accessFolderFromTerminal(client, 'remote', remoteFolderName)

    await client.waitForFunction(folder => {
      const terminal = window.refs.get('term-' + window.store.activeTabId)
      return terminal?.getTerminalBufferText?.().includes(folder)
    }, remoteFolderName)

    // Clean up the remote test folder
    await clickSftpTab(client)
    await deleteItem(client, 'remote', remoteFolderName)

    await electronApp.close()
  })

  it('should test rename function for folders in context menu for both local and remote', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    // Set up SSH connection
    await setupSftpConnection(client)
    const localRoot = await fs.mkdtemp(resolve(tmpdir(), 'shellpilot-context-rename-'))
    await setLocalSftpPath(client, localRoot)

    // Test local folder rename
    const localFolderName = 'test-local-rename-folder-' + Date.now()
    await createFolder(client, 'local', localFolderName)

    const newLocalFolderName = 'renamed-' + localFolderName
    await renameItem(client, 'local', localFolderName, newLocalFolderName)

    expect(await verifyFileExists(client, 'local', newLocalFolderName)).toBe(true)

    // Test remote folder rename
    const remoteFolderName = 'test-remote-rename-folder-' + Date.now()
    await createFolder(client, 'remote', remoteFolderName)

    const newRemoteFolderName = 'renamed-' + remoteFolderName
    await renameItem(client, 'remote', remoteFolderName, newRemoteFolderName)

    expect(await remoteEntryExists(client, newRemoteFolderName)).toBe(true)

    // Clean up - delete the test folders
    await deleteItem(client, 'local', newLocalFolderName)
    await removeRemoteEntry(client, newRemoteFolderName)

    await electronApp.close()
    await fs.rm(localRoot, { recursive: true, force: true })
  })

  it('should test enter folder context menu and verify folder content for both remote and local', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)

    // Set up SSH connection
    await setupSftpConnection(client)

    // Test remote file system
    const remoteFolderName = 'test-remote-enter-folder-' + Date.now()
    await createFolder(client, 'remote', remoteFolderName)

    // Enter remote folder
    await enterFolder(client, 'remote', remoteFolderName)

    // Verify remote folder content
    expect(await verifyCurrentPath(client, 'remote', remoteFolderName)).toBe(true)
    expect(await countFileListItems(client, 'remote', '.sftp-item')).toBe(2)
    expect(await countFileListItems(client, 'remote', '.parent-file-item')).toBe(1)

    // Go back to remote parent directory
    await navigateToParentFolder(client, 'remote')
    expect(await verifyCurrentPath(client, 'remote', remoteFolderName)).toBe(false)

    // Test local file system
    const localFolderName = 'test-local-enter-folder-' + Date.now()
    await createFolder(client, 'local', localFolderName)

    // Enter local folder
    await enterFolder(client, 'local', localFolderName)

    // Verify local folder content
    expect(await verifyCurrentPath(client, 'local', localFolderName)).toBe(true)
    expect(await countFileListItems(client, 'local', '.sftp-item')).toBe(2)
    expect(await countFileListItems(client, 'local', '.parent-file-item')).toBe(1)

    // Go back to local parent directory
    await navigateToParentFolder(client, 'local')
    expect(await verifyCurrentPath(client, 'local', localFolderName)).toBe(false)

    // Clean up - delete the test folders
    await deleteItem(client, 'remote', remoteFolderName)
    await deleteItem(client, 'local', localFolderName)

    await electronApp.close()
  })
})

async function remoteEntryExists (client, name) {
  return client.evaluate(async name => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const path = `${sftp.state.remotePath.replace(/\/$/, '')}/${name}`
    return sftp.sftp.lstat(path).then(() => true).catch(() => false)
  }, name)
}

async function removeRemoteEntry (client, name) {
  await client.evaluate(async name => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const path = `${sftp.state.remotePath.replace(/\/$/, '')}/${name}`
    await sftp.sftp.removeEntry(path)
    await sftp.remoteList()
  }, name)
}
