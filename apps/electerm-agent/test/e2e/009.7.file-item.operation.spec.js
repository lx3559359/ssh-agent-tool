const { _electron: electron } = require('@playwright/test')
const {
  test: it
} = require('@playwright/test')
const { describe } = it
it.setTimeout(10000000)
const delay = require('./common/wait')
const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve } = require('path')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { expect } = require('./common/expect')
const {
  setupSftpConnection,
  createFile,
  createFolder,
  deleteItem,
  copyItem,
  pasteItem,
  enterFolder,
  navigateToParentFolder,
  verifyFileExists,
  verifyFileTransfersComplete,
  setLocalSftpPath
} = require('./common/common')

describe('file-copy-paste-operation', function () {
  for (const type of ['local', 'remote']) {
    it(`should test ${type} file copy and paste operations`, async function () {
      const electronApp = await electron.launch(appOptions)
      const localRoot = await fs.mkdtemp(resolve(tmpdir(), 'shellpilot-copy-paste-'))
      try {
        const client = await electronApp.firstWindow()
        extendClient(client, electronApp)
        await delay(3500)

        await setupSftpConnection(client)
        await setLocalSftpPath(client, localRoot)
        await testCopyPasteOperation(client, type)
      } finally {
        await electronApp.close()
        await fs.rm(localRoot, { recursive: true, force: true })
      }
    })
  }
})

async function testCopyPasteOperation (client, type) {
  // Create a main test folder to contain all test operations
  const mainTestFolderName = `test-copy-paste-${Date.now()}`
  await createFolder(client, type, mainTestFolderName)

  // Enter the main test folder
  await enterFolder(client, type, mainTestFolderName)

  // Create a test file
  const fileName = `original-file-${Date.now()}.js`
  await createFile(client, type, fileName)

  // Copy the file
  await copyItem(client, type, fileName)

  // Give more time for the clipboard to update
  await delay(2000)

  // Test 1: Paste in the same directory
  await pasteItem(client, type, {
    resolveConflict: type === 'remote' ? 'rename' : undefined
  })
  await verifyFileTransfersComplete(client)

  // Verify that a renamed file was created
  const renamedFileName = await client.evaluate(async ({ type, fileName }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const list = type === 'remote'
      ? await sftp.remoteList(true)
      : await sftp.localList(true)
    const base = fileName.replace(/\.js$/, '')
    return list
      .map(item => item.name)
      .find(name => name.startsWith(`${base}(rename-`) && name.endsWith('.js'))
  }, { type, fileName })
  expect(renamedFileName).toBeTruthy()

  // Verify the renamed file follows the pattern
  expect(renamedFileName).toMatch(/^original-file-\d+\(rename-[\w\d-]+\)\.js$/)

  // Test 2: Create folder, paste into subfolder
  // Create a subfolder
  const subFolderName = `sub-folder-${Date.now()}`
  await createFolder(client, type, subFolderName)

  // Copy the original file again
  await copyItem(client, type, fileName)

  // Give more time for the clipboard to update
  await delay(2000)

  // Enter the subfolder
  await enterFolder(client, type, subFolderName)

  // Paste the file in the subfolder
  await pasteItem(client, type)
  await verifyFileTransfersComplete(client)

  // Verify the file was created in the subfolder
  expect(await verifyFileExists(client, type, fileName)).toBe(true)

  // Navigate back to main test folder
  await navigateToParentFolder(client, type)

  // Navigate back to the parent folder (outside the main test folder)
  await navigateToParentFolder(client, type)

  // Clean up - delete the entire main test folder with all its contents
  await deleteItem(client, type, mainTestFolderName)
}
