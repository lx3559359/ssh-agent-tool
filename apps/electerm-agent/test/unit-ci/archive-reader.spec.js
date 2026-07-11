const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const tar = require('tar')

const {
  listArchive,
  readArchiveTextEntry,
  detectArchiveType,
  validateArchiveEntryPath
} = require('../../src/app/common/archive-reader')
process.env.NODE_ENV = 'development'
const { fsExport } = require('../../src/app/lib/fs')

function makeTempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-archive-'))
}

function makeCrcTable () {
  const table = []
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

const CRC_TABLE = makeCrcTable()

function crc32 (buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function createStoreZip (entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const [entryPath, value] of Object.entries(entries)) {
    const name = Buffer.from(entryPath)
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }

  const centralOffset = offset
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

test('detects supported archive types and rejects unsafe entry paths', () => {
  assert.equal(detectArchiveType('/tmp/app.log.gz'), 'gz')
  assert.equal(detectArchiveType('/tmp/app.tgz'), 'tar.gz')
  assert.equal(detectArchiveType('/tmp/app.tar.gz'), 'tar.gz')
  assert.equal(detectArchiveType('/tmp/app.zip'), 'zip')
  assert.throws(() => detectArchiveType('/tmp/app.rar'), /只支持|support/)
  assert.equal(validateArchiveEntryPath('logs/app.log'), 'logs/app.log')
  assert.throws(() => validateArchiveEntryPath('../app.log'), /路径|path/)
  assert.throws(() => validateArchiveEntryPath('/var/log/app.log'), /路径|path/)
  assert.throws(() => validateArchiveEntryPath('C:/app.log'), /路径|path/)
})

test('lists and reads gzip text logs', async () => {
  const root = makeTempDir()
  const archivePath = path.join(root, 'app.log.gz')
  const content = 'ERROR example\nOK\n'
  fs.writeFileSync(archivePath, zlib.gzipSync(content))

  try {
    const listing = await listArchive(archivePath)
    assert.equal(listing.type, 'gz')
    assert.deepEqual(listing.entries.map(entry => entry.path), ['app.log'])

    const result = await readArchiveTextEntry(archivePath, 'app.log', {
      maxBytes: 32
    })
    assert.equal(result.archiveType, 'gz')
    assert.equal(result.entryPath, 'app.log')
    assert.equal(result.content, content)
    assert.equal(result.binary, false)
    assert.equal(result.hasMore, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fsExport exposes local archive listing and text reads', async () => {
  const root = makeTempDir()
  const archivePath = path.join(root, 'local.log.gz')
  fs.writeFileSync(archivePath, zlib.gzipSync('local archive\n'))

  try {
    const listing = await fsExport.listArchive(archivePath)
    assert.deepEqual(listing.entries.map(entry => entry.path), ['local.log'])

    const result = await fsExport.readArchiveTextEntry(
      archivePath,
      'local.log',
      { maxBytes: 64 }
    )
    assert.equal(result.content, 'local archive\n')
    assert.equal(result.archiveType, 'gz')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('lists and reads zip text members with byte bounds', async () => {
  const root = makeTempDir()
  const archivePath = path.join(root, 'logs.zip')
  fs.writeFileSync(archivePath, createStoreZip({
    'app.log': 'ERROR\nOK\n',
    'binary.bin': Buffer.from([0x61, 0x00, 0x62])
  }))

  try {
    const listing = await listArchive(archivePath)
    assert.equal(listing.type, 'zip')
    assert.deepEqual(
      listing.entries.map(entry => entry.path),
      ['app.log', 'binary.bin']
    )

    const result = await readArchiveTextEntry(archivePath, 'app.log', {
      maxBytes: 5
    })
    assert.equal(result.content, 'ERROR')
    assert.equal(result.binary, false)
    assert.equal(result.hasMore, true)

    const binary = await readArchiveTextEntry(archivePath, 'binary.bin', {
      maxBytes: 32
    })
    assert.equal(binary.binary, true)
    assert.equal(binary.content, '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('lists and reads tar.gz text members', async () => {
  const root = makeTempDir()
  const archivePath = path.join(root, 'logs.tar.gz')
  fs.writeFileSync(path.join(root, 'app.log'), 'tar error\n')
  await tar.c({
    cwd: root,
    file: archivePath,
    gzip: true
  }, ['app.log'])

  try {
    const listing = await listArchive(archivePath)
    assert.equal(listing.type, 'tar.gz')
    assert.deepEqual(listing.entries.map(entry => entry.path), ['app.log'])

    const result = await readArchiveTextEntry(archivePath, 'app.log', {
      maxBytes: 64
    })
    assert.equal(result.content, 'tar error\n')
    assert.equal(result.binary, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects unsafe zip members and archive limit violations', async () => {
  const root = makeTempDir()
  const traversalZip = path.join(root, 'traversal.zip')
  const manyZip = path.join(root, 'many.zip')
  fs.writeFileSync(traversalZip, createStoreZip({
    '../escape.log': 'bad'
  }))
  fs.writeFileSync(manyZip, createStoreZip({
    'a.log': 'a',
    'b.log': 'b'
  }))

  try {
    await assert.rejects(listArchive(traversalZip), /路径|path/)
    await assert.rejects(listArchive(manyZip, { maxEntries: 1 }), /成员|entries/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
