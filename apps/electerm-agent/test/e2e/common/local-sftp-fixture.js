const crypto = require('node:crypto')
const { promises: fs } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const prefix = 'shellpilot-quality-sftp-'

function assertPathInsideRoot (root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error('SFTP fixture path escaped its temporary root')
  }
  return resolvedCandidate
}

function resolveVirtualPath (root, input = '/') {
  const normalized = path.posix.normalize('/' + String(input || '/').replace(/\\/g, '/'))
  return assertPathInsideRoot(root, path.join(root, ...normalized.split('/').filter(Boolean)))
}

function hashBuffer (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function createLocalSftpFixture () {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix))
  assertPathInsideRoot(root, root)
  const fixtureContent = Buffer.from('ShellPilot isolated SFTP quality fixture\n', 'utf8')
  await fs.mkdir(path.join(root, 'incoming'), { recursive: true })
  await fs.writeFile(path.join(root, 'remote-seed.txt'), fixtureContent)

  return {
    root,
    fixtureContent,
    fixtureHash: hashBuffer(fixtureContent),
    resolve: input => resolveVirtualPath(root, input),
    hashFile: async input => hashBuffer(await fs.readFile(resolveVirtualPath(root, input))),
    async cleanup () {
      if (!path.basename(root).startsWith(prefix)) {
        throw new Error('Refusing to remove unexpected SFTP fixture root')
      }
      assertPathInsideRoot(path.dirname(root), root)
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}

module.exports = {
  assertPathInsideRoot,
  createLocalSftpFixture,
  resolveVirtualPath
}
