const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

process.env.NODE_ENV = 'development'

const {
  forwardRemoteToLocal
} = require('../../src/app/server/ssh-tunnel')

function createSocket () {
  const socket = new EventEmitter()
  socket.destroy = () => {
    if (socket.destroyed) return
    socket.destroyed = true
    socket.emit('close')
  }
  socket.end = () => {}
  socket.pipe = () => socket
  return socket
}

function createConnection () {
  const conn = new EventEmitter()
  conn.forwardIn = (host, port, callback) => callback()
  conn.unforwardIn = (host, port, callback) => callback()
  return conn
}

async function createRemoteController ({
  id,
  conn,
  remoteHost,
  remotePort,
  localPort
}) {
  const targets = []
  const evidence = []
  const controller = await forwardRemoteToLocal({
    id,
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: localPort,
    sshTunnelRemoteHost: remoteHost,
    sshTunnelRemotePort: remotePort,
    netImpl: {
      connect: (port, host) => {
        targets.push({ port, host, socket: createSocket() })
        return targets.at(-1).socket
      }
    }
  })
  controller.on('evidence', value => evidence.push(value))
  return { controller, evidence, targets }
}

test('remote inbound traffic routes by the complete bind tuple on one SSH connection', async () => {
  const conn = createConnection()
  const first = await createRemoteController({
    id: 'remote-first',
    conn,
    remoteHost: '127.0.0.1',
    remotePort: 45100,
    localPort: 45101
  })
  const second = await createRemoteController({
    id: 'remote-second',
    conn,
    remoteHost: '127.0.0.2',
    remotePort: 45100,
    localPort: 45102
  })
  let acceptCount = 0

  try {
    conn.emit('tcp connection', {
      destIP: '127.0.0.2',
      destPort: 45100
    }, () => {
      acceptCount += 1
      return createSocket()
    })

    assert.equal(acceptCount, 1)
    assert.equal(first.targets.length, 0)
    assert.deepEqual(
      second.targets.map(({ host, port }) => ({ host, port })),
      [{ host: '127.0.0.1', port: 45102 }]
    )

    second.targets[0].socket.emit('connect')
    assert.equal(first.evidence.length, 0)
    assert.equal(second.evidence.length, 1)
    assert.equal(second.evidence[0].verdict, 'passed')
  } finally {
    await Promise.all([
      first.controller.close(),
      second.controller.close()
    ])
  }
})

test('remote bind matching normalizes IP literals without guessing hostname semantics', async () => {
  const conn = createConnection()
  const ipv4Loopback = await createRemoteController({
    id: 'remote-ipv4-loopback',
    conn,
    remoteHost: '127.0.0.1',
    remotePort: 45200,
    localPort: 45201
  })
  const ipv6Loopback = await createRemoteController({
    id: 'remote-ipv6-loopback',
    conn,
    remoteHost: '[0:0:0:0:0:0:0:1]',
    remotePort: 45200,
    localPort: 45202
  })
  const ipv4Wildcard = await createRemoteController({
    id: 'remote-ipv4-wildcard',
    conn,
    remoteHost: '0.0.0.0',
    remotePort: 45210,
    localPort: 45211
  })
  const ipv6Wildcard = await createRemoteController({
    id: 'remote-ipv6-wildcard',
    conn,
    remoteHost: '[0:0:0:0:0:0:0:0]',
    remotePort: 45210,
    localPort: 45212
  })
  const hostname = await createRemoteController({
    id: 'remote-hostname',
    conn,
    remoteHost: 'Bind.Example.test',
    remotePort: 45220,
    localPort: 45221
  })
  const otherHostname = await createRemoteController({
    id: 'remote-other-hostname',
    conn,
    remoteHost: 'Other.Example.test',
    remotePort: 45220,
    localPort: 45222
  })
  const controllers = [
    ipv4Loopback,
    ipv6Loopback,
    ipv4Wildcard,
    ipv6Wildcard,
    hostname,
    otherHostname
  ]

  try {
    let acceptCount = 0
    conn.emit('tcp connection', {
      destIP: '::1',
      destPort: 45200
    }, () => {
      acceptCount += 1
      return createSocket()
    })
    assert.equal(acceptCount, 1)
    assert.equal(ipv4Loopback.targets.length, 0)
    assert.equal(ipv6Loopback.targets.length, 1)

    conn.emit('tcp connection', {
      destIP: '::',
      destPort: 45210
    }, () => {
      acceptCount += 1
      return createSocket()
    })
    assert.equal(acceptCount, 2)
    assert.equal(ipv4Wildcard.targets.length, 0)
    assert.equal(ipv6Wildcard.targets.length, 1)

    conn.emit('tcp connection', {
      destIP: 'bind.example.test',
      destPort: 45220
    }, () => {
      acceptCount += 1
      return createSocket()
    })
    assert.equal(acceptCount, 2)
    assert.equal(hostname.targets.length, 0)
    assert.equal(otherHostname.targets.length, 0)

    conn.emit('tcp connection', {
      destIP: 'Bind.Example.test',
      destPort: 45220
    }, () => {
      acceptCount += 1
      return createSocket()
    })
    assert.equal(acceptCount, 3)
    assert.equal(hostname.targets.length, 1)
    assert.equal(otherHostname.targets.length, 0)
  } finally {
    await Promise.all(controllers.map(({ controller }) => controller.close()))
  }
})

test('specific remote binds outrank wildcard routes for the same port', async () => {
  const conn = createConnection()
  const specific = await createRemoteController({
    id: 'remote-specific',
    conn,
    remoteHost: '127.0.0.1',
    remotePort: 45300,
    localPort: 45301
  })
  const wildcard = await createRemoteController({
    id: 'remote-wildcard',
    conn,
    remoteHost: '0.0.0.0',
    remotePort: 45300,
    localPort: 45302
  })
  let acceptCount = 0
  const accept = () => {
    acceptCount += 1
    return createSocket()
  }

  try {
    conn.emit('tcp connection', {
      destIP: '127.0.0.1',
      destPort: 45300
    }, accept)
    assert.equal(acceptCount, 1)
    assert.equal(specific.targets.length, 1)
    assert.equal(wildcard.targets.length, 0)
    specific.targets[0].socket.emit('connect')
    assert.equal(specific.evidence.length, 1)
    assert.equal(wildcard.evidence.length, 0)

    conn.emit('tcp connection', {
      destIP: '192.0.2.30',
      destPort: 45300
    }, accept)
    assert.equal(acceptCount, 2)
    assert.equal(specific.targets.length, 1)
    assert.equal(wildcard.targets.length, 1)
    wildcard.targets[0].socket.emit('connect')
    assert.equal(specific.evidence.length, 1)
    assert.equal(wildcard.evidence.length, 1)
  } finally {
    await Promise.all([
      specific.controller.close(),
      wildcard.controller.close()
    ])
  }
})

test('a sole remote route accepts a server-rewritten connected address', async () => {
  const conn = createConnection()
  const route = await createRemoteController({
    id: 'remote-rewritten',
    conn,
    remoteHost: '127.0.0.1',
    remotePort: 45310,
    localPort: 45311
  })
  let acceptCount = 0

  try {
    conn.emit('tcp connection', {
      destIP: '192.0.2.31',
      destPort: 45310
    }, () => {
      acceptCount += 1
      return createSocket()
    })
    assert.equal(acceptCount, 1)
    assert.equal(route.targets.length, 1)
    route.targets[0].socket.emit('connect')
    assert.equal(route.evidence.length, 1)
  } finally {
    await route.controller.close()
  }
})

test('ambiguous remote routes reject an inbound address with no unique match', async () => {
  const conn = createConnection()
  const first = await createRemoteController({
    id: 'remote-ambiguous-first',
    conn,
    remoteHost: '127.0.0.1',
    remotePort: 45320,
    localPort: 45321
  })
  const second = await createRemoteController({
    id: 'remote-ambiguous-second',
    conn,
    remoteHost: '127.0.0.2',
    remotePort: 45320,
    localPort: 45322
  })
  let acceptCount = 0
  let rejectCount = 0

  try {
    conn.emit('tcp connection', {
      destIP: '192.0.2.32',
      destPort: 45320
    }, () => {
      acceptCount += 1
      return createSocket()
    }, () => {
      rejectCount += 1
    })
    assert.equal(acceptCount, 0)
    assert.equal(rejectCount, 1)
    assert.equal(first.targets.length, 0)
    assert.equal(second.targets.length, 0)
    assert.equal(first.evidence.length, 0)
    assert.equal(second.evidence.length, 0)
  } finally {
    await Promise.all([
      first.controller.close(),
      second.controller.close()
    ])
  }
})
