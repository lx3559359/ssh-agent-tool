const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  createArtifactService
} = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/artifact-service'
))

const source = {
  schemaVersion: 1,
  type: 'inspection-report',
  title: '巡检报告',
  server: 'prod-01',
  summary: '运行正常。',
  sections: [],
  risks: [],
  recommendations: [],
  tables: [{
    title: '服务',
    columns: ['名称', '状态'],
    rows: [['nginx', '正常']]
  }]
}

test('default artifact service generates registered DOCX and XLSX files', async () => {
  const artifact = {
    id: 'artifact-office-0001',
    versions: [{
      version: 1,
      source,
      formats: []
    }]
  }
  let outputs
  const service = createArtifactService({
    repository: {
      get: async () => artifact,
      saveGeneratedOutputs: async (id, version, generated) => {
        outputs = generated
        return artifact
      }
    },
    now: () => 1234
  })

  await service.generateAIArtifact(
    artifact.id,
    1,
    ['docx', 'xlsx']
  )

  assert.deepEqual(outputs.map(item => item.format), ['docx', 'xlsx'])
  assert.match(outputs[0].filename, /\.docx$/)
  assert.match(outputs[1].filename, /\.xlsx$/)
  assert.ok(outputs.every(item => item.content.length > 100))
})
