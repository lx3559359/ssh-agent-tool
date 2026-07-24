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
  copyItemWithKeyboard,
  pasteItemWithKeyboard,
  setLocalSftpPath,
  verifyFileExists,
  verifyFileTransfersComplete
} = require('./common/common')

describe('file-copy-paste-operation-keyboard', function () {
  for (const type of ['local', 'remote']) {
    it(`should test ${type} file operations using keyboard shortcuts`, async function () {
      const electronApp = await electron.launch(appOptions)
      const localRoot = await fs.mkdtemp(resolve(tmpdir(), 'shellpilot-keyboard-copy-'))
      try {
        const client = await electronApp.firstWindow()
        extendClient(client, electronApp)
        await delay(3500)

        await setupSftpConnection(client)
        await setLocalSftpPath(client, localRoot)
        await testCopyPasteOperationWithKeyboard(client, type)
      } finally {
        await electronApp.close()
        await fs.rm(localRoot, { recursive: true, force: true })
      }
    })
  }
})

async function testCopyPasteOperationWithKeyboard (client, type) {
  const rootPath = await getFixturePath(client, type)
  // Create a main test folder to contain all test operations
  const mainTestFolderName = `test-keyboard-copy-paste-${Date.now()}`
  const mainTestFolderPath = await createFixtureFolder(client, type, mainTestFolderName)
  await setFixturePath(client, type, mainTestFolderPath)

  try {
    // Create a test file
    const fileName = `keyboard-copy-file-${Date.now()}.js`
    await createFixtureFile(client, type, fileName)

    // Copy the file using keyboard shortcut - only need to copy once
    await copyItemWithKeyboard(client, type, fileName)

    // Give time for the clipboard to update
    await delay(2000)

    // Test 1: Paste in the same directory using keyboard shortcut
    await pasteItemWithKeyboard(client, type, {
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
    expect(renamedFileName).toMatch(/^keyboard-copy-file-\d+\(rename-[\w\d-]+\)\.js$/)

    // Test 2: Create folder, paste into subfolder using keyboard shortcuts
    const subFolderName = `keyboard-sub-folder-${Date.now()}`
    const subFolderPath = await createFixtureFolder(client, type, subFolderName)
    await setFixturePath(client, type, subFolderPath)

    // Paste the file in the subfolder using keyboard shortcut
    await pasteItemWithKeyboard(client, type)
    await verifyFileTransfersComplete(client)

    // Verify the file was created in the subfolder
    expect(await verifyFileExists(client, type, fileName)).toBe(true)
  } finally {
    await setFixturePath(client, type, rootPath)
    await removeFixturePath(client, type, mainTestFolderPath)
  }
}

async function createFixtureFolder (client, type, folderName) {
  const currentPath = await getFixturePath(client, type)
  const folderPath = type === 'local'
    ? resolve(currentPath, folderName)
    : `${currentPath.replace(/\/$/, '')}/${folderName}`
  if (type === 'local') {
    await fs.mkdir(folderPath)
  } else {
    await client.evaluate(async remotePath => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      await sftp.sftp.mkdir(remotePath)
    }, folderPath)
  }
  await client.evaluate(async type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await sftp[`${type}List`]()
  }, type)
  await delay(1500)
  return folderPath
}

async function createFixtureFile (client, type, fileName) {
  const currentPath = await client.evaluate(type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    return sftp.state[`${type}Path`]
  }, type)
  if (type === 'local') {
    await fs.writeFile(resolve(currentPath, fileName), 'keyboard copy fixture')
  } else {
    const remotePath = `${currentPath.replace(/\/$/, '')}/${fileName}`
    await client.evaluate(async remotePath => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      await sftp.sftp.writeFile(remotePath, 'keyboard copy fixture')
    }, remotePath)
  }
  await client.evaluate(async type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await sftp[`${type}List`]()
  }, type)
  await delay(1500)
}

async function getFixturePath (client, type) {
  return client.evaluate(type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    return sftp.state[`${type}Path`]
  }, type)
}

async function setFixturePath (client, type, targetPath) {
  await client.evaluate(async ({ type, targetPath }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await new Promise(resolve => {
      sftp.setState({
        [`${type}Path`]: targetPath,
        [`${type}PathTemp`]: targetPath
      }, resolve)
    })
    await sftp[`${type}List`]()
  }, { type, targetPath })
  await delay(1500)
}

async function removeFixturePath (client, type, targetPath) {
  if (type === 'local') {
    await fs.rm(targetPath, { recursive: true, force: true })
    return
  }
  await client.evaluate(async targetPath => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await sftp.sftp.removeEntry(targetPath)
  }, targetPath)
}
