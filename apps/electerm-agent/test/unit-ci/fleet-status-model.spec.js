const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modelUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/fleet-status/fleet-status-model.js')
).href

async function loadModel () {
  return import(modelUrl)
}

test('exports the deeply immutable empty fleet snapshot', async () => {
  const { emptyFleetSnapshot } = await loadModel()

  assert.deepEqual(emptyFleetSnapshot, {
    connection: { status: 'pending', latencyMs: null, error: '' },
    resources: {
      cpu: null,
      memory: null,
      disk: null,
      load: null,
      uptime: ''
    },
    services: [],
    network: { interfaces: [], defaultRoute: null, dns: [] },
    firewall: { provider: '', enabled: null },
    collectedAt: '',
    overallStatus: 'pending'
  })
  assert.equal(Object.isFrozen(emptyFleetSnapshot), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.connection), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.resources), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.services), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.network.interfaces), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.network.dns), true)
  assert.equal(Object.isFrozen(emptyFleetSnapshot.firewall), true)
})

test('normalizes a healthy fleet snapshot without trusting supplied overall status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected', latencyMs: '18' },
    resources: {
      cpu: 24,
      memory: { usedPercent: 61 },
      disk: { usedPercent: 72 },
      load: 0.45,
      uptime: '3 days'
    },
    services: [{ name: 'sshd.service', state: 'running' }],
    network: {
      interfaces: [{ name: 'eth0', addresses: ['10.0.0.8/24'] }],
      defaultRoute: '10.0.0.1',
      dns: ['1.1.1.1']
    },
    firewall: { provider: 'nftables', enabled: true },
    collectedAt: '2026-07-15T08:00:00.000Z',
    overallStatus: 'critical'
  })

  assert.equal(snapshot.connection.latencyMs, 18)
  assert.equal(snapshot.connection.error, '')
  assert.equal(snapshot.collectedAt, '2026-07-15T08:00:00.000Z')
  assert.equal(snapshot.overallStatus, 'healthy')
})

test('resource thresholds produce a warning', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: { cpu: 80 }
  })

  assert.equal(snapshot.overallStatus, 'warning')
})

test('critical resources and failed services produce a critical status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: { disk: { usedPercent: 95 } },
    services: [
      { name: 'sshd.service', state: 'running' },
      { name: 'database.service', activeState: 'failed' }
    ]
  })

  assert.equal(snapshot.overallStatus, 'critical')
})

test('a failed connection takes offline precedence over probe health', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: {
      status: 'failed',
      error: new Error('connect ETIMEDOUT to root:server-secret@example.test')
    },
    resources: { cpu: 95 }
  })

  assert.equal(snapshot.connection.error, 'timeout')
  assert.equal(snapshot.overallStatus, 'offline')
  assert.equal(JSON.stringify(snapshot).includes('server-secret'), false)
})

for (const [category, error] of [
  ['auth', 'All configured authentication methods failed'],
  ['timeout', { code: 'ETIMEDOUT', message: 'connection timed out' }],
  ['host-key', new Error('Host key verification failed')]
]) {
  test(`a connected snapshot with ${category} error remains offline`, async () => {
    const { createFleetStatusSnapshot } = await loadModel()
    const snapshot = createFleetStatusSnapshot({
      connection: { status: 'connected', error },
      resources: { cpu: 20 }
    })

    assert.equal(snapshot.connection.error, category)
    assert.equal(snapshot.overallStatus, 'offline')
  })
}

test('cancelled collection has a cancelled overall status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const error = new Error('request aborted with bearer secret-token')
  error.name = 'AbortError'
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'failed', error }
  })

  assert.equal(snapshot.connection.error, 'cancelled')
  assert.equal(snapshot.overallStatus, 'cancelled')
})

test('permission errors have a permission overall status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'failed', error: { code: 'EACCES' } }
  })

  assert.equal(snapshot.connection.error, 'permission')
  assert.equal(snapshot.overallStatus, 'permission')
})

test('unsupported targets have an unsupported overall status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'unsupported', error: 'platform is not supported' }
  })

  assert.equal(snapshot.connection.error, 'unsupported')
  assert.equal(snapshot.overallStatus, 'unsupported')
})

test('empty or unfinished probes never produce healthy status', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assert.equal(createFleetStatusSnapshot().overallStatus, 'pending')
  assert.equal(createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: {},
    services: [],
    network: { interfaces: [], defaultRoute: null, dns: [] },
    firewall: { provider: '', enabled: null }
  }).overallStatus, 'pending')
})

test('created and normalized snapshots do not share nested mutable references', async () => {
  const {
    createFleetStatusSnapshot,
    normalizeFleetStatusSnapshot
  } = await loadModel()
  const source = {
    connection: { status: 'connected' },
    resources: { cpu: { usedPercent: 20, samples: [10, 20] } },
    services: [{ name: 'sshd.service', state: 'running' }],
    network: {
      interfaces: [{ name: 'eth0', addresses: ['10.0.0.8/24'] }],
      dns: ['1.1.1.1']
    }
  }
  const first = createFleetStatusSnapshot(source)
  const second = normalizeFleetStatusSnapshot(source)

  first.resources.cpu.samples.push(30)
  first.services[0].state = 'failed'
  first.network.interfaces[0].addresses[0] = 'changed'
  first.network.dns.push('8.8.8.8')

  assert.deepEqual(source.resources.cpu.samples, [10, 20])
  assert.equal(source.services[0].state, 'running')
  assert.equal(source.network.interfaces[0].addresses[0], '10.0.0.8/24')
  assert.deepEqual(second.resources.cpu.samples, [10, 20])
  assert.equal(second.services[0].state, 'running')
  assert.deepEqual(second.network.dns, ['1.1.1.1'])
})

test('sensitive fields are recursively omitted from normalized snapshots', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    password: 'top-password',
    privateKey: 'private-key-material',
    connection: {
      status: 'connected',
      passphrase: 'key-passphrase',
      apiKey: 'connection-api-key'
    },
    resources: {
      cpu: 20,
      metadata: { accessToken: 'resource-token' }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      credentials: { clientSecret: 'service-secret' }
    }],
    network: {
      interfaces: [{ name: 'eth0', authorization: 'Bearer network-secret' }],
      dns: ['1.1.1.1']
    },
    firewall: {
      provider: 'nftables',
      enabled: true,
      api_key: 'firewall-api-key'
    }
  })
  const serialized = JSON.stringify(snapshot)

  for (const secret of [
    'top-password',
    'private-key-material',
    'key-passphrase',
    'connection-api-key',
    'resource-token',
    'service-secret',
    'network-secret',
    'firewall-api-key'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
})

function retainedSensitiveSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        status: 'healthy',
        passwordHash: 'password-hash-secret'
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      privateKeyPem: 'private-key-pem-secret',
      metadata: {
        status: 'ready',
        apiKeyHeader: 'api-key-header-secret'
      }
    }],
    network: {
      interfaces: [{
        name: 'eth0',
        status: 'up',
        tokenValue: 'token-value-secret'
      }],
      defaultRoute: {
        gateway: '10.0.0.1',
        proxyAuthorization: 'proxy-authorization-secret'
      },
      dns: ['1.1.1.1']
    },
    firewall: { provider: 'nftables', enabled: true }
  }
}

function assertSensitiveVariantsRemoved (snapshot) {
  assert.equal(Object.hasOwn(snapshot.resources.cpu, 'passwordHash'), false)
  assert.equal(Object.hasOwn(snapshot.services[0], 'privateKeyPem'), false)
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'apiKeyHeader'), false)
  assert.equal(Object.hasOwn(snapshot.network.interfaces[0], 'tokenValue'), false)
  assert.equal(Object.hasOwn(snapshot.network.defaultRoute, 'proxyAuthorization'), false)
  assert.equal(snapshot.resources.cpu.status, 'healthy')
  assert.equal(snapshot.services[0].metadata.status, 'ready')
  assert.equal(snapshot.network.interfaces[0].status, 'up')

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'password-hash-secret',
    'private-key-pem-secret',
    'api-key-header-secret',
    'token-value-secret',
    'proxy-authorization-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create omits sensitive key variants from retained nested structures', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertSensitiveVariantsRemoved(
    createFleetStatusSnapshot(retainedSensitiveSource())
  )
})

test('normalize omits sensitive key variants from retained nested structures', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertSensitiveVariantsRemoved(
    normalizeFleetStatusSnapshot(retainedSensitiveSource())
  )
})

function retainedErrorPayloadSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        status: 'healthy',
        samples: [{
          errorMessage: 'authentication failed with auth-message-secret',
          errorCount: 2
        }]
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      diagnostics: [
        { errorDetail: 'operation timed out with detail-secret' },
        {
          lastError: {
            code: 'EACCES',
            message: 'permission payload permission-secret'
          }
        }
      ]
    }],
    network: {
      interfaces: [{
        name: 'eth0',
        rawError: {
          code: 'HOST_KEY_NOT_VERIFIABLE',
          message: 'host key payload host-key-secret'
        }
      }],
      dns: [{
        address: '1.1.1.1',
        errorMessage: 'platform is not supported with dns-secret'
      }]
    },
    firewall: { provider: 'nftables', enabled: true }
  }
}

function assertErrorPayloadsClassified (snapshot) {
  assert.equal(snapshot.resources.cpu.samples[0].errorMessage, 'auth')
  assert.equal(snapshot.resources.cpu.samples[0].errorCount, 2)
  assert.equal(snapshot.services[0].diagnostics[0].errorDetail, 'timeout')
  assert.equal(snapshot.services[0].diagnostics[1].lastError, 'permission')
  assert.equal(snapshot.network.interfaces[0].rawError, 'host-key')
  assert.equal(snapshot.network.dns[0].errorMessage, 'unsupported')

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'auth-message-secret',
    'detail-secret',
    'permission-secret',
    'host-key-secret',
    'dns-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create classifies nested error payload fields and arrays', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertErrorPayloadsClassified(
    createFleetStatusSnapshot(retainedErrorPayloadSource())
  )
})

test('normalize classifies nested error payload fields and arrays', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertErrorPayloadsClassified(
    normalizeFleetStatusSnapshot(retainedErrorPayloadSource())
  )
})

function retainedStringSecretSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        note: 'CPU steady; password=cpu-password-secret; sample complete'
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      description: 'request accepted; Authorization: Bearer bearer-secret; tenant=acme',
      command: 'deploy app=billing password=command-password-secret api_key: command-api-secret mode=read-only',
      notes: 'before key\n-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-pem-secret-body\n-----END OPENSSH PRIVATE KEY-----\nafter key'
    }],
    network: {
      interfaces: [{ name: 'eth0' }],
      defaultRoute: 'via 10.0.0.1 api_key: route-api-secret metric 100',
      dns: ['1.1.1.1']
    },
    firewall: {
      provider: 'nftables password=provider-password-secret stable',
      enabled: true
    }
  }
}

function assertStringSecretsRedacted (snapshot) {
  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'cpu-password-secret',
    'bearer-secret',
    'command-password-secret',
    'command-api-secret',
    'private-pem-secret-body',
    'route-api-secret',
    'provider-password-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }

  assert.match(snapshot.resources.cpu.note, /CPU steady/)
  assert.match(snapshot.resources.cpu.note, /sample complete/)
  assert.match(snapshot.services[0].description, /request accepted/)
  assert.match(snapshot.services[0].description, /tenant=acme/)
  assert.match(snapshot.services[0].command, /deploy app=billing/)
  assert.match(snapshot.services[0].command, /mode=read-only/)
  assert.match(snapshot.services[0].notes, /before key/)
  assert.match(snapshot.services[0].notes, /after key/)
  assert.match(snapshot.network.defaultRoute, /via 10\.0\.0\.1/)
  assert.match(snapshot.network.defaultRoute, /metric 100/)
  assert.match(snapshot.firewall.provider, /nftables/)
  assert.ok(serialized.includes('[REDACTED]'))
}

test('create redacts secrets inside retained neutral strings', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertStringSecretsRedacted(
    createFleetStatusSnapshot(retainedStringSecretSource())
  )
})

test('normalize redacts secrets inside retained neutral strings', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertStringSecretsRedacted(
    normalizeFleetStatusSnapshot(retainedStringSecretSource())
  )
})

function commonErrorFieldSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        stderr: 'permission denied with stderr-secret',
        errorCode: 'ETIMEDOUT'
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      diagnostics: [{
        exceptionMessage: 'authentication failed with exception-secret',
        failureReason: 'platform is not supported with failure-secret',
        errorCount: 4
      }]
    }],
    network: {
      interfaces: [{
        name: 'eth0',
        exception: {
          name: 'AbortError',
          message: 'cancelled with exception-object-secret'
        }
      }]
    }
  }
}

function assertCommonErrorFieldsClassified (snapshot) {
  assert.equal(snapshot.resources.cpu.stderr, 'permission')
  assert.equal(snapshot.resources.cpu.errorCode, 'timeout')
  assert.equal(snapshot.services[0].diagnostics[0].exceptionMessage, 'auth')
  assert.equal(snapshot.services[0].diagnostics[0].failureReason, 'unsupported')
  assert.equal(snapshot.services[0].diagnostics[0].errorCount, 4)
  assert.equal(snapshot.network.interfaces[0].exception, 'cancelled')

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'stderr-secret',
    'exception-secret',
    'failure-secret',
    'exception-object-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create classifies common error-like fields without retaining raw text', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertCommonErrorFieldsClassified(
    createFleetStatusSnapshot(commonErrorFieldSource())
  )
})

test('normalize classifies common error-like fields without retaining raw text', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertCommonErrorFieldsClassified(
    normalizeFleetStatusSnapshot(commonErrorFieldSource())
  )
})

function emptyNetworkProbeSource () {
  return {
    connection: { status: 'connected' },
    network: {
      interfaces: [{}, { name: '   ', addresses: [''] }],
      defaultRoute: '',
      dns: ['', '   ']
    },
    firewall: { provider: '   ', enabled: null }
  }
}

test('create keeps empty network and firewall probe variants pending', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assert.equal(
    createFleetStatusSnapshot(emptyNetworkProbeSource()).overallStatus,
    'pending'
  )
})

test('normalize keeps empty network and firewall probe variants pending', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assert.equal(
    normalizeFleetStatusSnapshot(emptyNetworkProbeSource()).overallStatus,
    'pending'
  )
})

function auditBoundaryStringSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        note: JSON.stringify({
          password: 'json-password-secret',
          api_key: 'json-api-secret',
          Authorization: 'Bearer json-authorization-secret',
          message: 'ordinary-json-message'
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      command: 'deploy --password cli-password-secret --api-key=cli-api-secret --check'
    }],
    network: {
      interfaces: [{
        name: 'eth0',
        note: 'probe Bearer bare-bearer-secret; interface up'
      }],
      defaultRoute: 'https://example.test/run?mode=full&api_key=url-api-secret&token=url-token-secret&limit=10',
      dns: ['1.1.1.1']
    },
    firewall: { provider: 'nftables', enabled: true }
  }
}

function assertAuditBoundaryStringsRedacted (snapshot) {
  const jsonNote = JSON.parse(snapshot.resources.cpu.note)
  assert.equal(Object.hasOwn(jsonNote, 'password'), false)
  assert.equal(Object.hasOwn(jsonNote, 'api_key'), false)
  assert.equal(Object.hasOwn(jsonNote, 'Authorization'), false)
  assert.equal(jsonNote.message, 'ordinary-json-message')
  assert.match(snapshot.services[0].command, /deploy/)
  assert.match(snapshot.services[0].command, /--check/)
  assert.match(snapshot.network.interfaces[0].note, /interface up/)
  assert.match(snapshot.network.defaultRoute, /mode=full/)
  assert.match(snapshot.network.defaultRoute, /limit=10/)

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'json-password-secret',
    'json-api-secret',
    'json-authorization-secret',
    'cli-password-secret',
    'cli-api-secret',
    'bare-bearer-secret',
    'url-api-secret',
    'url-token-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create reuses audit redaction for JSON CLI query and Bearer strings', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertAuditBoundaryStringsRedacted(
    createFleetStatusSnapshot(auditBoundaryStringSource())
  )
})

test('normalize reuses audit redaction for JSON CLI query and Bearer strings', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertAuditBoundaryStringsRedacted(
    normalizeFleetStatusSnapshot(auditBoundaryStringSource())
  )
})

function aliasedJsonStringSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        objectPayload: JSON.stringify({
          pwd: 'json-pwd-secret',
          authHeader: 'Basic json-auth-header-secret',
          message: 'ordinary object message',
          note: 'token=inner-object-token-secret; object note stays'
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      arrayPayload: JSON.stringify([{
        pwd: 'array-pwd-secret',
        authHeader: 'Basic array-auth-header-secret',
        message: 'ordinary array message',
        note: 'Bearer inner-array-bearer-secret; array note stays'
      }])
    }]
  }
}

function assertAliasedJsonStringsRedacted (snapshot) {
  const objectPayload = JSON.parse(snapshot.resources.cpu.objectPayload)
  const arrayPayload = JSON.parse(snapshot.services[0].arrayPayload)

  assert.equal(Object.hasOwn(objectPayload, 'pwd'), false)
  assert.equal(Object.hasOwn(objectPayload, 'authHeader'), false)
  assert.equal(objectPayload.message, 'ordinary object message')
  assert.match(objectPayload.note, /token=\[REDACTED\]/)
  assert.match(objectPayload.note, /object note stays/)

  assert.equal(Object.hasOwn(arrayPayload[0], 'pwd'), false)
  assert.equal(Object.hasOwn(arrayPayload[0], 'authHeader'), false)
  assert.equal(arrayPayload[0].message, 'ordinary array message')
  assert.match(arrayPayload[0].note, /Bearer \[REDACTED\]/)
  assert.match(arrayPayload[0].note, /array note stays/)

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'json-pwd-secret',
    'json-auth-header-secret',
    'inner-object-token-secret',
    'array-pwd-secret',
    'array-auth-header-secret',
    'inner-array-bearer-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create applies model aliases inside JSON object and array strings', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertAliasedJsonStringsRedacted(
    createFleetStatusSnapshot(aliasedJsonStringSource())
  )
})

test('normalize applies model aliases inside JSON object and array strings', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertAliasedJsonStringsRedacted(
    normalizeFleetStatusSnapshot(aliasedJsonStringSource())
  )
})

function nestedJsonEnvelopeSource () {
  const objectEnvelope = JSON.stringify({
    pwd: 'nested-object-pwd-secret',
    authHeader: 'Basic nested-object-auth-secret',
    message: 'nested object message',
    note: 'token=nested-object-token-secret; nested object note stays'
  })
  const arrayEnvelope = JSON.stringify({
    pwd: 'nested-array-pwd-secret',
    authHeader: 'Basic nested-array-auth-secret',
    message: 'nested array message',
    note: 'Bearer nested-array-bearer-secret; nested array note stays'
  })
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        envelopePayload: JSON.stringify({
          envelope: objectEnvelope,
          message: 'outer object message'
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      envelopePayload: JSON.stringify([{
        envelope: arrayEnvelope,
        message: 'outer array message'
      }])
    }]
  }
}

function assertNestedJsonEnvelopesRedacted (snapshot) {
  const outerObject = JSON.parse(snapshot.resources.cpu.envelopePayload)
  const outerArray = JSON.parse(snapshot.services[0].envelopePayload)
  const nestedObject = JSON.parse(outerObject.envelope)
  const nestedArray = JSON.parse(outerArray[0].envelope)

  assert.equal(outerObject.message, 'outer object message')
  assert.equal(Object.hasOwn(nestedObject, 'pwd'), false)
  assert.equal(Object.hasOwn(nestedObject, 'authHeader'), false)
  assert.equal(nestedObject.message, 'nested object message')
  assert.match(nestedObject.note, /token=\[REDACTED\]/)
  assert.match(nestedObject.note, /nested object note stays/)

  assert.equal(outerArray[0].message, 'outer array message')
  assert.equal(Object.hasOwn(nestedArray, 'pwd'), false)
  assert.equal(Object.hasOwn(nestedArray, 'authHeader'), false)
  assert.equal(nestedArray.message, 'nested array message')
  assert.match(nestedArray.note, /Bearer \[REDACTED\]/)
  assert.match(nestedArray.note, /nested array note stays/)

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'nested-object-pwd-secret',
    'nested-object-auth-secret',
    'nested-object-token-secret',
    'nested-array-pwd-secret',
    'nested-array-auth-secret',
    'nested-array-bearer-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

test('create recursively sanitizes nested JSON envelope strings', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertNestedJsonEnvelopesRedacted(
    createFleetStatusSnapshot(nestedJsonEnvelopeSource())
  )
})

test('normalize recursively sanitizes nested JSON envelope strings', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertNestedJsonEnvelopesRedacted(
    normalizeFleetStatusSnapshot(nestedJsonEnvelopeSource())
  )
})

function boundedJsonFallbackSource () {
  let deepPayload = JSON.stringify({
    pwd: 'deep-fallback-pwd-secret',
    authHeader: 'Basic deep-fallback-auth-secret',
    note: 'token=deep-fallback-token-secret; deep note stays'
  })
  for (let depth = 0; depth < 8; depth += 1) {
    deepPayload = JSON.stringify({ envelope: deepPayload })
  }
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        oversizedPayload: JSON.stringify({
          pwd: 'large-fallback-pwd-secret',
          authHeader: 'Basic large-fallback-auth-secret',
          note: 'Bearer large-fallback-bearer-secret; large note stays',
          padding: 'x'.repeat(70 * 1024)
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      deepPayload
    }]
  }
}

function assertBoundedJsonFallbackRedacted (snapshot) {
  const oversized = JSON.parse(snapshot.resources.cpu.oversizedPayload)
  assert.equal(oversized.pwd, '[REDACTED]')
  assert.equal(oversized.authHeader, '[REDACTED]')
  assert.match(oversized.note, /Bearer \[REDACTED\]/)
  assert.match(oversized.note, /large note stays/)

  let deepPayload = snapshot.services[0].deepPayload
  for (let depth = 0; depth < 8; depth += 1) {
    deepPayload = JSON.parse(deepPayload).envelope
  }
  const deepLeaf = JSON.parse(deepPayload)
  assert.equal(deepLeaf.pwd, '[REDACTED]')
  assert.equal(deepLeaf.authHeader, '[REDACTED]')
  assert.match(deepLeaf.note, /token=\[REDACTED\]/)
  assert.match(deepLeaf.note, /deep note stays/)

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'large-fallback-pwd-secret',
    'large-fallback-auth-secret',
    'large-fallback-bearer-secret',
    'deep-fallback-pwd-secret',
    'deep-fallback-auth-secret',
    'deep-fallback-token-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} redacts Fleet aliases after JSON depth and length fallback`, async () => {
    const model = await loadModel()
    assertBoundedJsonFallbackRedacted(
      model[exportName](boundedJsonFallbackSource())
    )
  })
}

const probeErrorCases = [
  {
    label: 'network permission error',
    expected: 'warning',
    data: {
      network: { interfaces: [{ error: 'permission denied' }] }
    }
  },
  {
    label: 'firewall unknown error',
    expected: 'warning',
    data: {
      firewall: { error: 'opaque firewall probe failure' }
    }
  },
  {
    label: 'resource timeout error',
    expected: 'critical',
    data: {
      resources: { cpu: { error: 'operation timed out' } }
    }
  }
]

for (const [apiLabel, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  for (const { label, expected, data } of probeErrorCases) {
    test(`${apiLabel} maps ${label} to ${expected}`, async () => {
      const model = await loadModel()
      const snapshot = model[exportName]({
        connection: { status: 'connected' },
        ...data
      })

      assert.equal(snapshot.overallStatus, expected)
      assert.notEqual(snapshot.overallStatus, 'healthy')
    })
  }
}

for (const [state, expected] of [
  ['exited', 'critical'],
  ['failure', 'critical'],
  ['restarting', 'warning'],
  ['paused', 'warning'],
  ['created', 'warning']
]) {
  test(`service state ${state} maps to ${expected}`, async () => {
    const { createFleetStatusSnapshot } = await loadModel()
    const snapshot = createFleetStatusSnapshot({
      connection: { status: 'connected' },
      services: [{ name: 'app.service', state }]
    })

    assert.equal(snapshot.overallStatus, expected)
  })
}

function adversarialGraphSource () {
  const cycle = { label: 'cycle' }
  cycle.self = cycle
  const deep = { level: 0 }
  let cursor = deep
  for (let depth = 1; depth <= 12000; depth += 1) {
    cursor.next = { level: depth }
    cursor = cursor.next
  }
  return {
    connection: { status: 'connected' },
    resources: { cpu: 20 },
    services: [{
      name: 'agent.service',
      state: 'running',
      metadata: { cycle, deep }
    }]
  }
}

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} bounds cyclic and 12k-deep input graphs`, async () => {
    const model = await loadModel()
    const snapshot = model[exportName](adversarialGraphSource())
    const serialized = JSON.stringify(snapshot)

    assert.match(serialized, /\[CIRCULAR\]/)
    assert.match(serialized, /\[TRUNCATED\]/)
  })
}

test('large arrays are capped with a safe placeholder', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        samples: Array.from({ length: 5000 }, (_, index) => index)
      }
    }
  })

  assert.ok(snapshot.resources.cpu.samples.length <= 2001)
  assert.equal(snapshot.resources.cpu.samples.at(-1), '[TRUNCATED]')
})

test('normalizes 1000 healthy services in under 200ms', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const source = {
    connection: { status: 'connected' },
    services: Array.from({ length: 1000 }, (_, index) => ({
      name: `service-${index}.service`,
      state: 'running'
    }))
  }
  const startedAt = performance.now()
  const snapshot = createFleetStatusSnapshot(source)
  const elapsedMs = performance.now() - startedAt

  assert.equal(snapshot.services.length, 1000)
  assert.equal(snapshot.overallStatus, 'healthy')
  assert.ok(elapsedMs < 200, `elapsed ${elapsedMs.toFixed(2)}ms`)
})

for (const [label, error] of [
  ['SSH permission denied authentication', 'Permission denied (publickey,password)'],
  ['HTTP 401 Unauthorized', { status: 401, message: 'Unauthorized' }]
]) {
  test(`classifies ${label} as auth`, async () => {
    const { classifyFleetStatusError } = await loadModel()
    assert.equal(classifyFleetStatusError(error), 'auth')
  })
}

function sensitiveKeyBoundarySource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        tokenCount: 3,
        passwordAuthenticationEnabled: false,
        credentialProvider: 'vault',
        authorizationStatus: 'enabled',
        secretary: 'alice',
        passwordHash: 'password-hash-secret',
        tokenValue: 'token-value-secret'
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      metadata: {
        privateKeyPem: 'private-key-secret',
        apiKeyHeader: 'api-key-secret',
        proxyAuthorization: 'proxy-auth-secret'
      }
    }]
  }
}

function assertSensitiveKeyBoundaries (snapshot) {
  const cpu = snapshot.resources.cpu
  assert.equal(cpu.tokenCount, 3)
  assert.equal(cpu.passwordAuthenticationEnabled, false)
  assert.equal(cpu.credentialProvider, 'vault')
  assert.equal(cpu.authorizationStatus, 'enabled')
  assert.equal(cpu.secretary, 'alice')
  assert.equal(Object.hasOwn(cpu, 'passwordHash'), false)
  assert.equal(Object.hasOwn(cpu, 'tokenValue'), false)
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'privateKeyPem'), false)
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'apiKeyHeader'), false)
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'proxyAuthorization'), false)
}

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} preserves safe metric keys while omitting credential keys`, async () => {
    const model = await loadModel()
    assertSensitiveKeyBoundaries(
      model[exportName](sensitiveKeyBoundarySource())
    )
  })
}

test('deriveFleetStatusHealth accepts null', async () => {
  const { deriveFleetStatusHealth } = await loadModel()
  assert.deepEqual(deriveFleetStatusHealth(null), { overallStatus: 'pending' })
})

test('worstFleetStatus accepts null', async () => {
  const { worstFleetStatus } = await loadModel()
  assert.equal(worstFleetStatus(null), 'pending')
})

test('invalid collectedAt Date is normalized without throwing', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    collectedAt: new Date('invalid')
  })

  assert.equal(snapshot.collectedAt, '')
})

test('resource thresholds include exact percent and load boundaries', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const cases = [
    [{ cpu: 79.99 }, 'healthy'],
    [{ cpu: 80 }, 'warning'],
    [{ cpu: 89.99 }, 'warning'],
    [{ cpu: 90 }, 'critical'],
    [{ load: 0.99 }, 'healthy'],
    [{ load: 1 }, 'warning'],
    [{ load: 1.99 }, 'warning'],
    [{ load: 2 }, 'critical']
  ]

  for (const [resources, expected] of cases) {
    const snapshot = createFleetStatusSnapshot({
      connection: { status: 'connected' },
      resources
    })
    assert.equal(snapshot.overallStatus, expected, JSON.stringify(resources))
  }
})

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} keeps invalid resource metrics pending`, async () => {
    const model = await loadModel()
    const cases = [
      { uptime: -1 },
      { uptime: 'not-a-number' },
      { cpu: -1 },
      { cpu: { usedPercent: -1, status: 'healthy' } },
      { cpu: { usedPercent: 'not-a-number', status: 'healthy' } },
      { load: -0.1 },
      { load: { normalized: 'not-a-number', status: 'healthy' } }
    ]

    for (const resources of cases) {
      const snapshot = model[exportName]({
        connection: { status: 'connected' },
        resources
      })
      assert.equal(snapshot.overallStatus, 'pending', JSON.stringify(resources))
      assert.deepEqual(Object.keys(snapshot), [
        'connection',
        'resources',
        'services',
        'network',
        'firewall',
        'collectedAt',
        'overallStatus'
      ])
    }
  })
}

const structuralNumericCases = [
  ['usedPercent empty array', { cpu: { usedPercent: [] } }],
  ['usedPercent item array', { cpu: { usedPercent: [5] } }],
  [
    'usedPercent coercible object',
    { cpu: { usedPercent: { valueOf: () => 5 } } }
  ],
  ['usedPercent boolean', { cpu: { usedPercent: true } }],
  ['load normalized empty array', { load: { normalized: [] } }],
  ['load normalized item array', { load: { normalized: [0.5] } }],
  [
    'load normalized coercible object',
    { load: { normalized: { valueOf: () => 0.5 } } }
  ],
  ['load normalized boolean', { load: { normalized: false } }],
  ['load one-minute empty array', { load: { one: [] } }],
  ['load one-minute item array', { load: { one: [0.5] } }],
  [
    'load one-minute coercible object',
    { load: { one: { valueOf: () => 0.5 } } }
  ],
  ['load one-minute boolean', { load: { one: true } }],
  ['uptime empty array', { uptime: [] }],
  ['uptime item array', { uptime: [5] }],
  ['uptime coercible object', { uptime: { valueOf: () => 5 } }],
  ['uptime boolean', { uptime: true }]
]

for (const [label, resources] of structuralNumericCases) {
  test(`deriveFleetStatusHealth rejects ${label}`, async () => {
    const { deriveFleetStatusHealth } = await loadModel()
    const health = deriveFleetStatusHealth({
      connection: { status: 'connected' },
      resources
    })

    assert.equal(health.overallStatus, 'pending')
  })
}

test('deriveFleetStatusHealth accepts non-empty numeric strings', async () => {
  const { deriveFleetStatusHealth } = await loadModel()
  const cases = [
    { cpu: { usedPercent: '20' } },
    { load: { normalized: '0.5' } },
    { load: { one: '0.5' } },
    { uptime: '5' }
  ]

  for (const resources of cases) {
    const health = deriveFleetStatusHealth({
      connection: { status: 'connected' },
      resources
    })
    assert.equal(health.overallStatus, 'healthy', JSON.stringify(resources))
  }
})

const directStructuralMetricCases = [
  ['cpu array', { cpu: [5] }],
  ['cpu coercible object', { cpu: { valueOf: () => 5 } }],
  ['cpu boolean', { cpu: true }],
  ['load array', { load: [0.5] }],
  ['load coercible object', { load: { valueOf: () => 0.5 } }],
  ['load boolean', { load: true }],
  ['uptime array', { uptime: [5] }],
  ['uptime coercible object', { uptime: { valueOf: () => 5 } }],
  ['uptime boolean', { uptime: true }],
  ['usedPercent array', { cpu: { usedPercent: [5] } }],
  [
    'usedPercent coercible object',
    { cpu: { usedPercent: { valueOf: () => 5 } } }
  ],
  ['usedPercent boolean', { cpu: { usedPercent: true } }]
]

for (const [apiLabel, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot'],
  ['derive', 'deriveFleetStatusHealth']
]) {
  for (const [metricLabel, resources] of directStructuralMetricCases) {
    test(`${apiLabel} keeps direct ${metricLabel} non-healthy`, async () => {
      const model = await loadModel()
      const result = model[exportName]({
        connection: { status: 'connected' },
        resources
      })

      assert.equal(result.overallStatus, 'pending')
    })
  }
}

for (const [label, resources, services, expected] of [
  [
    'healthy services despite a critical-looking cpu array',
    { cpu: [95] },
    [{ name: 'agent.service', state: 'running' }],
    'healthy'
  ],
  [
    'warning services despite a critical-looking load array',
    { load: [2] },
    [{ name: 'agent.service', state: 'restarting' }],
    'warning'
  ]
]) {
  test(`service arrays still aggregate ${label}`, async () => {
    const { deriveFleetStatusHealth } = await loadModel()
    const health = deriveFleetStatusHealth({
      connection: { status: 'connected' },
      resources,
      services
    })

    assert.equal(health.overallStatus, expected)
  })
}

function sensitiveAliasSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        status: 'healthy',
        pwd: 'pwd-field-secret'
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      metadata: {
        status: 'ready',
        authHeader: 'Bearer auth-header-secret'
      }
    }]
  }
}

function assertSensitiveAliasesRemoved (snapshot) {
  assert.equal(Object.hasOwn(snapshot.resources.cpu, 'pwd'), false)
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'authHeader'), false)
  assert.equal(snapshot.resources.cpu.status, 'healthy')
  assert.equal(snapshot.services[0].metadata.status, 'ready')
  assert.equal(JSON.stringify(snapshot).includes('pwd-field-secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('auth-header-secret'), false)
}

test('create omits pwd and authHeader sensitive aliases', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertSensitiveAliasesRemoved(
    createFleetStatusSnapshot(sensitiveAliasSource())
  )
})

test('normalize omits pwd and authHeader sensitive aliases', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertSensitiveAliasesRemoved(
    normalizeFleetStatusSnapshot(sensitiveAliasSource())
  )
})

function compoundErrorFieldSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        lastErrorMessage: 'operation timed out with last-error-secret',
        errorCount: 7,
        errorRate: 0.25
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      diagnostics: [{
        stderrText: 'permission denied with stderr-text-secret',
        errorCount: 2,
        errorRate: 0.1
      }]
    }]
  }
}

function assertCompoundErrorFieldsClassified (snapshot) {
  assert.equal(snapshot.resources.cpu.lastErrorMessage, 'timeout')
  assert.equal(snapshot.resources.cpu.errorCount, 7)
  assert.equal(snapshot.resources.cpu.errorRate, 0.25)
  assert.equal(snapshot.services[0].diagnostics[0].stderrText, 'permission')
  assert.equal(snapshot.services[0].diagnostics[0].errorCount, 2)
  assert.equal(snapshot.services[0].diagnostics[0].errorRate, 0.1)
  assert.equal(JSON.stringify(snapshot).includes('last-error-secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('stderr-text-secret'), false)
}

test('create classifies compound error fields without touching statistics', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertCompoundErrorFieldsClassified(
    createFleetStatusSnapshot(compoundErrorFieldSource())
  )
})

test('normalize classifies compound error fields without touching statistics', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertCompoundErrorFieldsClassified(
    normalizeFleetStatusSnapshot(compoundErrorFieldSource())
  )
})

function connectedUnknownErrorSource () {
  return {
    connection: {
      status: 'connected',
      error: 'socket closed with opaque-connection-secret'
    },
    resources: { cpu: 20 }
  }
}

function assertConnectedUnknownErrorOffline (snapshot) {
  assert.equal(snapshot.connection.status, 'connected')
  assert.equal(snapshot.connection.error, 'unknown')
  assert.equal(snapshot.overallStatus, 'offline')
  assert.equal(JSON.stringify(snapshot).includes('opaque-connection-secret'), false)
}

test('create keeps a connected unknown error offline', async () => {
  const { createFleetStatusSnapshot } = await loadModel()

  assertConnectedUnknownErrorOffline(
    createFleetStatusSnapshot(connectedUnknownErrorSource())
  )
})

test('normalize keeps a connected unknown error offline', async () => {
  const { normalizeFleetStatusSnapshot } = await loadModel()

  assertConnectedUnknownErrorOffline(
    normalizeFleetStatusSnapshot(connectedUnknownErrorSource())
  )
})

function cookieSensitiveSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        cookie: 'direct-cookie-secret',
        sessionCookie: 'session-cookie-secret',
        cookies: 'cookies-secret',
        cookieHeader: 'cookie-header-secret',
        cookieJar: 'cookie-jar-secret',
        setCookie: 'set-cookie-secret',
        cookieCount: 4,
        cookiePolicy: 'same-site',
        cookieEnabled: true,
        cookieConsentStatus: 'accepted',
        metadataPayload: JSON.stringify({
          cookie: 'json-cookie-secret',
          analyticsCookie: 'json-analytics-cookie-secret',
          cookieHeader: 'json-cookie-header-secret',
          cookieCount: 2,
          cookiePolicy: 'strict'
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      metadata: {
        authCookie: 'nested-cookie-secret',
        cookiePolicy: 'service-policy'
      }
    }]
  }
}

function assertCookieSecretsRedacted (snapshot) {
  const cpu = snapshot.resources.cpu
  const jsonPayload = JSON.parse(cpu.metadataPayload)
  for (const key of [
    'cookie',
    'sessionCookie',
    'cookies',
    'cookieHeader',
    'cookieJar',
    'setCookie'
  ]) {
    assert.equal(Object.hasOwn(cpu, key), false, key)
  }
  assert.equal(Object.hasOwn(snapshot.services[0].metadata, 'authCookie'), false)
  assert.equal(Object.hasOwn(jsonPayload, 'cookie'), false)
  assert.equal(Object.hasOwn(jsonPayload, 'analyticsCookie'), false)
  assert.equal(Object.hasOwn(jsonPayload, 'cookieHeader'), false)
  assert.equal(cpu.cookieCount, 4)
  assert.equal(cpu.cookiePolicy, 'same-site')
  assert.equal(cpu.cookieEnabled, true)
  assert.equal(cpu.cookieConsentStatus, 'accepted')
  assert.equal(jsonPayload.cookieCount, 2)
  assert.equal(jsonPayload.cookiePolicy, 'strict')
  assert.equal(snapshot.services[0].metadata.cookiePolicy, 'service-policy')

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'direct-cookie-secret',
    'session-cookie-secret',
    'cookies-secret',
    'cookie-header-secret',
    'cookie-jar-secret',
    'set-cookie-secret',
    'json-cookie-secret',
    'json-analytics-cookie-secret',
    'json-cookie-header-secret',
    'nested-cookie-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

function uriUserinfoSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        endpoint: 'https://alice:hunter2@example.test/path',
        usernameOnlyEndpoint: 'https://alice@example.test/path',
        emptyUsernameEndpoint: 'https://:opaque@example.test/path',
        publicEndpoint: 'https://example.test/path?owner=alice@example.test'
      }
    },
    services: [{
      name: 'database.service',
      state: 'running',
      databaseUri: 'postgres://dbuser:dbpass@db.example.test/app?ssl=1',
      publicDatabaseUri: 'postgres://db.example.test/app?ssl=1'
    }]
  }
}

function assertUriUserinfoRedacted (snapshot) {
  assert.equal(
    snapshot.resources.cpu.endpoint,
    'https://alice:[REDACTED]@example.test/path'
  )
  assert.equal(
    snapshot.resources.cpu.usernameOnlyEndpoint,
    'https://[REDACTED]@example.test/path'
  )
  assert.equal(
    snapshot.services[0].databaseUri,
    'postgres://dbuser:[REDACTED]@db.example.test/app?ssl=1'
  )
  assert.equal(
    snapshot.resources.cpu.emptyUsernameEndpoint,
    'https://:[REDACTED]@example.test/path'
  )
  assert.equal(
    snapshot.resources.cpu.publicEndpoint,
    'https://example.test/path?owner=alice@example.test'
  )
  assert.equal(
    snapshot.services[0].publicDatabaseUri,
    'postgres://db.example.test/app?ssl=1'
  )
  const serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes('hunter2'), false)
  assert.equal(serialized.includes('dbpass'), false)
  assert.equal(serialized.includes('opaque'), false)
}

const uriUserinfoBoundaryCases = [
  [
    'password containing an at sign',
    'https://alice:p@ss@example.test/path',
    'https://alice:[REDACTED]@example.test/path'
  ],
  [
    'password containing a comma',
    'https://alice:pa,ss@example.test/path',
    'https://alice:[REDACTED]@example.test/path'
  ],
  [
    'password containing multiple at signs with a port',
    'ssh://root:p@ss@word@example.test:2222/home/root?owner=ops@example.test',
    'ssh://root:[REDACTED]@example.test:2222/home/root?owner=ops@example.test'
  ],
  [
    'username containing an at sign with a port',
    'https://alice@ops@example.test:8443/path',
    'https://[REDACTED]@example.test:8443/path'
  ],
  [
    'ordinary at signs in URL path query and fragment',
    'https://example.test:8443/users/alice@example.test?owner=bob@example.test#mail@local',
    'https://example.test:8443/users/alice@example.test?owner=bob@example.test#mail@local'
  ],
  [
    'ordinary non-credential at text',
    'contact alice@example.test; owner=bob@example.test',
    'contact alice@example.test; owner=bob@example.test'
  ]
]

function topLevelErrorSource () {
  return {
    connection: { status: 'connected', error: '' },
    resources: { cpu: 20 },
    error: {
      status: 401,
      message: 'Unauthorized bearer top-level-error-secret'
    }
  }
}

function compoundSensitiveKeySource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        authorizationHeader: 'compound-authorization-secret',
        clientApiKeyValue: 'client-api-key-secret',
        sshPrivateKeyValue: 'ssh-private-key-secret',
        awsAccessKeyId: 'aws-access-key-secret',
        authorizationPayload: 'authorization-payload-secret',
        sessionTokenPayload: 'session-token-payload-secret',
        cookiePayload: 'cookie-payload-secret',
        privateKeyPayload: 'private-key-payload-secret',
        credentialPayload: 'credential-payload-secret',
        stack: 'opaque-stack-material',
        apiKeyMaterial: 'api-key-material-secret',
        privateKeyContent: 'private-key-content-secret',
        passwordBytes: 'password-bytes-secret',
        sessionCookieName: 'session-cookie-name-secret',
        authorizationBlob: 'authorization-blob-secret',
        accessTokenBytes: 'access-token-bytes-secret',
        tokenCount: 7,
        passwordAuthenticationEnabled: true,
        authorizationStatus: 'granted',
        cookieCount: 9,
        credentialProvider: 'vault',
        compoundPayload: JSON.stringify({
          authorizationHeader: 'json-authorization-secret',
          oauthAccessTokenValue: 'json-oauth-token-secret',
          databasePasswordValue: 'json-database-password-secret',
          tokenCount: 8,
          passwordAuthenticationEnabled: false,
          authorizationStatus: 'pending',
          credentialProvider: 'keychain'
        })
      }
    },
    services: [{
      name: 'agent.service',
      state: 'running',
      metadata: {
        oauthAccessTokenValue: 'object-oauth-token-secret',
        databasePasswordValue: 'object-database-password-secret'
      }
    }]
  }
}

function assertCompoundSensitiveKeysRedacted (snapshot) {
  const cpu = snapshot.resources.cpu
  const metadata = snapshot.services[0].metadata
  const payload = JSON.parse(cpu.compoundPayload)
  assert.equal(Object.hasOwn(cpu, 'authorizationHeader'), false)
  for (const key of [
    'clientApiKeyValue',
    'sshPrivateKeyValue',
    'awsAccessKeyId',
    'authorizationPayload',
    'sessionTokenPayload',
    'cookiePayload',
    'privateKeyPayload',
    'credentialPayload',
    'stack',
    'apiKeyMaterial',
    'privateKeyContent',
    'passwordBytes',
    'sessionCookieName',
    'authorizationBlob',
    'accessTokenBytes'
  ]) {
    assert.equal(Object.hasOwn(cpu, key), false, key)
  }
  assert.equal(Object.hasOwn(metadata, 'oauthAccessTokenValue'), false)
  assert.equal(Object.hasOwn(metadata, 'databasePasswordValue'), false)
  assert.equal(Object.hasOwn(payload, 'authorizationHeader'), false)
  assert.equal(Object.hasOwn(payload, 'oauthAccessTokenValue'), false)
  assert.equal(Object.hasOwn(payload, 'databasePasswordValue'), false)

  assert.equal(cpu.tokenCount, 7)
  assert.equal(cpu.passwordAuthenticationEnabled, true)
  assert.equal(cpu.authorizationStatus, 'granted')
  assert.equal(cpu.cookieCount, 9)
  assert.equal(cpu.credentialProvider, 'vault')
  assert.equal(payload.tokenCount, 8)
  assert.equal(payload.passwordAuthenticationEnabled, false)
  assert.equal(payload.authorizationStatus, 'pending')
  assert.equal(payload.credentialProvider, 'keychain')

  const serialized = JSON.stringify(snapshot)
  for (const secret of [
    'compound-authorization-secret',
    'client-api-key-secret',
    'ssh-private-key-secret',
    'aws-access-key-secret',
    'authorization-payload-secret',
    'session-token-payload-secret',
    'cookie-payload-secret',
    'private-key-payload-secret',
    'credential-payload-secret',
    'opaque-stack-material',
    'api-key-material-secret',
    'private-key-content-secret',
    'password-bytes-secret',
    'session-cookie-name-secret',
    'authorization-blob-secret',
    'access-token-bytes-secret',
    'json-authorization-secret',
    'json-oauth-token-secret',
    'json-database-password-secret',
    'object-oauth-token-secret',
    'object-database-password-secret'
  ]) {
    assert.equal(serialized.includes(secret), false, secret)
  }
}

function secretKeyFamilySource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        secretKey: 'direct-secret-key-marker',
        clientSecretKey: 'direct-client-secret-key-marker',
        sshpass: 'direct-sshpass-marker',
        secretKeyMaterial: 'direct-secret-key-material-marker',
        clientSecretKeyBytes: 'direct-client-secret-key-bytes-marker',
        secretKeyCount: 2,
        clientSecretKeyStatus: 'rotated',
        sshpassEnabled: false,
        sshpassCount: 3,
        metadataPayload: JSON.stringify({
          secretKey: 'json-secret-key-marker',
          clientSecretKey: 'json-client-secret-key-marker',
          sshpass: 'json-sshpass-marker',
          secretKeyMaterial: 'json-secret-key-material-marker',
          secretKeyCount: 4,
          clientSecretKeyStatus: 'active',
          sshpassEnabled: true,
          sshpassCount: 5
        })
      }
    }
  }
}

function assertSecretKeyFamilyRedacted (snapshot) {
  const cpu = snapshot.resources.cpu
  const payload = JSON.parse(cpu.metadataPayload)
  for (const key of [
    'secretKey',
    'clientSecretKey',
    'sshpass',
    'secretKeyMaterial',
    'clientSecretKeyBytes'
  ]) {
    assert.equal(Object.hasOwn(cpu, key), false, key)
  }
  for (const key of [
    'secretKey',
    'clientSecretKey',
    'sshpass',
    'secretKeyMaterial'
  ]) {
    assert.equal(Object.hasOwn(payload, key), false, `JSON ${key}`)
  }
  assert.equal(cpu.secretKeyCount, 2)
  assert.equal(cpu.clientSecretKeyStatus, 'rotated')
  assert.equal(cpu.sshpassEnabled, false)
  assert.equal(cpu.sshpassCount, 3)
  assert.equal(payload.secretKeyCount, 4)
  assert.equal(payload.clientSecretKeyStatus, 'active')
  assert.equal(payload.sshpassEnabled, true)
  assert.equal(payload.sshpassCount, 5)

  const serialized = JSON.stringify(snapshot)
  for (const marker of [
    'direct-secret-key-marker',
    'direct-client-secret-key-marker',
    'direct-sshpass-marker',
    'direct-secret-key-material-marker',
    'direct-client-secret-key-bytes-marker',
    'json-secret-key-marker',
    'json-client-secret-key-marker',
    'json-sshpass-marker',
    'json-secret-key-material-marker'
  ]) {
    assert.equal(serialized.includes(marker), false, marker)
  }
}

function prototypePollutionSource () {
  const cpu = JSON.parse(
    '{"__proto__":{"status":"healthy","fleetPolluted":true},' +
    '"prototype":{"status":"healthy"},' +
    '"constructor":{"status":"healthy"}}'
  )
  cpu.metadataPayload =
    '{"__proto__":{"status":"healthy"},' +
    '"prototype":{"status":"healthy"},' +
    '"constructor":{"status":"healthy"},"safe":"kept"}'
  return {
    connection: { status: 'connected' },
    resources: { cpu }
  }
}

function assertPrototypeKeysRemoved (snapshot) {
  const cpu = snapshot.resources.cpu
  const payload = JSON.parse(cpu.metadataPayload)
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    assert.equal(Object.hasOwn(cpu, key), false, key)
    assert.equal(Object.hasOwn(payload, key), false, `JSON ${key}`)
  }
  assert.equal(Object.getPrototypeOf(cpu), Object.prototype)
  assert.equal(Object.getPrototypeOf(payload), Object.prototype)
  assert.equal(payload.safe, 'kept')
  assert.equal(snapshot.overallStatus, 'pending')
  assert.equal({}.fleetPolluted, undefined)
  assert.doesNotThrow(() => JSON.stringify(snapshot))
}

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} removes secretKey family secrets without false positives`, async () => {
    const model = await loadModel()
    assertSecretKeyFamilyRedacted(model[exportName](secretKeyFamilySource()))
  })

  test(`${label} skips dangerous object keys in objects and JSON`, async () => {
    const model = await loadModel()
    assertPrototypeKeysRemoved(model[exportName](prototypePollutionSource()))
  })
}

const structuralConnectionStatuses = [
  ['array', ['connected']],
  ['plain object', { value: 'connected' }],
  ['boolean', true],
  ['boxed string', Object('connected')],
  ['custom toString', { toString: () => 'connected' }]
]

for (const [apiLabel, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot'],
  ['derive', 'deriveFleetStatusHealth']
]) {
  for (const [valueLabel, status] of structuralConnectionStatuses) {
    test(`${apiLabel} rejects ${valueLabel} connection status`, async () => {
      const model = await loadModel()
      const result = model[exportName]({
        connection: { status },
        resources: { cpu: 20 }
      })

      assert.equal(result.overallStatus, 'pending')
      if (apiLabel !== 'derive') {
        assert.equal(result.connection.status, 'pending')
      }
    })
  }
}

const structuralExplicitStatuses = [
  ['array', ['healthy']],
  ['plain object', { value: 'healthy' }],
  ['boolean', true],
  ['boxed string', Object('healthy')],
  ['custom toString', { toString: () => 'healthy' }]
]

for (const [valueLabel, status] of structuralExplicitStatuses) {
  test(`derive rejects ${valueLabel} resource status`, async () => {
    const { deriveFleetStatusHealth } = await loadModel()
    const result = deriveFleetStatusHealth({
      connection: { status: 'connected' },
      resources: { cpu: { status } }
    })

    assert.equal(result.overallStatus, 'pending')
  })

  test(`derive rejects ${valueLabel} service status`, async () => {
    const { deriveFleetStatusHealth } = await loadModel()
    const result = deriveFleetStatusHealth({
      connection: { status: 'connected' },
      services: [{ status }]
    })

    assert.equal(result.overallStatus, 'pending')
  })

  test(`worstFleetStatus rejects ${valueLabel} status`, async () => {
    const { worstFleetStatus } = await loadModel()

    assert.equal(worstFleetStatus([status]), 'pending')
  })
}

for (const [apiLabel, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot'],
  ['derive', 'deriveFleetStatusHealth']
]) {
  test(`${apiLabel} ignores inherited connection status`, async () => {
    const model = await loadModel()
    const result = model[exportName]({
      connection: Object.create({ status: 'connected' }),
      resources: { cpu: 20 }
    })

    assert.equal(result.overallStatus, 'pending')
  })
}

const inheritedHealthSources = [
  [
    'top-level probe containers',
    Object.create({
      connection: { status: 'connected' },
      resources: { cpu: 20 }
    })
  ],
  [
    'resource status',
    {
      connection: { status: 'connected' },
      resources: { cpu: Object.create({ status: 'healthy' }) }
    }
  ],
  [
    'resource usedPercent',
    {
      connection: { status: 'connected' },
      resources: { cpu: Object.create({ usedPercent: 20 }) }
    }
  ],
  [
    'service state',
    {
      connection: { status: 'connected' },
      services: [Object.create({ state: 'running' })]
    }
  ]
]

for (const [label, source] of inheritedHealthSources) {
  test(`derive ignores inherited ${label}`, async () => {
    const { deriveFleetStatusHealth } = await loadModel()
    assert.equal(deriveFleetStatusHealth(source).overallStatus, 'pending')
  })
}

function exhaustedCloneBudgetSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        samples: Array.from({ length: 2000 }, () => (
          Array.from({ length: 30 }, (_, index) => index)
        ))
      }
    },
    services: [{ name: 'agent.service', state: 'running' }],
    network: {
      interfaces: [{ name: 'eth0' }],
      dns: ['1.1.1.1']
    }
  }
}

function assertFixedArrayContracts (snapshot) {
  assert.equal(Array.isArray(snapshot.services), true)
  assert.equal(Array.isArray(snapshot.network.interfaces), true)
  assert.equal(Array.isArray(snapshot.network.dns), true)
  assert.equal(snapshot.services[0].name, 'agent.service')
  assert.equal(snapshot.network.interfaces[0].name, 'eth0')
  assert.deepEqual(snapshot.network.dns, ['1.1.1.1'])
}

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} recursively removes cookie secrets without false positives`, async () => {
    const model = await loadModel()
    assertCookieSecretsRedacted(model[exportName](cookieSensitiveSource()))
  })

  test(`${label} redacts URI userinfo for any valid scheme`, async () => {
    const model = await loadModel()
    assertUriUserinfoRedacted(model[exportName](uriUserinfoSource()))
  })

  for (const [caseLabel, input, expected] of uriUserinfoBoundaryCases) {
    test(`${label} handles URI userinfo ${caseLabel}`, async () => {
      const model = await loadModel()
      const snapshot = model[exportName]({
        connection: { status: 'connected' },
        resources: {
          cpu: { usedPercent: 20, note: input }
        }
      })

      assert.equal(snapshot.resources.cpu.note, expected)
    })
  }

  test(`${label} maps a top-level error into connection error`, async () => {
    const model = await loadModel()
    const snapshot = model[exportName](topLevelErrorSource())

    assert.equal(snapshot.connection.error, 'auth')
    assert.equal(snapshot.overallStatus, 'offline')
    assert.equal(Object.hasOwn(snapshot, 'error'), false)
    assert.equal(JSON.stringify(snapshot).includes('top-level-error-secret'), false)
  })

  test(`${label} removes compound sensitive keys without losing metrics`, async () => {
    const model = await loadModel()
    assertCompoundSensitiveKeysRedacted(
      model[exportName](compoundSensitiveKeySource())
    )
  })

  test(`${label} preserves fixed array contracts after clone budget exhaustion`, async () => {
    const model = await loadModel()
    assertFixedArrayContracts(model[exportName](exhaustedCloneBudgetSource()))
  })

  test(`${label} keeps whitespace-only resource probes pending`, async () => {
    const model = await loadModel()
    for (const kind of ['cpu', 'memory', 'disk', 'load']) {
      const snapshot = model[exportName]({
        connection: { status: 'connected' },
        resources: { [kind]: ' \t\r\n ' }
      })
      assert.equal(snapshot.overallStatus, 'pending', kind)
    }
  })
}

test('resource health rejects a shared 24-level array graph under 200ms', async () => {
  const { deriveFleetStatusHealth } = await loadModel()
  let shared = [20]
  for (let depth = 0; depth < 24; depth += 1) shared = [shared, shared]
  const cycle = [20]
  cycle.push(cycle)

  const startedAt = performance.now()
  const health = deriveFleetStatusHealth({
    connection: { status: 'connected' },
    resources: { cpu: [shared, cycle] }
  })
  const elapsedMs = performance.now() - startedAt

  assert.equal(health.overallStatus, 'pending')
  assert.ok(elapsedMs < 200, `elapsed ${elapsedMs.toFixed(2)}ms`)
})

test('snapshot clone bounds repeated traversal of a shared deep graph', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  let reads = 0
  const leaf = {}
  Object.defineProperty(leaf, 'usedPercent', {
    enumerable: true,
    get () {
      reads += 1
      return 20
    }
  })
  let shared = leaf
  for (let depth = 0; depth < 24; depth += 1) shared = [shared, shared]

  const startedAt = performance.now()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: { cpu: shared }
  })
  const elapsedMs = performance.now() - startedAt

  assert.equal(snapshot.overallStatus, 'pending')
  assert.ok(reads <= 2, `shared leaf read ${reads} times`)
  assert.ok(elapsedMs < 200, `elapsed ${elapsedMs.toFixed(2)}ms`)
  assert.notEqual(snapshot.resources.cpu, shared)
  assert.equal(snapshot.resources.cpu[1], '[SHARED]')
  assert.equal(Object.isFrozen(snapshot.resources.cpu[0]), false)
})

test('large JSON redaction handles escaped quotes and stays parseable', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const largePayload = JSON.stringify({
    apiKeyHeader: 'prefix"oversized-json-secret',
    padding: 'x'.repeat(70 * 1024)
  })
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: { cpu: { payload: largePayload } }
  })

  const parsed = JSON.parse(snapshot.resources.cpu.payload)
  assert.equal(parsed.apiKeyHeader, '[REDACTED]')
  assert.equal(snapshot.resources.cpu.payload.includes('oversized-json-secret'), false)
})

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} recursively redacts Unicode-escaped JSON`, async () => {
    const model = await loadModel()
    const payload = String.raw`{"\u0070assword":"velvet-4711","endpoint":"https:\u002f\u002falice:hunter2@example.test/path","nested":"{\"\\u0061piKeyMaterial\":\"quartz-909\"}"}`
    const snapshot = model[exportName]({
      connection: { status: 'connected' },
      resources: { cpu: { usedPercent: 20, metadataPayload: payload } }
    })
    const parsed = JSON.parse(snapshot.resources.cpu.metadataPayload)
    const nested = JSON.parse(parsed.nested)

    assert.equal(Object.hasOwn(parsed, 'password'), false)
    assert.equal(Object.hasOwn(nested, 'apiKeyMaterial'), false)
    assert.equal(
      parsed.endpoint,
      'https://alice:[REDACTED]@example.test/path'
    )
    assert.equal(JSON.stringify(snapshot).includes('velvet-4711'), false)
    assert.equal(JSON.stringify(snapshot).includes('hunter2'), false)
    assert.equal(JSON.stringify(snapshot).includes('quartz-909'), false)
  })
}

test('invalid uptime values do not become object text or healthy data', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: {
      uptime: { error: 'operation timed out with uptime-secret' }
    }
  })

  assert.equal(snapshot.resources.uptime, '')
  assert.equal(snapshot.overallStatus, 'critical')
  assert.equal(JSON.stringify(snapshot).includes('uptime-secret'), false)
})

test('snapshot replaces non-serializable values with stable safe values', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const executable = () => 'must not be retained'
  const marker = Symbol('must not be retained')
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    resources: {
      cpu: executable,
      memory: marker,
      disk: { executable, marker }
    }
  })

  assert.equal(snapshot.resources.cpu, null)
  assert.equal(snapshot.resources.memory, null)
  assert.equal(snapshot.resources.disk.executable, null)
  assert.equal(snapshot.resources.disk.marker, null)
  assert.doesNotThrow(() => JSON.stringify(snapshot))
})

test('nested error fields contain classifications instead of raw text', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected' },
    services: [{
      name: 'agent.service',
      state: 'running',
      error: 'operation timed out with password service-password'
    }],
    network: {
      interfaces: [{
        name: 'eth0',
        error: { code: 'EACCES', message: 'private network-secret' }
      }]
    }
  })
  const serialized = JSON.stringify(snapshot)

  assert.equal(snapshot.services[0].error, 'timeout')
  assert.equal(snapshot.network.interfaces[0].error, 'permission')
  assert.equal(serialized.includes('service-password'), false)
  assert.equal(serialized.includes('network-secret'), false)
})

test('classifies Error, string, and structured errors into fixed codes', async () => {
  const { classifyFleetStatusError } = await loadModel()
  const abortError = new Error('cancelled')
  abortError.name = 'AbortError'
  const cases = [
    [new Error('operation timed out after 5000ms'), 'timeout'],
    ['All configured authentication methods failed', 'auth'],
    [{ code: 'HOST_KEY_NOT_VERIFIABLE', message: 'mismatch' }, 'host-key'],
    [{ code: 'EACCES', stderr: 'contains a password that must not escape' }, 'permission'],
    [{ code: 'ENOTSUP' }, 'unsupported'],
    [abortError, 'cancelled'],
    [{ message: 'socket closed unexpectedly' }, 'unknown']
  ]

  for (const [error, expected] of cases) {
    assert.equal(classifyFleetStatusError(error), expected)
  }
  assert.deepEqual(
    [...new Set(cases.map(([error]) => classifyFleetStatusError(error)))].sort(),
    ['auth', 'cancelled', 'host-key', 'permission', 'timeout', 'unknown', 'unsupported']
  )
})

function plaintextSecretAssignmentSource () {
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        note: [
          'secretKey=velvet-4101',
          'clientSecretKey: quartz-4102',
          'stack="ember-4103"',
          'sshpass=cobalt-4104',
          'secretKeyCount=7',
          'clientSecretKeyStatus=rotated',
          'stackCount=2',
          'stackStatus=complete',
          'sshpassEnabled=true',
          'sshpassCount=3'
        ].join('; ')
      }
    }
  }
}

function assertPlaintextSecretAssignmentsRedacted (snapshot) {
  const note = snapshot.resources.cpu.note
  for (const marker of [
    'velvet-4101',
    'quartz-4102',
    'ember-4103',
    'cobalt-4104'
  ]) {
    assert.equal(note.includes(marker), false, marker)
  }
  for (const assignment of [
    'secretKeyCount=7',
    'clientSecretKeyStatus=rotated',
    'stackCount=2',
    'stackStatus=complete',
    'sshpassEnabled=true',
    'sshpassCount=3'
  ]) {
    assert.equal(note.includes(assignment), true, assignment)
  }
  assert.equal(note.includes('secretKey=[REDACTED]'), true)
  assert.equal(note.includes('clientSecretKey: [REDACTED]'), true)
  assert.equal(note.includes('stack=[REDACTED]'), true)
  assert.equal(note.includes('sshpass=[REDACTED]'), true)
}

function jsonStringRootSource () {
  const unicodeObjectText = String.raw`{"\u0073ecretKey":"maple-4301","nested":"{\"\\u0073tack\":\"cedar-4302\",\"stackStatus\":\"ready\"}"}`
  return {
    connection: { status: 'connected' },
    resources: {
      cpu: {
        usedPercent: 20,
        stringRoot: JSON.stringify('clientSecretKey=amber-4201'),
        doubleEncoded: JSON.stringify(JSON.stringify({
          secretKey: 'indigo-4202',
          safe: 'kept'
        })),
        unicodeEnvelope: JSON.stringify(unicodeObjectText)
      }
    }
  }
}

function assertJsonStringRootsRedacted (snapshot) {
  const cpu = snapshot.resources.cpu
  const stringRoot = JSON.parse(cpu.stringRoot)
  const doubleEncoded = JSON.parse(JSON.parse(cpu.doubleEncoded))
  const unicodeObject = JSON.parse(JSON.parse(cpu.unicodeEnvelope))
  const unicodeNested = JSON.parse(unicodeObject.nested)

  assert.equal(stringRoot, 'clientSecretKey=[REDACTED]')
  assert.equal(Object.hasOwn(doubleEncoded, 'secretKey'), false)
  assert.equal(doubleEncoded.safe, 'kept')
  assert.equal(Object.hasOwn(unicodeObject, 'secretKey'), false)
  assert.equal(Object.hasOwn(unicodeNested, 'stack'), false)
  assert.equal(unicodeNested.stackStatus, 'ready')
  const serialized = JSON.stringify(snapshot)
  for (const marker of [
    'amber-4201',
    'indigo-4202',
    'maple-4301',
    'cedar-4302'
  ]) {
    assert.equal(serialized.includes(marker), false, marker)
  }
}

const adjacentUrlInput =
  'https://alice:velvet-4401@one.test,' +
  'https://bob:quartz-4402@two.test:8443/path?owner=ops@example.test'
const adjacentUrlExpected =
  'https://alice:[REDACTED]@one.test,' +
  'https://bob:[REDACTED]@two.test:8443/path?owner=ops@example.test'

for (const [label, exportName] of [
  ['create', 'createFleetStatusSnapshot'],
  ['normalize', 'normalizeFleetStatusSnapshot']
]) {
  test(`${label} redacts plaintext secret assignments without false positives`, async () => {
    const model = await loadModel()
    assertPlaintextSecretAssignmentsRedacted(
      model[exportName](plaintextSecretAssignmentSource())
    )
  })

  test(`${label} redacts every adjacent comma-separated URL userinfo`, async () => {
    const model = await loadModel()
    const snapshot = model[exportName]({
      connection: { status: 'connected' },
      resources: { cpu: { usedPercent: 20, note: adjacentUrlInput } }
    })

    assert.equal(snapshot.resources.cpu.note, adjacentUrlExpected)
  })

  test(`${label} recursively redacts valid JSON string roots`, async () => {
    const model = await loadModel()
    assertJsonStringRootsRedacted(model[exportName](jsonStringRootSource()))
  })
}

const inheritedErrorCases = [
  ['code', Object.create({ code: 'ETIMEDOUT' })],
  ['message', Object.create({ message: 'HTTP 401 Unauthorized' })],
  ['status', Object.create({ status: 'cancelled' })],
  ['cause', Object.create({ cause: { code: 'EACCES' } })],
  [
    'fields on an own cause',
    { cause: Object.create({ message: 'command not found' }) }
  ]
]

for (const [label, error] of inheritedErrorCases) {
  test(`classifyFleetStatusError ignores inherited ${label}`, async () => {
    const { classifyFleetStatusError } = await loadModel()
    assert.equal(classifyFleetStatusError(error), 'unknown')
  })
}

test('snapshot bounds 2000 repeated 60 KiB JSON strings', async () => {
  const { createFleetStatusSnapshot } = await loadModel()
  const marker = 'topaz-4501'
  const repeatedPayload = JSON.stringify({
    clientSecretKey: marker,
    padding: 'x'.repeat(60 * 1024)
  })
  const startedAt = performance.now()
  const snapshot = createFleetStatusSnapshot({
    connection: { status: 'connected', latencyMs: 8 },
    resources: {
      cpu: {
        usedPercent: 20,
        samples: Array(2000).fill(repeatedPayload)
      },
      uptime: 5
    },
    services: [{ name: 'agent.service', state: 'running' }],
    network: {
      interfaces: [{ name: 'eth0' }],
      defaultRoute: '10.0.0.1',
      dns: ['1.1.1.1']
    },
    firewall: { provider: 'nftables', enabled: true },
    collectedAt: '2026-07-16T00:00:00.000Z'
  })
  const serialized = JSON.stringify(snapshot)
  const elapsedMs = performance.now() - startedAt
  const outputBytes = Buffer.byteLength(serialized)

  assert.ok(
    outputBytes <= 1024 * 1024,
    `output ${outputBytes} bytes; elapsed ${elapsedMs.toFixed(2)}ms`
  )
  assert.ok(elapsedMs < 1000, `elapsed ${elapsedMs.toFixed(2)}ms`)
  assert.equal(serialized.includes(marker), false)
  assert.equal(JSON.stringify(snapshot), serialized)

  const parsed = JSON.parse(serialized)
  assert.deepEqual(Object.keys(parsed), [
    'connection',
    'resources',
    'services',
    'network',
    'firewall',
    'collectedAt',
    'overallStatus'
  ])
  assert.equal(parsed.connection.status, 'connected')
  assert.equal(parsed.resources.cpu.usedPercent, 20)
  assert.equal(parsed.resources.cpu.samples.length, 2000)
  assert.equal(parsed.services[0].name, 'agent.service')
  assert.equal(parsed.network.interfaces[0].name, 'eth0')
  assert.deepEqual(parsed.network.dns, ['1.1.1.1'])
  assert.equal(parsed.firewall.provider, 'nftables')
  assert.equal(parsed.collectedAt, '2026-07-16T00:00:00.000Z')
  assert.equal(parsed.overallStatus, 'healthy')
})
