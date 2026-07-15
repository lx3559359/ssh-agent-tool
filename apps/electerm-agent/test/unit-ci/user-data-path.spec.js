const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  resolveUserDataPath
} = require(path.resolve(__dirname, '../../src/app/common/user-data-path'))

test('visual tests isolate Electron userData under DATA_PATH', () => {
  assert.equal(
    resolveUserDataPath({
      nodeTest: 'yes',
      dataPath: 'C:\\Temp\\shellpilot-test\\data',
      appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
      safeStorageAppName: 'AIGShell'
    }),
    path.resolve('C:\\Temp\\shellpilot-test\\data', 'electron-user-data')
  )
})

test('normal clients preserve the legacy safe-storage userData path', () => {
  assert.equal(
    resolveUserDataPath({
      nodeTest: undefined,
      dataPath: 'D:\\custom-data',
      appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
      safeStorageAppName: 'AIGShell'
    }),
    path.resolve('C:\\Users\\alice\\AppData\\Roaming', 'AIGShell')
  )
})

test('NODE_TEST without DATA_PATH cannot redirect userData', () => {
  assert.equal(
    resolveUserDataPath({
      nodeTest: 'yes',
      dataPath: '',
      appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
      safeStorageAppName: 'AIGShell'
    }),
    path.resolve('C:\\Users\\alice\\AppData\\Roaming', 'AIGShell')
  )
})
