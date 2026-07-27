const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  createGeneratorRegistry
} = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/generator-registry'
))
const markdownGenerator = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/markdown-generator'
))
const csvGenerator = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/csv-generator'
))
const htmlGenerator = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/html-generator'
))
const {
  createArtifactRepository
} = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/artifact-repository'
))
const {
  createArtifactService
} = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/artifact-service'
))

const structuredSource = {
  schemaVersion: 1,
  type: 'inspection-report',
  title: '# Production | inspection',
  server: 'prod-01 <primary>',
  summary: 'Summary with *literal* markup.',
  sections: [
    {
      title: 'CPU [details]',
      content: 'Load is < 80%.\nNo # heading.'
    },
    {
      title: 'Disk',
      content: 'Free space is 42%.'
    }
  ],
  risks: ['Pipe | risk', 'HTML <script>'],
  recommendations: ['Keep **monitoring**', 'Rotate logs'],
  tables: [
    {
      title: 'Services | primary',
      columns: ['Name', 'State'],
      rows: [
        ['api', 'running'],
        ['worker|queue', 'line 1\nline 2']
      ]
    },
    {
      title: 'CSV safety',
      columns: ['Value', 'Meaning'],
      rows: [
        ['plain,comma', 'quoted "text"'],
        ['=2+2', 'formula'],
        ['+cmd', 'formula'],
        ['-cmd', 'formula'],
        ['@SUM(A1:A2)', 'formula'],
        ['\t=2+2', 'tab-prefixed formula'],
        ['\r\n@SUM(A1:A2)', 'line-prefixed formula'],
        ['-42.5', 'ordinary negative number'],
        ['line 1\r\nline 2', 'multiline']
      ]
    }
  ]
}

async function makeTempRoot () {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-artifact-generators-'))
}

function outputFor (artifact, version, format) {
  return artifact.versions
    .find(item => item.version === version)
    .formats.find(item => item.format === format)
}

test('registry registers handlers by format and generates buffers', async () => {
  const calls = []
  const registry = createGeneratorRegistry([{
    format: 'md',
    generate: async (source, context) => {
      calls.push({ source, context })
      return { content: Buffer.from('# Report') }
    }
  }])
  const source = { title: 'Report' }
  const context = { version: 2 }

  const result = await registry.generate('MD', source, context)

  assert.equal(result.content.toString('utf8'), '# Report')
  assert.deepEqual(calls, [{ source, context }])
})

test('registry reports unsupported, duplicate and malformed generators', async () => {
  const handler = {
    format: 'md',
    generate: () => ({ content: Buffer.from('ok') })
  }
  const registry = createGeneratorRegistry([handler])

  await assert.rejects(
    registry.generate('exe', {}, {}),
    error => error && error.code === 'ARTIFACT_FORMAT_UNSUPPORTED'
  )
  assert.throws(
    () => registry.register(handler),
    error => error && error.code === 'ARTIFACT_GENERATOR_DUPLICATE'
  )
  assert.throws(
    () => createGeneratorRegistry([{}]),
    error => error && error.code === 'ARTIFACT_GENERATOR_INVALID'
  )
  assert.throws(
    () => createGeneratorRegistry([{ format: 'csv' }]),
    error => error && error.code === 'ARTIFACT_GENERATOR_INVALID'
  )
})

test('registry rejects generator results that are not buffers', async () => {
  const registry = createGeneratorRegistry([{
    format: 'md',
    generate: () => ({ content: '# Report' })
  }])

  await assert.rejects(
    registry.generate('md', {}, {}),
    error => error && error.code === 'ARTIFACT_GENERATOR_INVALID'
  )
})

test('Markdown generator deterministically includes and escapes every section and table', async () => {
  const { content: first } = await markdownGenerator.generate(structuredSource)
  const { content: second } = await markdownGenerator.generate(structuredSource)
  const markdown = first.toString('utf8')

  assert.equal(Buffer.compare(first, second), 0)
  assert.match(markdown, /^# \\# Production \\[|] inspection/m)
  assert.match(markdown, /\*\*Server:\*\* prod-01 &lt;primary&gt;/)
  assert.match(markdown, /## Summary/)
  assert.match(markdown, /Summary with \\\*literal\\\* markup\./)
  assert.ok(markdown.includes('## CPU \\[details\\]'))
  assert.match(markdown, /Load is &lt; 80%\./)
  assert.match(markdown, /## Disk/)
  assert.match(markdown, /## Risks/)
  assert.match(markdown, /Pipe \\[|] risk/)
  assert.match(markdown, /HTML &lt;script&gt;/)
  assert.match(markdown, /## Recommendations/)
  assert.match(markdown, /Keep \\\*\\\*monitoring\\\*\\\*/)
  assert.match(markdown, /## Services \\[|] primary/)
  assert.match(markdown, /worker\\[|]queue/)
  assert.match(markdown, /line 1<br>line 2/)
  assert.match(markdown, /## CSV safety/)
  assert.ok(markdown.indexOf('## Services') < markdown.indexOf('## CSV safety'))
})

test('CSV generator emits every table with RFC4180 quoting and formula safety', async () => {
  const { content: first } = await csvGenerator.generate(structuredSource)
  const { content: second } = await csvGenerator.generate(structuredSource)
  const csv = first.toString('utf8')

  assert.equal(Buffer.compare(first, second), 0)
  assert.equal(
    csv,
    [
      'Table,Services | primary',
      'Name,State',
      'api,running',
      'worker|queue,"line 1',
      'line 2"',
      '',
      'Table,CSV safety',
      'Value,Meaning',
      '"plain,comma","quoted ""text"""',
      "'=2+2,formula",
      "'+cmd,formula",
      "'-cmd,formula",
      "'@SUM(A1:A2),formula",
      "'\t=2+2,tab-prefixed formula",
      "\"'",
      '@SUM(A1:A2)",line-prefixed formula',
      '-42.5,ordinary negative number',
      '"line 1',
      'line 2",multiline',
      ''
    ].join('\r\n')
  )
})

test('HTML generator creates a standalone escaped Chinese report', async () => {
  const { content, contentType, filename } = await htmlGenerator.generate({
    ...structuredSource,
    title: '服务器巡检网页',
    summary: '<script>alert("x")</script>'
  })
  const html = content.toString('utf8')

  assert.equal(contentType, 'text/html; charset=utf-8')
  assert.equal(filename, '服务器巡检网页.html')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /服务器巡检网页/)
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
})

test('service persists generated Markdown and CSV metadata on only the selected version', async () => {
  const tempRoot = await makeTempRoot()
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const service = createArtifactService({
      repository,
      now: () => 2000
    })
    const created = await service.createAIArtifact(structuredSource)
    const versioned = await service.createAIArtifactVersion(created.id, {
      ...structuredSource,
      summary: 'Version two summary.'
    })
    const sourcePath = path.join(
      tempRoot,
      created.id,
      'versions',
      '0002',
      'source.json'
    )
    const sourceBefore = await fsp.readFile(sourcePath)

    const generated = await service.generateAIArtifact(
      created.id,
      versioned.version,
      ['md', 'csv']
    )

    assert.deepEqual(generated.versions[0].formats, [])
    assert.equal(generated.versions[0].source.summary, structuredSource.summary)
    assert.equal(generated.versions[1].source.summary, 'Version two summary.')
    assert.deepEqual(
      generated.versions[1].formats.map(item => item.format),
      ['md', 'csv']
    )
    for (const format of ['md', 'csv']) {
      const output = outputFor(generated, 2, format)
      assert.match(output.filename, /^artifact-v0002\.(?:md|csv)$/)
      assert.equal(output.generatedAt, 2000)
      const content = await fsp.readFile(path.join(
        tempRoot,
        created.id,
        'versions',
        '0002',
        'files',
        output.filename
      ))
      assert.equal(output.bytes, content.byteLength)
      assert.equal(
        output.sha256,
        crypto.createHash('sha256').update(content).digest('hex')
      )
    }
    assert.deepEqual(await fsp.readFile(sourcePath), sourceBefore)
    assert.deepEqual(
      await fsp.readdir(path.join(
        tempRoot,
        created.id,
        'versions',
        '0001',
        'files'
      )),
      []
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('service safely replaces one generated format without changing other outputs', async () => {
  const tempRoot = await makeTempRoot()
  try {
    let timestamp = 2000
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const service = createArtifactService({
      repository,
      now: () => timestamp
    })
    const created = await service.createAIArtifact(structuredSource)
    const first = await service.generateAIArtifact(
      created.id,
      1,
      ['md', 'csv']
    )
    const mdOutput = outputFor(first, 1, 'md')
    const csvOutput = outputFor(first, 1, 'csv')
    const filesPath = path.join(
      tempRoot,
      created.id,
      'versions',
      '0001',
      'files'
    )
    const csvBefore = await fsp.readFile(path.join(
      filesPath,
      csvOutput.filename
    ))
    await fsp.writeFile(path.join(filesPath, mdOutput.filename), 'tampered')
    timestamp = 3000

    const replaced = await service.generateAIArtifact(
      created.id,
      1,
      ['md']
    )

    assert.deepEqual(
      replaced.versions[0].formats.map(item => item.format),
      ['md', 'csv']
    )
    assert.equal(
      replaced.versions[0].formats.filter(item => item.format === 'md').length,
      1
    )
    assert.equal(outputFor(replaced, 1, 'md').generatedAt, 3000)
    assert.deepEqual(
      await fsp.readFile(path.join(filesPath, csvOutput.filename)),
      csvBefore
    )
    assert.notEqual(
      (await fsp.readFile(path.join(filesPath, mdOutput.filename), 'utf8')),
      'tampered'
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('failed backup creation leaves the registered output untouched', async () => {
  const tempRoot = await makeTempRoot()
  const originalRename = fsp.rename
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const service = createArtifactService({
      repository,
      now: () => 2000
    })
    const created = await service.createAIArtifact(structuredSource)
    const generated = await service.generateAIArtifact(
      created.id,
      1,
      ['md']
    )
    const mdOutput = outputFor(generated, 1, 'md')
    const storedPath = path.join(
      tempRoot,
      created.id,
      'versions',
      '0001',
      'files',
      mdOutput.filename
    )
    const contentBefore = await fsp.readFile(storedPath)
    fsp.rename = async (source, destination) => {
      if (String(destination).endsWith('.bak')) {
        const error = new Error('injected backup failure')
        error.code = 'EIO'
        throw error
      }
      return originalRename(source, destination)
    }

    await assert.rejects(
      service.generateAIArtifact(created.id, 1, ['md']),
      error => error && error.code === 'EIO'
    )
    fsp.rename = originalRename

    assert.deepEqual(await fsp.readFile(storedPath), contentBefore)
  } finally {
    fsp.rename = originalRename
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('service exports only registered generated files without exposing repository paths', async () => {
  const tempRoot = await makeTempRoot()
  const destination = `.ai-artifact-export-${process.pid}-${Date.now()}.md`
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const service = createArtifactService({
      repository,
      now: () => 2000
    })
    const created = await service.createAIArtifact(structuredSource)
    const generated = await service.generateAIArtifact(
      created.id,
      1,
      ['md']
    )
    const mdOutput = outputFor(generated, 1, 'md')
    const storedContent = await fsp.readFile(path.join(
      tempRoot,
      created.id,
      'versions',
      '0001',
      'files',
      mdOutput.filename
    ))

    const exported = await service.exportAIArtifactFile(
      created.id,
      1,
      'md',
      destination
    )

    assert.deepEqual(await fsp.readFile(destination), storedContent)
    assert.deepEqual(exported, {
      format: 'md',
      filename: mdOutput.filename,
      bytes: mdOutput.bytes,
      sha256: mdOutput.sha256,
      generatedAt: mdOutput.generatedAt
    })
    await assert.rejects(
      service.exportAIArtifactFile(
        created.id,
        1,
        'pdf',
        `${destination}.pdf`
      ),
      error => error &&
        error.code === 'ARTIFACT_FILE_NOT_GENERATED' &&
        !error.message.includes(tempRoot)
    )
    await assert.rejects(
      service.generateAIArtifact(created.id, 1, ['exe']),
      error => error && error.code === 'ARTIFACT_FORMAT_UNSUPPORTED'
    )
  } finally {
    await fsp.rm(destination, { force: true })
    await fsp.rm(`${destination}.pdf`, { force: true })
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})
