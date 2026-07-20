const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const catalogUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-provider-catalog.js'
)).href

test('recommended API catalog contains official China-friendly and international providers', async () => {
  const { recommendedAIProviders } = await import(catalogUrl)
  const values = recommendedAIProviders.map(item => item.preset)

  for (const expected of [
    'deepseek',
    'dashscope',
    'siliconflow',
    'bigmodel',
    'moonshot',
    'volcengine',
    'openai',
    'openrouter',
    'ollama'
  ]) {
    assert.ok(values.includes(expected), `missing recommended provider ${expected}`)
  }

  for (const provider of recommendedAIProviders) {
    assert.match(provider.website, /^https:\/\//)
    assert.ok(provider.name.length >= 2)
    assert.ok(provider.description.length >= 6)
    assert.ok(['国内', '海外', '本地'].includes(provider.region))
    assert.ok(Array.isArray(provider.tags) && provider.tags.length >= 1)
    assert.equal('apiKey' in provider, false)
  }
})

test('recommended API catalog links only to approved official provider hosts', async () => {
  const { recommendedAIProviders } = await import(catalogUrl)
  const approvedHosts = new Set([
    'platform.openai.com',
    'platform.deepseek.com',
    'openrouter.ai',
    'cloud.siliconflow.cn',
    'bailian.console.aliyun.com',
    'open.bigmodel.cn',
    'platform.kimi.com',
    'console.volcengine.com',
    'ollama.com'
  ])

  for (const provider of recommendedAIProviders) {
    assert.ok(
      approvedHosts.has(new URL(provider.website).host),
      `${provider.name} should use an approved official host`
    )
  }
})

test('AI config renders the recommended provider catalog and can apply a preset', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-config.jsx'
  ), 'utf8')

  assert.match(source, /recommendedAIProviders/)
  assert.match(source, /shellpilotAiRecommendedProviders/)
  assert.match(source, /handlePresetChange\(provider\.preset\)/)
  assert.match(source, /shellpilotAiOpenProviderWebsite/)
})
