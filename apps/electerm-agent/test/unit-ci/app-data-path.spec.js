const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  resolveAppDataProps
} = require(path.resolve(__dirname, '../../src/app/common/app-data-path'))

test('installed Windows builds keep user data under AppData instead of the exe path', () => {
  const props = resolveAppDataProps({
    isWin: true,
    appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'F:\\SSH工具开发\\AIGShell.exe',
    installSrc: 'win-x64-installer.exe',
    existsSync: () => false
  })

  assert.deepEqual(props, {
    appPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'F:\\SSH工具开发',
    isPortable: false
  })
})

test('portable Windows builds keep user data beside the unpacked app folder', () => {
  const props = resolveAppDataProps({
    isWin: true,
    appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'D:\\tools\\AIGShell\\AIGShell.exe',
    installSrc: 'win-x64-portable.tar.gz',
    existsSync: () => false
  })

  assert.deepEqual(props, {
    appPath: 'D:\\tools\\AIGShell',
    exePath: 'D:\\tools\\AIGShell',
    isPortable: true
  })
})

test('portable Windows zip builds keep user data beside the unpacked app folder', () => {
  const props = resolveAppDataProps({
    isWin: true,
    appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'D:\\tools\\AIGShell\\AIGShell.exe',
    installSrc: 'win-x64-portable.zip',
    existsSync: () => false
  })

  assert.deepEqual(props, {
    appPath: 'D:\\tools\\AIGShell',
    exePath: 'D:\\tools\\AIGShell',
    isPortable: true
  })
})

test('Windows ARM portable builds use the unpacked app folder too', () => {
  const props = resolveAppDataProps({
    isWin: true,
    appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'D:\\tools\\AIGShell-arm64\\AIGShell.exe',
    installSrc: 'win-arm64-portable.tar.gz',
    existsSync: () => false
  })

  assert.deepEqual(props, {
    appPath: 'D:\\tools\\AIGShell-arm64',
    exePath: 'D:\\tools\\AIGShell-arm64',
    isPortable: true
  })
})

test('existing portable data folder marks Windows builds as portable', () => {
  const checked = []
  const props = resolveAppDataProps({
    isWin: true,
    appDataPath: 'C:\\Users\\alice\\AppData\\Roaming',
    exePath: 'D:\\tools\\AIGShell\\AIGShell.exe',
    installSrc: 'win-x64-installer.exe',
    existsSync: value => {
      checked.push(value)
      return value === 'D:\\tools\\AIGShell\\electerm'
    }
  })

  assert.deepEqual(checked, ['D:\\tools\\AIGShell\\electerm'])
  assert.deepEqual(props, {
    appPath: 'D:\\tools\\AIGShell',
    exePath: 'D:\\tools\\AIGShell',
    isPortable: true
  })
})

test('non-Windows builds use Electron appData directly', () => {
  const props = resolveAppDataProps({
    isWin: false,
    appDataPath: '/home/alice/.config',
    exePath: '/opt/AIGShell/AIGShell',
    installSrc: 'linux-x64.tar.gz',
    existsSync: () => {
      throw new Error('should not inspect portable Windows folders')
    }
  })

  assert.deepEqual(props, {
    appPath: '/home/alice/.config',
    isPortable: false
  })
})
