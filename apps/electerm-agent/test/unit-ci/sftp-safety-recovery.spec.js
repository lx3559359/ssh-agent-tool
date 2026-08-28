const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/sftp/sftp-safety.js')
).href

const fixedDisplacementToken = 'f'.repeat(24)

function rootRecoveryProof (kind, sourcePath, backupPath, proof) {
  return {
    action: Object.freeze({ kind, sourcePath, backupPath }),
    ...proof
  }
}

test('SFTP backup and trash paths stay beside the source with timestamps', async () => {
  const { buildSftpSafetyPath } = await import(moduleUrl)
  const now = new Date('2026-07-12T08:09:10Z')

  assert.equal(
    buildSftpSafetyPath('/var/www/app', 'backup', now),
    '/var/www/.shellpilot-backups/app-20260712-080910'
  )
  assert.equal(
    buildSftpSafetyPath('/var/log/app.log', 'trash', now),
    '/var/log/.shellpilot-trash/app.log-20260712-080910'
  )
})

test('one-click SFTP backup copies files and folders without changing originals', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const calls = []
  const sftp = {
    lstat: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    mkdir: async value => calls.push(['mkdir', value]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }
  const files = [
    { path: '/var/www', name: 'app', isDirectory: true },
    { path: '/var/www', name: 'nginx.conf', isDirectory: false }
  ]
  const records = await backupRemoteFiles({
    sftp,
    files,
    tab: { id: 'tab-1', host: '10.0.0.8', port: 2222, username: 'root', title: '生产服务器' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/var/www/.shellpilot-backups'],
    ['cp', '/var/www/app', '/var/www/.shellpilot-backups/app-20260712-080910'],
    ['cp', '/var/www/nginx.conf', '/var/www/.shellpilot-backups/nginx.conf-20260712-080910']
  ])
  assert.equal(records.length, 2)
  assert.equal(records[0].kind, 'backup')
  assert.equal(records[0].sourcePath, '/var/www/app')
  assert.equal(records[0].status, 'available')
  assert.equal(records[0].source, 'sftp')
  assert.equal(records[0].target, '/var/www/app')
  assert.equal(records[0].rollbackStatus, 'available')
  assert.equal(records[0].port, 2222)
  assert.equal(records[0].username, 'root')
})

test('SFTP backup publishes each recovery record before starting the next copy', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const events = []
  const secondCopyError = new Error('second copy failed')
  const sftp = {
    lstat: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    mkdir: async value => events.push(['mkdir', value]),
    cp: async (from, to) => {
      events.push(['cp', from, to])
      if (from.endsWith('/second.conf')) throw secondCopyError
    }
  }

  await assert.rejects(
    backupRemoteFiles({
      sftp,
      files: [
        { path: '/etc/app', name: 'first.conf', isDirectory: false },
        { path: '/etc/app', name: 'second.conf', isDirectory: false }
      ],
      tab: { id: 'tab-1', host: '10.0.0.8' },
      now: new Date('2026-07-12T08:09:10Z'),
      onRecord: async record => {
        events.push(['record', record.sourcePath, record.backupPath])
        return { ...record, metadata: { persisted: true } }
      }
    }),
    error => error === secondCopyError
  )

  assert.deepEqual(events, [
    ['mkdir', '/etc/app/.shellpilot-backups'],
    ['cp', '/etc/app/first.conf', '/etc/app/.shellpilot-backups/first.conf-20260712-080910'],
    ['record', '/etc/app/first.conf', '/etc/app/.shellpilot-backups/first.conf-20260712-080910'],
    ['cp', '/etc/app/second.conf', '/etc/app/.shellpilot-backups/second.conf-20260712-080910']
  ])
})

test('SFTP backup chooses a collision-free path when the timestamped name already exists', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const calls = []
  const existing = '/var/www/.shellpilot-backups/app-20260712-080910'
  const sftp = {
    stat: async () => { throw new Error('backup missing checks must not follow symlinks') },
    lstat: async value => {
      if (value === existing) return { isDirectory: true }
      throw Object.assign(new Error('No such file'), { code: 'ENOENT' })
    },
    mkdir: async value => calls.push(['mkdir', value]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }

  const records = await backupRemoteFiles({
    sftp,
    files: [{ path: '/var/www', name: 'app', isDirectory: true }],
    tab: { id: 'tab-1', host: '10.0.0.8' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/var/www/.shellpilot-backups'],
    ['cp', '/var/www/app', `${existing}-2`]
  ])
  assert.equal(records[0].backupPath, `${existing}-2`)
})

test('SFTP backup accepts only authoritative missing and existing-directory codes', async t => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const file = { path: '/etc', name: 'app.conf', isDirectory: false }
  const now = new Date('2026-07-12T08:09:10Z')

  for (const code of ['ENOENT', 'SFTP_NO_SUCH_FILE', 2]) {
    await t.test(`missing ${code}`, async () => {
      const calls = []
      const sftp = {
        stat: async () => { throw new Error('stat must not be called') },
        lstat: async path => {
          calls.push(['lstat', path])
          throw Object.assign(new Error('missing'), { code })
        },
        mkdir: async path => calls.push(['mkdir', path]),
        cp: async (source, target) => calls.push(['cp', source, target])
      }
      const records = await backupRemoteFiles({ sftp, files: [file], now })
      assert.equal(records.length, 1)
      assert.equal(calls[0][0], 'lstat')
      assert.equal(calls.at(-1)[0], 'cp')
    })
  }

  for (const error of [
    Object.assign(new Error('No such file'), { code: 'EACCES' }),
    Object.assign(new Error('failure'), {
      code: 'PRIVILEGED_FILE_OPERATION_FAILED'
    }),
    new Error('No such file')
  ]) {
    await t.test(`fails closed for ${error.code || 'generic error'}`, async () => {
      let copies = 0
      await assert.rejects(backupRemoteFiles({
        sftp: {
          lstat: async () => { throw error },
          mkdir: async () => {},
          cp: async () => { copies += 1 }
        },
        files: [file],
        now
      }), cause => cause === error)
      assert.equal(copies, 0)
    })
  }

  await t.test('existing backup directory uses only EEXIST', async () => {
    const copied = []
    await backupRemoteFiles({
      sftp: {
        lstat: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        mkdir: async () => {
          throw Object.assign(new Error('exists'), { code: 'EEXIST' })
        },
        cp: async (source, target) => copied.push([source, target])
      },
      files: [file],
      now
    })
    assert.equal(copied.length, 1)
  })

  await t.test('generic mkdir failure is not an existing directory', async () => {
    const failure = Object.assign(new Error('Failure'), {
      code: 'PRIVILEGED_FILE_OPERATION_FAILED'
    })
    let copies = 0
    await assert.rejects(backupRemoteFiles({
      sftp: {
        lstat: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        mkdir: async () => { throw failure },
        cp: async () => { copies += 1 }
      },
      files: [file],
      now
    }), cause => cause === failure)
    assert.equal(copies, 0)
  })
})

test('SFTP safe delete moves entries to trash instead of removing them', async () => {
  const { softDeleteRemoteFiles } = await import(moduleUrl)
  const calls = []
  const sftp = {
    lstat: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    mkdir: async value => calls.push(['mkdir', value]),
    rename: async (from, to) => calls.push(['rename', from, to]),
    rm: async value => calls.push(['rm', value]),
    rmdir: async value => calls.push(['rmdir', value])
  }
  const records = await softDeleteRemoteFiles({
    sftp,
    files: [{ path: '/opt/app', name: 'config.yml', isDirectory: false }],
    tab: { id: 'tab-1', host: '10.0.0.8' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/opt/app/.shellpilot-trash'],
    ['rename', '/opt/app/config.yml', '/opt/app/.shellpilot-trash/config.yml-20260712-080910']
  ])
  assert.equal(records[0].kind, 'trash')
  assert.equal(records[0].backupPath, '/opt/app/.shellpilot-trash/config.yml-20260712-080910')
})

test('SFTP restore preserves current content before restoring a backup', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    stat: async () => ({ isDirectory: false }),
    mkdir: async value => calls.push(['mkdir', value]),
    rename: async (from, to) => calls.push(['rename', from, to]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'r1',
      kind: 'backup',
      sourcePath: '/etc/nginx/nginx.conf',
      backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910',
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/etc/nginx/.shellpilot-before-restore'],
    ['rename', '/etc/nginx/nginx.conf', '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011'],
    ['cp', '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910', '/etc/nginx/nginx.conf']
  ])
  assert.equal(result.status, 'restored')
  assert.equal(result.rollbackStatus, 'completed')
  assert.equal(result.displacedPath, '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011')
})

test('root recovery installs a deleted target with exact proof and no path-only mutation', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root',
      device: '1',
      inode: '10',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const calls = []
  const result = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => { throw new Error('No such file') },
      cp: async () => { throw new Error('path-only cp forbidden') },
      rename: async () => { throw new Error('path-only rename forbidden') },
      copyEntry: async (source, target, options) => {
        calls.push(['copyEntry', source, target, options])
        return 1
      },
      removeEntry: async () => { throw new Error('deleted target must not be removed') }
    },
    record: {
      id: 'root-deleted',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: absent, backup
    }),
    describeEntry: async path => path === sourcePath ? absent : backup,
    persistRecord: async value => value
  })

  assert.equal(result.status, 'restored')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 3), [
    'copyEntry',
    backupPath,
    sourcePath
  ])
  assert.deepEqual(calls[0][3], {
    expectedSource: backup,
    expectedTarget: absent
  })
})

test('root recovery helper rejects an action changed after proof binding without mutation', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const source = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  let mutations = 0
  await assert.rejects(restoreSftpRecoveryRecord({
    sftp: {
      copyEntry: async () => { mutations += 1 },
      removeEntry: async () => { mutations += 1 }
    },
    record: {
      id: 'root-action-helper',
      kind: 'trash',
      sourcePath,
      backupPath,
      status: 'available'
    },
    describeEntry: async () => source,
    recoveryProof: {
      action: Object.freeze({ kind: 'backup', sourcePath, backupPath }),
      source,
      backup: { ...source, inode: '42' }
    }
  }), error => error?.code === 'REMOTE_FILE_RECOVERY_BINDING_MISMATCH')
  assert.equal(mutations, 0)
})

test('root recovery proof never downgrades to path-only mutation methods', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root',
      device: '1',
      inode: '10',
      mode: 0o755,
      uid: 1000,
      gid: 1000
    })
  })
  let pathOnlyCalls = 0

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => { pathOnlyCalls += 1 },
      cp: async () => { pathOnlyCalls += 1 },
      rename: async () => { pathOnlyCalls += 1 }
    },
    record: {
      id: 'root-no-downgrade',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: absent, backup
    }),
    describeEntry: async path => path === sourcePath ? absent : backup
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_BINDING_MISMATCH')
  assert.equal(pathOnlyCalls, 0)
})

test('root trash recovery consumes the backup with an exact remove after install', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-trash/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o755, uid: 1000, gid: 1000
    })
  })
  const calls = []

  const result = await restoreSftpRecoveryRecord({
    sftp: {
      cp: async () => { throw new Error('path-only cp forbidden') },
      rename: async () => { throw new Error('path-only rename forbidden') },
      copyEntry: async (source, target, options) => {
        calls.push(['copyEntry', source, target, options])
        return 1
      },
      removeEntry: async (path, options) => {
        calls.push(['removeEntry', path, options])
        return 1
      }
    },
    record: {
      id: 'root-trash-deleted',
      kind: 'trash',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('trash', sourcePath, backupPath, {
      source: absent, backup
    }),
    describeEntry: async () => backup,
    persistRecord: async value => value
  })

  assert.equal(result.status, 'restored')
  assert.deepEqual(calls, [
    ['copyEntry', backupPath, sourcePath, {
      expectedSource: backup,
      expectedTarget: absent
    }],
    ['removeEntry', backupPath, {
      expectedSource: backup,
      expectedPeer: { path: sourcePath, descriptor: backup }
    }]
  ])
})

test('root trash recovery records both copies when exact backup removal fails', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-trash/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const installed = Object.freeze({ ...backup, inode: '43' })
  const changedBackup = Object.freeze({ ...backup, sha256: 'b'.repeat(64) })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o755, uid: 1000, gid: 1000
    })
  })
  const removeFailure = Object.assign(new Error('backup proof changed'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: backupPath,
    expectedDescriptor: backup,
    actualDescriptor: changedBackup
  })
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      copyEntry: async () => 1,
      removeEntry: async () => { throw removeFailure }
    },
    record: {
      id: 'root-trash-duplicated',
      kind: 'trash',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('trash', sourcePath, backupPath, {
      source: absent, backup
    }),
    describeEntry: async path => path === sourcePath ? installed : changedBackup,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, removeFailure)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).backupDisposition.status, 'duplicated')
  assert.deepEqual(persisted.at(-1).backupDisposition.sourceDescriptor, installed)
  assert.deepEqual(persisted.at(-1).backupDisposition.backupDescriptor, changedBackup)
  assert.deepEqual(persisted.at(-1).proofMismatch, {
    path: backupPath,
    expectedDescriptor: backup,
    actualDescriptor: changedBackup
  })
})

test('root trash recovery does not claim success if installed content changes during backup removal', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-trash/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const installed = Object.freeze({ ...backup, inode: '43' })
  const foreign = Object.freeze({ ...installed, sha256: 'f'.repeat(64) })
  const absentAt = path => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: path.slice(0, path.lastIndexOf('/')) || '/',
      device: '1',
      inode: '10',
      mode: 0o755,
      uid: 1000,
      gid: 1000
    })
  })
  const sourceAbsent = absentAt(sourcePath)
  const backupAbsent = absentAt(backupPath)
  let backupRemoved = false
  let sourceReads = 0
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      copyEntry: async () => installed,
      removeEntry: async path => {
        assert.equal(path, backupPath)
        backupRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-trash-remove-window-race',
      kind: 'trash',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('trash', sourcePath, backupPath, {
      source: sourceAbsent, backup
    }),
    describeEntry: async path => {
      if (path === sourcePath) {
        sourceReads += 1
        return sourceReads === 1 ? installed : foreign
      }
      return backupRemoved ? backupAbsent : backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(persisted.at(-1).backupDisposition.status, 'removed-uncertain')
  assert.deepEqual(persisted.at(-1).backupDisposition.sourceDescriptor, foreign)
  assert.deepEqual(persisted.at(-1).backupDisposition.backupDescriptor, backupAbsent)
})

test('root recovery displaces an existing target with proof-bound copy and exact remove', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const current = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...current, inode: '42' })
  const displaced = Object.freeze({ ...current, inode: '43' })
  const absentAt = (path, basename, parentPath) => Object.freeze({
    type: 'bound-absent',
    path,
    basename,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath,
      device: '1',
      inode: parentPath === '/root' ? '10' : '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const displacedAbsent = absentAt(
    displacedPath,
    `app.conf-20260712-091011-${fixedDisplacementToken}`,
    '/root/.shellpilot-before-restore'
  )
  const sourceAbsent = absentAt(sourcePath, 'app.conf', '/root')
  const calls = []
  let displacedCreated = false
  let sourceRemoved = false
  const persisted = []
  const result = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async path => calls.push(['mkdir', path]),
      rename: async () => { throw new Error('path-only rename forbidden') },
      cp: async () => { throw new Error('path-only cp forbidden') },
      copyEntry: async (source, target, options) => {
        calls.push(['copyEntry', source, target, options])
        if (target === displacedPath) displacedCreated = true
        return 1
      },
      removeEntry: async (path, options) => {
        calls.push(['removeEntry', path, options])
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-existing',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: current, backup
    }),
    describeEntry: async (path, options) => {
      if (path === sourcePath) return sourceRemoved ? sourceAbsent : current
      if (path === displacedPath) {
        return displacedCreated ? displaced : displacedAbsent
      }
      if (path === backupPath) return backup
      throw new Error(`unexpected describe ${path} ${JSON.stringify(options)}`)
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  })

  assert.deepEqual(calls, [
    ['mkdir', '/root/.shellpilot-before-restore'],
    ['copyEntry', sourcePath, displacedPath, {
      expectedSource: current,
      expectedTarget: displacedAbsent
    }],
    ['removeEntry', sourcePath, {
      expectedSource: current,
      expectedPeer: { path: displacedPath, descriptor: displaced }
    }],
    ['copyEntry', backupPath, sourcePath, {
      expectedSource: backup,
      expectedTarget: sourceAbsent
    }]
  ])
  assert.deepEqual(persisted.map(value => value.displacement?.status), [
    'planned',
    'displaced'
  ])
  assert.deepEqual(persisted[1].displacement.descriptor, displaced)
  assert.deepEqual(persisted[1].displacement.sourceState, sourceAbsent)
  assert.equal(result.status, 'restored')
  assert.equal(result.displacement.status, 'preserved')
})

test('root recovery skips an occupied displacement candidate and persists an absent candidate before copy', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const base = '/root/.shellpilot-before-restore/app.conf-20260712-091011'
  const tokens = ['a'.repeat(24), 'b'.repeat(24)]
  const occupiedPath = `${base}-${tokens[0]}`
  const selectedPath = `${base}-${tokens[1]}`
  const descriptor = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...descriptor, inode: '42' })
  const foreign = Object.freeze({ ...descriptor, inode: '99' })
  const displaced = Object.freeze({ ...descriptor, inode: '43' })
  const absent = path => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const sourceAbsent = Object.freeze({
    ...absent(sourcePath),
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o700, uid: 0, gid: 0
    })
  })
  const events = []
  const persisted = []
  let selectedCreated = false
  let selectedCopyCalls = 0
  let sourceRemoved = false
  const stop = new Error('stop after displacement')

  await assert.rejects(restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async (source, target, options) => {
        events.push(['copy', target, options.expectedTarget])
        assert.notEqual(target, occupiedPath)
        if (target === selectedPath) {
          selectedCopyCalls += 1
          if (selectedCopyCalls > 1) throw new Error('displacement copied twice')
          selectedCreated = true
          return undefined
        }
        if (target === sourcePath) throw stop
        throw new Error(`unexpected copy ${source} ${target}`)
      },
      removeEntry: async path => {
        assert.equal(path, sourcePath)
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-displacement-existing-collision',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: descriptor, backup
    }),
    generateDisplacementToken: () => tokens.shift(),
    describeEntry: async path => {
      if (path === sourcePath) return sourceRemoved ? sourceAbsent : descriptor
      if (path === occupiedPath) return foreign
      if (path === selectedPath) return selectedCreated ? displaced : absent(path)
      if (path === backupPath) return backup
      throw new Error(`unexpected describe ${path}`)
    },
    persistRecord: async value => {
      events.push(['persist', value.displacement?.status, value.displacement?.path])
      persisted.push(structuredClone(value))
      return value
    }
  }), error => error?.primaryCause === stop)

  assert.deepEqual(events.slice(0, 2), [
    ['persist', 'planned', selectedPath],
    ['copy', selectedPath, absent(selectedPath)]
  ])
  assert.equal(persisted[0].displacement.collisionHistory[0].path, occupiedPath)
  assert.deepEqual(persisted[0].displacement.collisionHistory[0].descriptor, foreign)
  assert.equal(selectedCopyCalls, 1)
})

test('root recovery replans when an absent displacement candidate races to occupied', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const base = '/root/.shellpilot-before-restore/app.conf-20260712-091011'
  const tokens = ['c'.repeat(24), 'd'.repeat(24)]
  const racedPath = `${base}-${tokens[0]}`
  const selectedPath = `${base}-${tokens[1]}`
  const descriptor = Object.freeze({
    type: 'file',
    device: '1',
    inode: '51',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'c'.repeat(64)
  })
  const backup = Object.freeze({ ...descriptor, inode: '52' })
  const foreign = Object.freeze({ ...descriptor, inode: '59' })
  const displaced = Object.freeze({ ...descriptor, inode: '53' })
  const absent = (entryPath, parentPath = '/root/.shellpilot-before-restore') => Object.freeze({
    type: 'bound-absent',
    path: entryPath,
    basename: entryPath.slice(entryPath.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath,
      device: '1',
      inode: parentPath === '/root' ? '10' : '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const events = []
  const persisted = []
  let raced = false
  let selectedCreated = false
  let sourceRemoved = false
  const stop = new Error('stop after raced displacement')

  await assert.rejects(restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async (_source, target, options) => {
        events.push(['copy', target, options.expectedTarget])
        if (target === racedPath) {
          raced = true
          const collision = new Error('target exists')
          collision.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
          collision.path = racedPath
          collision.expectedDescriptor = absent(racedPath)
          collision.actualDescriptor = foreign
          throw collision
        }
        if (target === selectedPath) {
          selectedCreated = true
          return displaced
        }
        if (target === sourcePath) throw stop
        throw new Error(`unexpected copy ${target}`)
      },
      removeEntry: async () => {
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-displacement-raced-collision',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: descriptor, backup
    }),
    generateDisplacementToken: () => tokens.shift(),
    describeEntry: async path => {
      if (path === sourcePath) return sourceRemoved ? absent(path, '/root') : descriptor
      if (path === racedPath) return raced ? foreign : absent(path)
      if (path === selectedPath) return selectedCreated ? displaced : absent(path)
      if (path === backupPath) return backup
      throw new Error(`unexpected describe ${path}`)
    },
    persistRecord: async value => {
      events.push(['persist', value.displacement?.status, value.displacement?.path])
      persisted.push(structuredClone(value))
      return value
    }
  }), error => error?.primaryCause === stop)

  assert.deepEqual(events.slice(0, 4).map(event => event.slice(0, 3)), [
    ['persist', 'planned', racedPath],
    ['copy', racedPath, absent(racedPath)],
    ['persist', 'planned', selectedPath],
    ['copy', selectedPath, absent(selectedPath)]
  ])
  assert.equal(persisted[1].displacement.collisionHistory[0].path, racedPath)
  assert.deepEqual(persisted[1].displacement.collisionHistory[0].descriptor, foreign)
})

test('root recovery fails closed after sixteen occupied displacement candidates', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const descriptor = Object.freeze({
    type: 'file',
    device: '1',
    inode: '61',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'e'.repeat(64)
  })
  const backup = Object.freeze({ ...descriptor, inode: '62' })
  const foreign = Object.freeze({ ...descriptor, inode: '69' })
  const tokens = Array.from({ length: 16 }, (_, index) =>
    index.toString(16).padStart(24, '0'))
  const persisted = []
  let copyCalls = 0
  let removeCalls = 0

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => { copyCalls += 1 },
      removeEntry: async () => { removeCalls += 1 }
    },
    record: {
      id: 'root-displacement-collision-exhausted',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: descriptor, backup
    }),
    generateDisplacementToken: () => tokens.shift(),
    describeEntry: async path => path === sourcePath ? descriptor : foreign,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_COLLISION')
  assert.equal(copyCalls, 0)
  assert.equal(removeCalls, 0)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).displacementPlanning.status, 'collision-exhausted')
  assert.equal(persisted.at(-1).displacementPlanning.collisionHistory.length, 16)
  assert.deepEqual(error.recoveryRecord, persisted.at(-1))
})

test('root recovery persists a displaced target replacement before source removal', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const foreign = Object.freeze({
    ...original,
    inode: '99',
    sha256: 'f'.repeat(64)
  })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: `app.conf-20260712-091011-${fixedDisplacementToken}`,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const proofFailure = Object.assign(new Error('displaced target raced'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: displacedPath,
    expectedDescriptor: displacedAbsent,
    actualDescriptor: foreign
  })
  const persisted = []
  let removeCalls = 0

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => { throw proofFailure },
      removeEntry: async () => { removeCalls += 1 }
    },
    record: {
      id: 'root-displaced-target-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => path === displacedPath
      ? displacedAbsent
      : path === sourcePath ? original : backup,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, proofFailure)
  assert.equal(removeCalls, 0)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.deepEqual(persisted.at(-1).proofMismatch, {
    path: displacedPath,
    expectedDescriptor: displacedAbsent,
    actualDescriptor: foreign
  })
})

test('root recovery does not remove the source after the displaced copy is replaced', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const copied = Object.freeze({ ...original, inode: '43' })
  const foreign = Object.freeze({
    ...copied,
    sha256: 'f'.repeat(64)
  })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: `app.conf-20260712-091011-${fixedDisplacementToken}`,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const persisted = []
  let removeCalls = 0
  let displacedReads = 0

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => copied,
      removeEntry: async () => { removeCalls += 1 }
    },
    record: {
      id: 'root-displaced-post-copy-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) {
        displacedReads += 1
        return displacedReads === 1 ? displacedAbsent : foreign
      }
      return path === sourcePath ? original : backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(removeCalls, 0)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.deepEqual(persisted.at(-1).proofMismatch, {
    path: displacedPath,
    expectedDescriptor: copied,
    actualDescriptor: foreign
  })
})

test('root recovery stops before install if the displaced copy changes during exact remove', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const copied = Object.freeze({ ...original, inode: '43' })
  const foreign = Object.freeze({ ...copied, sha256: 'f'.repeat(64) })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: `app.conf-20260712-091011-${fixedDisplacementToken}`,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const sourceAbsent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o700, uid: 0, gid: 0
    })
  })
  let displacedReads = 0
  let sourceRemoved = false
  let installCalls = 0
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async source => {
        if (source === backupPath) installCalls += 1
        return copied
      },
      removeEntry: async path => {
        assert.equal(path, sourcePath)
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-displaced-remove-window-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) {
        displacedReads += 1
        if (displacedReads === 1) return displacedAbsent
        if (displacedReads === 2) return copied
        return foreign
      }
      if (path === sourcePath) return sourceRemoved ? sourceAbsent : original
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(installCalls, 0)
  assert.equal(persisted.at(-1).displacement.status, 'uncertain')
  assert.deepEqual(persisted.at(-1).proofMismatch.actualDescriptor, foreign)
})

test('root recovery persists duplicated uncertainty when exact source removal fails', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const changedSource = Object.freeze({
    ...original,
    sha256: 'b'.repeat(64)
  })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: `app.conf-20260712-091011-${fixedDisplacementToken}`,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  let copied = false
  const persisted = []
  const removeFailure = Object.assign(new Error('source proof changed'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    expectedDescriptor: original,
    actualDescriptor: changedSource
  })

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => { copied = true },
      removeEntry: async () => { throw removeFailure }
    },
    record: {
      id: 'root-duplicated',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) return copied ? displaced : displacedAbsent
      if (path === sourcePath) return changedSource
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, removeFailure)
  assert.deepEqual(error.sourceDescriptor, changedSource)
  assert.deepEqual(error.displacedDescriptor, displaced)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).rollbackStatus, 'uncertain')
  assert.equal(persisted.at(-1).displacement.status, 'duplicated')
  assert.deepEqual(
    persisted.at(-1).displacement.sourceDescriptor,
    changedSource
  )
  assert.deepEqual(persisted.at(-1).displacement.descriptor, displaced)
})

test('root recovery records an unavailable observation instead of stale expected evidence', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: `app.conf-20260712-091011-${fixedDisplacementToken}`,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const observeFailure = Object.assign(new Error('cannot observe source'), {
    code: 'EACCES'
  })
  const persisted = []
  let copied = false

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => {
        copied = true
        return displaced
      },
      removeEntry: async () => { throw new Error('remove failed') }
    },
    record: {
      id: 'root-observation-failed',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) return copied ? displaced : displacedAbsent
      if (path === sourcePath) throw observeFailure
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(persisted.at(-1).displacement.sourceDescriptor, null)
  assert.deepEqual(
    persisted.at(-1).displacement.sourceObservationFailure,
    {
      path: sourcePath,
      code: 'EACCES',
      message: 'cannot observe source'
    }
  )
})

test('root recovery persists copy-completed uncertainty when post-copy observation fails', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const now = new Date('2026-07-12T09:10:11Z')
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath =
    `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const copied = Object.freeze({ ...original, inode: '43' })
  const displacedAbsent = Object.freeze({
    type: 'bound-absent',
    path: displacedPath,
    basename: displacedPath.slice(displacedPath.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root/.shellpilot-before-restore',
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const observationFailure = Object.assign(
    new Error('post-copy observation disconnected'),
    { code: 'ECONNRESET' }
  )
  const persisted = []
  let copyCompleted = false
  let removes = 0
  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => {
        copyCompleted = true
        return copied
      },
      removeEntry: async () => { removes += 1 }
    },
    record: {
      id: 'root-post-copy-observation',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now,
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async (path, options) => {
      if (path === sourcePath) return original
      if (path === displacedPath && options?.allowAbsent && !copyCompleted) {
        return displacedAbsent
      }
      if (path === displacedPath && copyCompleted) throw observationFailure
      return backup
    },
    persistRecord: async value => {
      const stored = { ...value, persistedRevision: persisted.length + 1 }
      persisted.push(structuredClone(stored))
      return stored
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, observationFailure)
  assert.equal(error.recoveryRecord.status, 'uncertain')
  assert.equal(error.recoveryRecord.displacement.status, 'duplicated')
  assert.equal(error.recoveryRecord.displacement.copyCompleted, true)
  assert.equal(error.recoveryRecord.displacement.sourceExactRemoved, false)
  assert.deepEqual(error.recoveryRecord.displacement.sourceDescriptor, original)
  assert.deepEqual(error.recoveryRecord.displacement.descriptor, copied)
  assert.deepEqual(error.recoveryRecord.displacement.observationFailure, {
    phase: 'post-copy-describe',
    code: 'ECONNRESET',
    message: 'post-copy observation disconnected'
  })
  assert.deepEqual(error.recoveryRecord, persisted.at(-1))
  assert.equal(removes, 0)
  assert.doesNotThrow(() => JSON.stringify(error.recoveryRecord))
})

test('root recovery persists exact-remove facts when peer observation fails', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const now = new Date('2026-07-12T09:10:11Z')
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath =
    `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const absent = path => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: path.slice(0, path.lastIndexOf('/')),
      device: '1',
      inode: '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const observationFailure = Object.assign(
    new Error('post-remove peer observation disconnected'),
    { code: 'ECONNRESET' }
  )
  let copied = false
  let sourceRemoved = false
  const persisted = []
  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async () => {
        copied = true
        return displaced
      },
      removeEntry: async path => {
        assert.equal(path, sourcePath)
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-post-remove-observation',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now,
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async (path, options) => {
      if (path === sourcePath) return sourceRemoved ? absent(sourcePath) : original
      if (path === displacedPath && options?.allowAbsent && !copied) {
        return absent(displacedPath)
      }
      if (path === displacedPath && copied && sourceRemoved) {
        throw observationFailure
      }
      if (path === displacedPath) return displaced
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, observationFailure)
  assert.equal(error.recoveryRecord.status, 'uncertain')
  assert.equal(error.recoveryRecord.displacement.status, 'displaced')
  assert.equal(error.recoveryRecord.displacement.copyCompleted, true)
  assert.equal(error.recoveryRecord.displacement.sourceExactRemoved, true)
  assert.deepEqual(error.recoveryRecord.displacement.sourceDescriptor, original)
  assert.deepEqual(error.recoveryRecord.displacement.descriptor, displaced)
  assert.deepEqual(error.recoveryRecord.displacement.observationFailure, {
    phase: 'post-exact-remove-peer-describe',
    code: 'ECONNRESET',
    message: 'post-remove peer observation disconnected'
  })
  assert.deepEqual(error.recoveryRecord, persisted.at(-1))
  assert.doesNotThrow(() => JSON.stringify(error.recoveryRecord))

  const retryCalls = []
  const retry = await restoreSftpRecoveryRecord({
    sftp: {
      copyEntry: async (source, target, options) => {
        retryCalls.push([source, target, options])
        return { ...backup, inode: '44' }
      },
      removeEntry: async () => { throw new Error('retry must not redisplace') }
    },
    record: error.recoveryRecord,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: absent(sourcePath),
      backup,
      displaced
    }),
    describeEntry: async path => path === sourcePath
      ? absent(sourcePath)
      : displaced,
    persistRecord: async value => value
  })
  assert.equal(retry.status, 'restored')
  assert.equal(retryCalls.length, 1)
  assert.equal(retryCalls[0][0], backupPath)
  assert.equal(retryCalls[0][1], sourcePath)
})

test('root recovery retry preserves both sides of a duplicated displacement and converges', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const oldDisplacedPath = '/root/.shellpilot-before-restore/app.conf-old-copy'
  const newDisplacedPath = `/root/.shellpilot-before-restore/app.conf-20260713-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const changed = Object.freeze({
    ...original, sha256: 'b'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const newDisplaced = Object.freeze({ ...changed, inode: '44' })
  const absentAt = path => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: path.slice(0, path.lastIndexOf('/')) || '/',
      device: '1',
      inode: path === sourcePath ? '10' : '11',
      mode: 0o700,
      uid: 0,
      gid: 0
    })
  })
  const newAbsent = absentAt(newDisplacedPath)
  const sourceAbsent = absentAt(sourcePath)
  const calls = []
  let copied = false
  let removed = false
  const persisted = []
  const record = {
    id: 'root-duplicated-retry',
    kind: 'backup',
    sourcePath,
    backupPath,
    status: 'uncertain',
    rollbackStatus: 'uncertain',
    displacement: {
      path: oldDisplacedPath,
      descriptor: original,
      sourceDescriptor: changed,
      status: 'duplicated'
    }
  }

  const result = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async (source, target, options) => {
        calls.push(['copyEntry', source, target, options])
        if (target === newDisplacedPath) copied = true
        return 1
      },
      removeEntry: async (path, options) => {
        calls.push(['removeEntry', path, options])
        removed = true
        return 1
      }
    },
    record,
    now: new Date('2026-07-13T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: changed, backup, displaced: original
    }),
    describeEntry: async path => {
      if (path === oldDisplacedPath) return original
      if (path === newDisplacedPath) return copied ? newDisplaced : newAbsent
      if (path === sourcePath) return removed ? sourceAbsent : changed
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  })

  assert.equal(result.status, 'restored')
  assert.equal(result.displacement.path, newDisplacedPath)
  assert.equal(result.displacement.status, 'preserved')
  assert.equal(result.retainedDisplacements.length, 1)
  assert.equal(result.retainedDisplacements[0].path, oldDisplacedPath)
  assert.equal(result.retainedDisplacements[0].status, 'preserved-duplicate')
  assert.equal(calls.some(call => call[1] === oldDisplacedPath), false)
  assert.deepEqual(calls[0], [
    'copyEntry', sourcePath, newDisplacedPath,
    { expectedSource: changed, expectedTarget: newAbsent }
  ])
  assert.deepEqual(calls[1], [
    'removeEntry', sourcePath, {
      expectedSource: changed,
      expectedPeer: { path: newDisplacedPath, descriptor: newDisplaced }
    }
  ])
  assert.deepEqual(persisted[0].retainedDisplacements[0].descriptor, original)
})

test('root recovery fails closed on an uncommitted planned displacement without path-only stat', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = '/root/.shellpilot-before-restore/app.conf-copy'
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o755, uid: 1000, gid: 1000
    })
  })
  const calls = []
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => { throw new Error('path-only stat forbidden') },
      copyEntry: async (source, target, options) => {
        calls.push(['copyEntry', source, target, options])
        return 1
      },
      removeEntry: async () => { throw new Error('unexpected remove') }
    },
    record: {
      id: 'root-planned-retry',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'uncertain',
      displacement: {
        path: displacedPath,
        descriptor: original,
        targetState: Object.freeze({
          type: 'bound-absent',
          path: displacedPath,
          basename: 'app.conf-copy',
          mustBeAbsent: true,
          parent: Object.freeze({
            path: '/root/.shellpilot-before-restore',
            device: '1',
            inode: '11',
            mode: 0o700,
            uid: 0,
            gid: 0
          })
        }),
        status: 'planned'
      }
    },
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: absent, backup, displaced
    }),
    describeEntry: async path => {
      if (path === displacedPath) return displaced
      if (path === backupPath) return backup
      return absent
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause.code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.deepEqual(persisted.at(-1).proofMismatch.actualDescriptor, displaced)
  assert.deepEqual(calls, [])
})

test('root recovery persists exact descriptors when backup proof changes during install', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const backup = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const changedBackup = Object.freeze({
    ...backup,
    sha256: 'b'.repeat(64)
  })
  const absent = Object.freeze({
    type: 'bound-absent',
    path: sourcePath,
    basename: 'app.conf',
    mustBeAbsent: true,
    parent: Object.freeze({
      path: '/root', device: '1', inode: '10', mode: 0o700, uid: 0, gid: 0
    })
  })
  const proofFailure = Object.assign(new Error('backup proof changed'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: backupPath,
    expectedDescriptor: backup,
    actualDescriptor: changedBackup
  })
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      copyEntry: async () => { throw proofFailure },
      removeEntry: async () => { throw new Error('unexpected remove') }
    },
    record: {
      id: 'root-backup-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: absent, backup
    }),
    describeEntry: async path => path === backupPath ? changedBackup : absent,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, proofFailure)
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].status, 'uncertain')
  assert.equal(persisted[0].rollbackStatus, 'uncertain')
  assert.deepEqual(persisted[0].proofMismatch, {
    path: backupPath,
    expectedDescriptor: backup,
    actualDescriptor: changedBackup
  })
})

test('root recovery keeps a raced creator and records proof-bound compensation failure', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const foreign = Object.freeze({
    ...original,
    inode: '99',
    sha256: 'f'.repeat(64)
  })
  const absentAt = (path, basename, parentPath, inode) => Object.freeze({
    type: 'bound-absent',
    path,
    basename,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath, device: '1', inode, mode: 0o700, uid: 0, gid: 0
    })
  })
  const displacedAbsent = absentAt(
    displacedPath,
    `app.conf-20260712-091011-${fixedDisplacementToken}`,
    '/root/.shellpilot-before-restore',
    '11'
  )
  const sourceAbsent = absentAt(sourcePath, 'app.conf', '/root', '10')
  const primaryCause = Object.assign(new Error('restore target raced'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: sourcePath,
    expectedDescriptor: sourceAbsent,
    actualDescriptor: foreign
  })
  const rollbackCause = Object.assign(new Error('compensation target raced'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: sourcePath,
    expectedDescriptor: sourceAbsent,
    actualDescriptor: foreign
  })
  const copyCalls = []
  let displacedCreated = false
  let sourceRemoved = false
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      rename: async () => { throw new Error('path-only rename forbidden') },
      cp: async () => { throw new Error('path-only cp forbidden') },
      copyEntry: async (source, target, options) => {
        copyCalls.push([source, target, options])
        if (source === sourcePath) {
          displacedCreated = true
          return 1
        }
        if (source === backupPath) throw primaryCause
        throw rollbackCause
      },
      removeEntry: async path => {
        assert.equal(path, sourcePath)
        sourceRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-target-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) return displacedCreated ? displaced : displacedAbsent
      if (path === sourcePath) return sourceRemoved ? sourceAbsent : original
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, primaryCause)
  assert.equal(error.rollbackCause, rollbackCause)
  assert.equal(copyCalls.length, 3)
  assert.deepEqual(copyCalls[2], [
    displacedPath,
    sourcePath,
    { expectedSource: displaced, expectedTarget: sourceAbsent }
  ])
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).displacement.status, 'uncertain')
  assert.deepEqual(persisted.at(-1).proofMismatch.actualDescriptor, foreign)
})

test('root recovery records both sides when compensation copy exact-remove fails', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const restoredSource = Object.freeze({ ...original, inode: '44' })
  const changedDisplaced = Object.freeze({
    ...displaced,
    sha256: 'b'.repeat(64)
  })
  const absentAt = (path, parentPath, inode) => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath, device: '1', inode, mode: 0o700, uid: 0, gid: 0
    })
  })
  const displacedAbsent = absentAt(
    displacedPath,
    '/root/.shellpilot-before-restore',
    '11'
  )
  const sourceAbsent = absentAt(sourcePath, '/root', '10')
  const primaryCause = new Error('backup install failed')
  const removeFailure = Object.assign(new Error('displaced proof changed'), {
    code: 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH',
    path: displacedPath,
    expectedDescriptor: displaced,
    actualDescriptor: changedDisplaced
  })
  let displacedCreated = false
  let sourceRemoved = false
  let compensationCopied = false
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async (source, target) => {
        if (source === sourcePath) displacedCreated = true
        else if (source === backupPath) throw primaryCause
        else if (source === displacedPath && target === sourcePath) {
          compensationCopied = true
        }
        return 1
      },
      removeEntry: async path => {
        if (path === sourcePath) {
          sourceRemoved = true
          return 1
        }
        throw removeFailure
      }
    },
    record: {
      id: 'root-compensation-duplicated',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) {
        if (!displacedCreated) return displacedAbsent
        return compensationCopied ? changedDisplaced : displaced
      }
      if (path === sourcePath) {
        if (compensationCopied) return restoredSource
        return sourceRemoved ? sourceAbsent : original
      }
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, primaryCause)
  assert.equal(error.rollbackCause, removeFailure)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).displacement.status, 'duplicated')
  assert.deepEqual(
    persisted.at(-1).displacement.sourceDescriptor,
    restoredSource
  )
  assert.deepEqual(
    persisted.at(-1).displacement.descriptor,
    changedDisplaced
  )
})

test('root recovery does not claim compensation if its target changes during exact remove', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const sourcePath = '/root/app.conf'
  const backupPath = '/root/.shellpilot-backups/app.conf-old'
  const displacedPath = `/root/.shellpilot-before-restore/app.conf-20260712-091011-${fixedDisplacementToken}`
  const original = Object.freeze({
    type: 'file',
    device: '1',
    inode: '41',
    size: 4,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const backup = Object.freeze({ ...original, inode: '42' })
  const displaced = Object.freeze({ ...original, inode: '43' })
  const restored = Object.freeze({ ...original, inode: '44' })
  const foreign = Object.freeze({ ...restored, sha256: 'f'.repeat(64) })
  const absentAt = (path, parentPath, inode) => Object.freeze({
    type: 'bound-absent',
    path,
    basename: path.slice(path.lastIndexOf('/') + 1),
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath, device: '1', inode, mode: 0o700, uid: 0, gid: 0
    })
  })
  const displacedAbsent = absentAt(
    displacedPath,
    '/root/.shellpilot-before-restore',
    '11'
  )
  const sourceAbsent = absentAt(sourcePath, '/root', '10')
  const primaryCause = new Error('backup install failed')
  let displacedCreated = false
  let sourceRemoved = false
  let compensationCopied = false
  let displacedRemoved = false
  let compensationSourceReads = 0
  const persisted = []

  const error = await restoreSftpRecoveryRecord({
    sftp: {
      mkdir: async () => {},
      copyEntry: async source => {
        if (source === sourcePath) {
          displacedCreated = true
          return displaced
        }
        if (source === backupPath) throw primaryCause
        compensationCopied = true
        return restored
      },
      removeEntry: async path => {
        if (path === sourcePath) sourceRemoved = true
        else displacedRemoved = true
        return 1
      }
    },
    record: {
      id: 'root-compensation-remove-window-race',
      kind: 'backup',
      sourcePath,
      backupPath,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z'),
    generateDisplacementToken: () => fixedDisplacementToken,
    recoveryProof: rootRecoveryProof('backup', sourcePath, backupPath, {
      source: original, backup
    }),
    describeEntry: async path => {
      if (path === displacedPath) {
        return displacedRemoved
          ? displacedAbsent
          : displacedCreated ? displaced : displacedAbsent
      }
      if (path === sourcePath) {
        if (compensationCopied) {
          compensationSourceReads += 1
          return compensationSourceReads === 1 ? restored : foreign
        }
        return sourceRemoved ? sourceAbsent : original
      }
      return backup
    },
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, primaryCause)
  assert.equal(persisted.at(-1).displacement.status, 'uncertain')
  assert.deepEqual(persisted.at(-1).displacement.sourceDescriptor, foreign)
  assert.deepEqual(persisted.at(-1).displacement.descriptor, displacedAbsent)
  assert.deepEqual(persisted.at(-1).proofMismatch.actualDescriptor, foreign)
})

test('SFTP restore persists displacement before moving current content and exposes double-failure uncertainty', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const persisted = []
  const displacedPath = '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011'
  const descriptor = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 7,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const primaryCause = new Error('primary restore failed')
  const rollbackCause = new Error('compensation failed')
  const sftp = {
    stat: async () => ({ isDirectory: false }),
    mkdir: async () => {},
    rename: async (from, to) => {
      if (from === displacedPath && to === '/etc/nginx/nginx.conf') {
        throw rollbackCause
      }
    },
    cp: async () => { throw primaryCause }
  }
  const record = {
    id: 'r-uncertain',
    kind: 'backup',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910',
    status: 'available'
  }

  const error = await restoreSftpRecoveryRecord({
    sftp,
    record,
    now: new Date('2026-07-12T09:10:11Z'),
    describeEntry: async () => descriptor,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, primaryCause)
  assert.equal(error.rollbackCause, rollbackCause)
  assert.equal(error.displacedPath, displacedPath)
  assert.deepEqual(error.displacedDescriptor, descriptor)
  assert.deepEqual(persisted.map(value => value.displacement?.status), [
    'planned',
    'displaced',
    'uncertain'
  ])
  assert.equal(persisted[0].displacement.path, displacedPath)
  assert.deepEqual(persisted[0].displacement.descriptor, descriptor)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).rollbackStatus, 'uncertain')
})

test('SFTP restore retry reuses a persisted displacement instead of moving current content again', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const displacedPath = '/etc/nginx/.shellpilot-before-restore/nginx.conf-existing'
  const record = {
    id: 'r-retry',
    kind: 'backup',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-old',
    status: 'uncertain',
    displacement: {
      path: displacedPath,
      descriptor: { type: 'file', inode: '42' },
      status: 'displaced'
    }
  }
  const result = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => ({ isDirectory: false }),
      mkdir: async value => calls.push(['mkdir', value]),
      rename: async (from, to) => calls.push(['rename', from, to]),
      cp: async (from, to) => calls.push(['cp', from, to])
    },
    record,
    persistRecord: async value => value
  })

  assert.deepEqual(calls, [[
    'cp',
    '/etc/nginx/.shellpilot-backups/nginx.conf-old',
    '/etc/nginx/nginx.conf'
  ]])
  assert.equal(result.status, 'restored')
  assert.equal(result.displacedPath, displacedPath)
})

test('successful restore compensation clears active displacement before a later retry', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const primaryCause = new Error('restore copy failed')
  const persisted = []
  const record = {
    id: 'r-compensated',
    kind: 'backup',
    sourcePath: '/etc/app.conf',
    backupPath: '/etc/.shellpilot-backups/app.conf-old',
    status: 'available'
  }
  const error = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => ({ mode: 0o600, uid: 0, gid: 0, size: 4 }),
      mkdir: async () => {},
      rename: async () => {},
      cp: async () => { throw primaryCause }
    },
    record,
    describeEntry: async () => ({ type: 'file', inode: '42' }),
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error, primaryCause)
  assert.equal(persisted.at(-1).status, 'failed')
  assert.equal(persisted.at(-1).displacement, null)
  assert.equal(persisted.at(-1).lastDisplacement.status, 'compensated')
})

test('SFTP permission recovery restores the previous mode directly', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    chmod: async (target, mode) => calls.push(['chmod', target, mode])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'chmod-1',
      kind: 'chmod',
      sourcePath: '/srv/app/config.yml',
      previousMode: 420,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [['chmod', '/srv/app/config.yml', 420]])
  assert.equal(result.status, 'restored')
})

test('SFTP rename recovery moves the renamed entry back to its original path', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    stat: async target => {
      if (target.endsWith('/old.conf')) throw new Error('No such file')
      return { isDirectory: false }
    },
    rename: async (from, to) => calls.push(['rename', from, to])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'rename-1',
      kind: 'rename',
      sourcePath: '/etc/app/old.conf',
      backupPath: '/etc/app/new.conf',
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [['rename', '/etc/app/new.conf', '/etc/app/old.conf']])
  assert.equal(result.status, 'restored')
})

test('SFTP safety UI exposes backup, recovery center, and safe-delete wiring', () => {
  const itemSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-file-context-menu.js'),
    'utf8'
  )
  const entrySource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-entry.jsx'),
    'utf8'
  )
  const mcpSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/mcp-handler.js'),
    'utf8'
  )

  assert.match(itemSource, /quickBackup/)
  assert.match(itemSource, /shellpilotSftpRestoreLatestBackup/)
  assert.match(itemSource, /shellpilotSftpQuickBackup/)
  assert.match(entrySource, /runSftpSafetyOperation/)
  assert.match(entrySource, /buildSideEffectSafetyRequest/)
  assert.match(entrySource, /createSftpTransactionAdapter/)
  assert.match(entrySource, /shellpilotSftpSafetyCenter/)
  assert.match(entrySource, /shellpilotSftpQuickBackup/)
  assert.doesNotMatch(entrySource, /delFiles[\s\S]{0,900}remoteDel\(f\)/)
  assert.match(mcpSource, /sftpEntry\.delFiles/)
  assert.doesNotMatch(mcpSource, /mcpSftpDel[\s\S]{0,700}sftp\.(rm|rmdir)\(/)
})
