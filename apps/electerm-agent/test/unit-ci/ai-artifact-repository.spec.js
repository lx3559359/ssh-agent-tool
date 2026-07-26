const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  createArtifactRepository,
  writeJsonAtomic
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
const {
  assertArtifactId,
  validateArtifactDraft,
  validateArtifactFormats,
  validateArtifactVersion
} = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-artifacts/artifact-validator'
))

const sourceDraft = {
  schemaVersion: 1,
  type: 'inspection-report',
  title: 'Server inspection',
  server: 'prod-web-01',
  summary: 'version one',
  sections: [],
  tables: [],
  risks: [],
  recommendations: []
}

async function makeTempRoot () {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-artifact-repository-'))
}

async function listFilesRecursively (root) {
  const entries = await fsp.readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(root, entry.name)
    return entry.isDirectory()
      ? listFilesRecursively(target)
      : [target]
  }))
  return nested.flat()
}

test('creates immutable versions with atomic manifests and no temporary files', async () => {
  const tempRoot = await makeTempRoot()
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })

    const created = await repository.create(sourceDraft, {
      origin: 'unit-test'
    })
    const updated = await repository.createVersion(created.id, {
      ...sourceDraft,
      summary: 'version two'
    })
    const artifact = await repository.get(created.id)

    assert.match(created.id, /^[a-z0-9][a-z0-9-]{7,79}$/)
    assert.equal(created.version, 1)
    assert.equal(updated.version, 2)
    assert.equal(artifact.version, 2)
    assert.equal(artifact.versions.length, 2)
    assert.equal(artifact.versions[0].source.summary, 'version one')
    assert.equal(artifact.versions[1].source.summary, 'version two')

    const artifactRoot = path.join(tempRoot, created.id)
    const manifest = JSON.parse(await fsp.readFile(
      path.join(artifactRoot, 'manifest.json'),
      'utf8'
    ))
    const firstSource = JSON.parse(await fsp.readFile(
      path.join(artifactRoot, 'versions', '0001', 'source.json'),
      'utf8'
    ))
    const secondSource = JSON.parse(await fsp.readFile(
      path.join(artifactRoot, 'versions', '0002', 'source.json'),
      'utf8'
    ))

    assert.equal(manifest.id, created.id)
    assert.deepEqual(manifest.versions.map(item => item.version), [1, 2])
    assert.equal(firstSource.summary, 'version one')
    assert.equal(secondSource.summary, 'version two')
    assert.equal((await fsp.stat(
      path.join(artifactRoot, 'versions', '0001', 'files')
    )).isDirectory(), true)
    assert.equal((await fsp.stat(
      path.join(artifactRoot, 'versions', '0002', 'files')
    )).isDirectory(), true)

    const files = await listFilesRecursively(tempRoot)
    assert.equal(files.some(file => file.endsWith('.tmp')), false)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects artifact IDs that can traverse outside the repository root', async () => {
  const tempRoot = await makeTempRoot()
  try {
    const repository = createArtifactRepository({ rootPath: tempRoot })
    await assert.rejects(
      repository.get('../outside'),
      error => error && error.code === 'ARTIFACT_ID_INVALID'
    )
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('never overwrites an existing version directory', async () => {
  const tempRoot = await makeTempRoot()
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const created = await repository.create(sourceDraft)
    const conflictingVersion = path.join(
      tempRoot,
      created.id,
      'versions',
      '0002'
    )
    const conflictingSource = path.join(conflictingVersion, 'source.json')
    await fsp.mkdir(path.join(conflictingVersion, 'files'), {
      recursive: true
    })
    await fsp.writeFile(
      conflictingSource,
      JSON.stringify({ protected: true }),
      'utf8'
    )

    await assert.rejects(
      repository.createVersion(created.id, {
        ...sourceDraft,
        summary: 'must not overwrite'
      }),
      error => error && error.code === 'ARTIFACT_VERSION_EXISTS'
    )
    assert.deepEqual(
      JSON.parse(await fsp.readFile(conflictingSource, 'utf8')),
      { protected: true }
    )
    assert.equal((await repository.get(created.id)).versions.length, 1)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('serializes mutations across repositories that share one normalized root', async () => {
  const tempRoot = await makeTempRoot()
  const originalMkdir = fsp.mkdir
  let arrivals = 0
  let releaseGate
  let releaseTimer
  const gate = new Promise(resolve => {
    releaseGate = resolve
  })
  try {
    const firstRepository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const secondRepository = createArtifactRepository({
      rootPath: path.join(tempRoot, '.'),
      now: () => 1000
    })
    const created = await firstRepository.create(sourceDraft)

    fsp.mkdir = async (target, options) => {
      if (path.basename(String(target)) === '0002') {
        arrivals += 1
        if (arrivals === 1) {
          releaseTimer = setTimeout(releaseGate, 50)
        } else {
          clearTimeout(releaseTimer)
          releaseGate()
        }
        await gate
      }
      return originalMkdir(target, options)
    }

    const settled = await Promise.allSettled([
      firstRepository.createVersion(created.id, {
        ...sourceDraft,
        summary: 'concurrent version A'
      }),
      secondRepository.createVersion(created.id, {
        ...sourceDraft,
        summary: 'concurrent version B'
      })
    ])

    assert.equal(arrivals, 1)
    assert.deepEqual(
      settled.map(result => result.status),
      ['fulfilled', 'fulfilled']
    )
    const results = settled.map(result => result.value)
    assert.deepEqual(
      results.map(result => result.version).sort(),
      [2, 3]
    )
    const artifact = await firstRepository.get(created.id)
    assert.equal(artifact.version, 3)
    assert.deepEqual(
      artifact.versions.slice(1)
        .map(item => item.source.summary)
        .sort(),
      ['concurrent version A', 'concurrent version B']
    )
  } finally {
    clearTimeout(releaseTimer)
    releaseGate()
    fsp.mkdir = originalMkdir
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('keeps a committed version when the post-commit read fails', async () => {
  const tempRoot = await makeTempRoot()
  const originalReadFile = fsp.readFile
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const created = await repository.create(sourceDraft)
    const secondSourcePath = path.join(
      tempRoot,
      created.id,
      'versions',
      '0002',
      'source.json'
    )
    fsp.readFile = async (target, ...args) => {
      if (path.resolve(String(target)) === secondSourcePath) {
        const error = new Error('injected post-commit read failure')
        error.code = 'EIO'
        throw error
      }
      return originalReadFile(target, ...args)
    }

    await assert.rejects(
      repository.createVersion(created.id, {
        ...sourceDraft,
        summary: 'committed version'
      }),
      error => error && error.code === 'ARTIFACT_SOURCE_INVALID'
    )
    fsp.readFile = originalReadFile

    const manifest = JSON.parse(await fsp.readFile(
      path.join(tempRoot, created.id, 'manifest.json'),
      'utf8'
    ))
    assert.deepEqual(manifest.versions.map(item => item.version), [1, 2])
    assert.equal((await fsp.stat(secondSourcePath)).isFile(), true)
    assert.equal((await repository.get(created.id)).version, 2)
  } finally {
    fsp.readFile = originalReadFile
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects linked artifact paths that resolve outside the repository', async t => {
  const fixtureRoot = await makeTempRoot()
  const tempRoot = path.join(fixtureRoot, 'repository')
  const outsideRoot = path.join(fixtureRoot, 'outside')
  await fsp.mkdir(tempRoot)
  await fsp.mkdir(outsideRoot)
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const created = await repository.create(sourceDraft)
    const artifactRoot = path.join(tempRoot, created.id)
    const outsideArtifact = path.join(outsideRoot, created.id)
    await fsp.rename(artifactRoot, outsideArtifact)
    try {
      await fsp.symlink(
        outsideArtifact,
        artifactRoot,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
    } catch (error) {
      if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
        t.skip(`linked directories are unavailable: ${error.code}`)
        return
      }
      throw error
    }

    const operations = [
      () => repository.get(created.id),
      () => repository.list(),
      () => repository.createVersion(created.id, {
        ...sourceDraft,
        summary: 'must stay inside root'
      }),
      () => repository.delete(created.id)
    ]
    for (const operation of operations) {
      await assert.rejects(
        operation(),
        error => error && error.code === 'ARTIFACT_PATH_UNSAFE'
      )
    }
    assert.equal(
      JSON.parse(await fsp.readFile(
        path.join(outsideArtifact, 'versions', '0001', 'source.json'),
        'utf8'
      )).summary,
      'version one'
    )
  } finally {
    await fsp.rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('removes the temporary JSON file when atomic rename fails', async () => {
  const tempRoot = await makeTempRoot()
  const target = path.join(tempRoot, 'manifest.json')
  try {
    await assert.rejects(
      writeJsonAtomic(target, { ok: true }, {
        rename: async () => {
          const error = new Error('rename failed')
          error.code = 'EIO'
          throw error
        }
      }),
      error => error && error.code === 'EIO'
    )
    assert.deepEqual(await fsp.readdir(tempRoot), [])
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('validates draft, ID, version and format boundaries with stable codes', () => {
  assert.equal(assertArtifactId('artifact-1234'), 'artifact-1234')
  assert.equal(validateArtifactVersion(1), 1)
  assert.deepEqual(validateArtifactFormats(['MD', 'csv']), ['md', 'csv'])
  assert.deepEqual(validateArtifactDraft(sourceDraft), sourceDraft)

  assert.throws(
    () => assertArtifactId('C:\\outside\\artifact'),
    error => error && error.code === 'ARTIFACT_ID_INVALID'
  )
  assert.throws(
    () => validateArtifactVersion(0),
    error => error && error.code === 'ARTIFACT_VERSION_INVALID'
  )
  assert.throws(
    () => validateArtifactFormats(['exe']),
    error => error && error.code === 'ARTIFACT_FORMAT_UNSUPPORTED'
  )
  assert.throws(
    () => validateArtifactDraft({ ...sourceDraft, title: '' }),
    error => error && error.code === 'ARTIFACT_TITLE_INVALID'
  )
})

test('service exposes bounded operations and rejects ungenerated exports', async () => {
  const tempRoot = await makeTempRoot()
  try {
    const repository = createArtifactRepository({
      rootPath: tempRoot,
      now: () => 1000
    })
    const service = createArtifactService({ repository })
    const created = await service.createAIArtifact(sourceDraft, {
      origin: 'unit-test'
    })

    assert.equal((await service.listAIArtifacts()).length, 1)
    assert.equal((await service.getAIArtifact(created.id)).id, created.id)
    assert.equal(
      (await service.createAIArtifactVersion(created.id, {
        ...sourceDraft,
        summary: 'service version'
      })).version,
      2
    )
    const generated = await service.generateAIArtifact(
      created.id,
      2,
      ['md']
    )
    assert.deepEqual(
      generated.versions[1].formats.map(item => item.format),
      ['md']
    )
    await assert.rejects(
      service.exportAIArtifactFile(created.id, 2, 'csv', 'report.csv'),
      error => error && error.code === 'ARTIFACT_FILE_NOT_GENERATED'
    )
    assert.equal(await service.deleteAIArtifact(created.id), true)
    assert.equal(await service.getAIArtifact(created.id), null)
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('IPC and renderer client expose only named artifact operations', async () => {
  const ipcSource = await fsp.readFile(path.resolve(
    __dirname,
    '../../src/app/lib/ipc.js'
  ), 'utf8')
  const clientSource = await fsp.readFile(path.resolve(
    __dirname,
    '../../src/client/components/artifacts/artifact-client.js'
  ), 'utf8')
  const operations = [
    'listAIArtifacts',
    'getAIArtifact',
    'createAIArtifact',
    'createAIArtifactVersion',
    'generateAIArtifact',
    'exportAIArtifactFile',
    'deleteAIArtifact'
  ]

  for (const operation of operations) {
    assert.match(ipcSource, new RegExp(`\\b${operation}\\b`))
    assert.match(clientSource, new RegExp(`['"]${operation}['"]`))
  }
  assert.match(clientSource, /window\.pre\.runGlobalAsync/)
  assert.doesNotMatch(clientSource, /stack/)
})

test('renderer client unwraps values and throws coded errors', async () => {
  const calls = []
  const originalWindow = global.window
  global.window = {
    pre: {
      runGlobalAsync: async (...args) => {
        calls.push(args)
        return args[0] === 'getAIArtifact'
          ? { ok: true, value: { id: args[1] } }
          : {
              ok: false,
              error: {
                code: 'ARTIFACT_NOT_FOUND',
                message: 'Artifact was not found.'
              }
            }
      }
    }
  }

  try {
    const moduleUrl = pathToFileURL(path.resolve(
      __dirname,
      '../../src/client/components/artifacts/artifact-client.js'
    )).href
    const client = await import(`${moduleUrl}?test=${Date.now()}`)
    assert.deepEqual(
      await client.getArtifact('artifact-1234'),
      { id: 'artifact-1234' }
    )
    await assert.rejects(
      client.deleteArtifact('artifact-1234'),
      error => error &&
        error.code === 'ARTIFACT_NOT_FOUND' &&
        !('stack' in (error.payload || {}))
    )
    assert.deepEqual(calls.map(call => call[0]), [
      'getAIArtifact',
      'deleteAIArtifact'
    ])
  } finally {
    global.window = originalWindow
  }
})
