const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const tar = require('tar')

const {
  createAgentSkillRepository
} = require(path.resolve(__dirname, '../../src/app/lib/agent-skill-repository'))
const {
  createAgentSkillImporter
} = require(path.resolve(__dirname, '../../src/app/lib/agent-skill-import'))

const skillDocument = `---
id: imported-skill
name: Imported Skill
description: A safely imported workflow.
version: 1.0.0
triggers:
  - imported workflow
---

# Workflow

Read bounded evidence.
`

function tarEntry (name, content = '', type = 'File', linkpath = '') {
  const body = Buffer.from(content)
  const header = new tar.Header({
    path: name,
    size: type === 'File' ? body.length : 0,
    type,
    linkpath,
    mode: 0o644,
    uid: 0,
    gid: 0,
    mtime: new Date(0)
  })
  const headerBlock = Buffer.alloc(512)
  header.encode(headerBlock)
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return Buffer.concat([headerBlock, body, padding])
}

function rawTar (entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)])
}

let crcTable
function crc32 (buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index
      for (let bit = 0; bit < 8; bit++) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1)
      }
      return value >>> 0
    })
  }
  let crc = 0xFFFFFFFF
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function storedZip (entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name)
    const content = Buffer.from(value)
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    localParts.push(local, nameBuffer, content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + content.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

async function withImporter (run, options = {}) {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-skill-import-'))
  const repository = createAgentSkillRepository({ rootPath: path.join(parent, 'repository') })
  const importer = createAgentSkillImporter({
    repository,
    tempRoot: path.join(parent, 'staging'),
    limits: options.limits
  })
  try {
    await run({ parent, repository, importer })
  } finally {
    await fsp.rm(parent, { recursive: true, force: true })
  }
}

test('imports folders, zip archives and tar archives only as disabled drafts', async () => {
  await withImporter(async ({ parent, repository, importer }) => {
    const folder = path.join(parent, 'folder-package')
    await fsp.mkdir(folder)
    await fsp.writeFile(path.join(folder, 'SKILL.md'), skillDocument, 'utf8')
    const folderDraft = await importer.importSkill(folder)
    assert.equal(folderDraft.state, 'draft')
    assert.equal(folderDraft.enabled, false)

    const zipPath = path.join(parent, 'package.zip')
    await fsp.writeFile(zipPath, storedZip({ 'wrapper/SKILL.md': skillDocument }))
    const zipDraft = await importer.importSkill(zipPath)
    assert.equal(zipDraft.state, 'draft')

    const tarSource = path.join(parent, 'tar-source')
    await fsp.mkdir(tarSource)
    await fsp.writeFile(path.join(tarSource, 'SKILL.md'), skillDocument, 'utf8')
    const tarPath = path.join(parent, 'package.tar')
    await tar.c({ cwd: tarSource, file: tarPath }, ['SKILL.md'])
    const tarDraft = await importer.importSkill(tarPath)
    assert.equal(tarDraft.state, 'draft')
    assert.equal((await repository.list()).length, 3)
  })
})

test('rejects traversal, duplicate normalized names and links without partial drafts', async () => {
  await withImporter(async ({ parent, repository, importer }) => {
    const archives = [
      ['traversal.tar', rawTar([tarEntry('../escape.txt', 'escape')])],
      ['duplicate.tar', rawTar([
        tarEntry('SKILL.md', skillDocument),
        tarEntry('skill.md', skillDocument)
      ])],
      ['symlink.tar', rawTar([
        tarEntry('SKILL.md', skillDocument),
        tarEntry('linked', '', 'SymbolicLink', '../outside')
      ])]
    ]
    for (const [name, content] of archives) {
      const archivePath = path.join(parent, name)
      await fsp.writeFile(archivePath, content)
      await assert.rejects(
        importer.importSkill(archivePath),
        error => error.code.startsWith('SKILL_IMPORT_')
      )
      assert.deepEqual(await repository.list(), [])
    }
  })
})

test('enforces entry, byte and compression-ratio limits before creating a draft', async () => {
  await withImporter(async ({ parent, repository, importer }) => {
    const tooMany = path.join(parent, 'too-many')
    await fsp.mkdir(tooMany)
    await fsp.writeFile(path.join(tooMany, 'SKILL.md'), skillDocument, 'utf8')
    await fsp.writeFile(path.join(tooMany, 'one.txt'), '1', 'utf8')
    await fsp.writeFile(path.join(tooMany, 'two.txt'), '2', 'utf8')
    await assert.rejects(importer.importSkill(tooMany), error => error.code === 'SKILL_IMPORT_FILE_COUNT_EXCEEDED')

    const compressedTar = zlib.gzipSync(rawTar([
      tarEntry('SKILL.md', skillDocument),
      tarEntry('references/large.txt', 'A'.repeat(128 * 1024))
    ]), { level: 9 })
    const gzipPath = path.join(parent, 'ratio.tar.gz')
    await fsp.writeFile(gzipPath, compressedTar)
    await assert.rejects(importer.importSkill(gzipPath), error => error.code === 'SKILL_IMPORT_COMPRESSION_RATIO_EXCEEDED')
    assert.deepEqual(await repository.list(), [])
  }, {
    limits: {
      maxFiles: 2,
      maxFileBytes: 256 * 1024,
      maxTotalBytes: 512 * 1024,
      maxCompressionRatio: 10,
      compressionRatioMinBytes: 32 * 1024
    }
  })
})

test('rejects source symlinks and unsupported source types', async (t) => {
  await withImporter(async ({ parent, repository, importer }) => {
    const actual = path.join(parent, 'actual')
    const linked = path.join(parent, 'linked')
    await fsp.mkdir(actual)
    await fsp.writeFile(path.join(actual, 'SKILL.md'), skillDocument, 'utf8')
    try {
      await fsp.symlink(actual, linked, 'junction')
    } catch (error) {
      t.skip(`symlink fixture unavailable: ${error.code}`)
      return
    }
    await assert.rejects(importer.importSkill(linked), error => error.code === 'SKILL_IMPORT_LINK_REJECTED')
    const unsupported = path.join(parent, 'plain.txt')
    await fsp.writeFile(unsupported, 'not a package', 'utf8')
    await assert.rejects(importer.importSkill(unsupported), error => error.code === 'SKILL_IMPORT_TYPE_UNSUPPORTED')
    assert.deepEqual(await repository.list(), [])
  })
})
