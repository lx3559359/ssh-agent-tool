const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

const createAppPath = require.resolve(path.resolve(__dirname, '../../src/app/lib/create-app'))

async function runCreateApp ({ isTest, isPrimaryInstance = true }) {
  const calls = {
    socketLock: 0,
    electronLock: 0,
    quit: 0
  }
  const app = {
    commandLine: {
      appendSwitch () {}
    },
    setName () {},
    requestSingleInstanceLock () {
      calls.electronLock++
      return true
    },
    quit () {
      calls.quit++
    },
    on () {},
    whenReady () {
      return new Promise(() => {})
    }
  }
  const stubs = {
    electron: { app },
    './create-window': { createWindow () {} },
    '../common/runtime-constants': {
      appDisplayName: 'ShellPilot',
      safeStorageAppName: 'AIGShell',
      isTest
    },
    './command-line': {
      initCommandLine: () => ({ options: {} })
    },
    './glob-state': {
      set () {},
      get () { return null }
    },
    './deep-link': {
      setupDeepLinkHandlers () {}
    },
    './single-instance': {
      async handleSingleInstance () {
        calls.socketLock++
        return isPrimaryInstance
      }
    },
    '../common/log': {},
    './process-error-logging': {
      installProcessErrorLogging () {}
    },
    './get-config': {
      getUserConfigNoEnc: async () => ({ allowMultiInstance: false }),
      getDbConfig: async () => ({})
    }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[createAppPath]
    const { createApp } = require(createAppPath)
    await createApp()
    return calls
  } finally {
    Module._load = originalLoad
    delete require.cache[createAppPath]
  }
}

test('single-instance startup behavior', async (t) => {
  await t.test('test mode skips both socket and Electron single-instance locks', async () => {
    const calls = await runCreateApp({ isTest: true })

    assert.deepEqual(calls, {
      socketLock: 0,
      electronLock: 0,
      quit: 0
    })
  })

  await t.test('production mode keeps socket and Electron single-instance locks', async () => {
    const calls = await runCreateApp({ isTest: false })

    assert.deepEqual(calls, {
      socketLock: 1,
      electronLock: 1,
      quit: 0
    })
  })

  await t.test('production secondary instance quits before requesting Electron lock', async () => {
    const calls = await runCreateApp({
      isTest: false,
      isPrimaryInstance: false
    })

    assert.deepEqual(calls, {
      socketLock: 1,
      electronLock: 0,
      quit: 1
    })
  })
})
