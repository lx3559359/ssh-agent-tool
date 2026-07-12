const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('update sources prefer ModelScope domestic mirror before GitHub fallback', async () => {
  const appSources = require(path.join(root, 'src/app/common/update-sources'))
  const clientSources = await import(pathToFileURL(path.join(root, 'src/client/common/update-sources.js')))

  const appList = appSources.getUpdateReleaseSources()
  const clientList = clientSources.getUpdateReleaseSources()

  assert.equal(appList[0].id, 'modelscope')
  assert.equal(appList[1].id, 'github')
  assert.equal(clientList[0].id, 'modelscope')
  assert.equal(clientList[1].id, 'github')
  assert.match(appList[0].releaseApiUrl, /modelscope\.cn\/models\/lx3559359\/ShellPilot-Updates\/resolve\/master\/shellpilot-release\.json/)
  assert.match(appList[0].feedConfig.url, /modelscope\.cn\/models\/lx3559359\/ShellPilot-Updates\/resolve\/master$/)
  assert.equal(appList[0].feedConfig.provider, 'generic')
  assert.equal(appSources.buildModelScopeAssetUrl('latest.yml'), `${appList[0].feedConfig.url}/latest.yml`)
})

test('update sources honor explicit client preference without silent fallback', async () => {
  const appSources = require(path.join(root, 'src/app/common/update-sources'))
  const clientSources = await import(pathToFileURL(path.join(root, 'src/client/common/update-sources.js')))

  for (const sources of [appSources, clientSources]) {
    assert.deepEqual(
      sources.getUpdateReleaseSources('modelscope').map(item => item.id),
      ['modelscope']
    )
    assert.deepEqual(
      sources.getUpdateReleaseSources('github').map(item => item.id),
      ['github']
    )
    assert.deepEqual(
      sources.getUpdateReleaseSources('auto').map(item => item.id),
      ['modelscope', 'github']
    )
    assert.deepEqual(
      sources.getUpdateReleaseSources('unknown').map(item => item.id),
      ['modelscope', 'github']
    )
  }
})

test('renderer and native updater use shared ordered update sources', () => {
  const rendererSource = fs.readFileSync(path.join(root, 'src/client/common/update-check.js'), 'utf8')
  const nativeSource = fs.readFileSync(path.join(root, 'src/app/lib/native-updater.js'), 'utf8')

  assert.match(rendererSource, /getUpdateReleaseSources/)
  assert.match(rendererSource, /getConfiguredUpdateSource/)
  assert.match(rendererSource, /getUpdateReleaseSources\(getConfiguredUpdateSource\(\)\)/)
  assert.match(nativeSource, /getUpdateReleaseSources/)
  assert.match(nativeSource, /options\.config\?\.updateSource/)
  assert.match(nativeSource, /source\?\.feedConfig/)
  assert.match(nativeSource, /autoUpdater\.setFeedURL\(feedConfig/)
})

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
