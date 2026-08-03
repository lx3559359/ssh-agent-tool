const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classifyAddress,
  inspectWebTarget,
  normalizeWebOrigin
} = require('../../src/app/lib/ai-content/web-access-policy')

test('classifies public private loopback and dangerous IPv4 targets', () => {
  const cases = [
    ['8.8.8.8', 'public'],
    ['10.2.3.4', 'private'],
    ['100.64.2.3', 'private'],
    ['172.16.1.1', 'private'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'dangerous'],
    ['100.100.100.200', 'dangerous'],
    ['0.0.0.0', 'dangerous'],
    ['192.0.2.1', 'dangerous'],
    ['198.18.0.1', 'dangerous'],
    ['224.0.0.1', 'dangerous'],
    ['255.255.255.255', 'dangerous']
  ]

  for (const [address, expected] of cases) {
    assert.equal(classifyAddress(address), expected, address)
  }
})

test('classifies IPv6 ULA loopback mapped and reserved targets', () => {
  const cases = [
    ['2001:4860:4860::8888', 'public'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:192.168.1.2', 'private'],
    ['::ffff:8.8.8.8', 'public'],
    ['::', 'dangerous'],
    ['fe80::1', 'dangerous'],
    ['fec0::1', 'dangerous'],
    ['ff02::1', 'dangerous'],
    ['2001:db8::1', 'dangerous']
  ]

  for (const [address, expected] of cases) {
    assert.equal(classifyAddress(address), expected, address)
  }
})

test('uses the strictest DNS result and returns a normalized origin', async () => {
  const result = await inspectWebTarget(
    'http://Router.Internal:8080/admin?secret=x#panel',
    {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.1', family: 4 }
      ],
      isOriginGranted: async () => false
    }
  )

  assert.equal(result.decision, 'authorization-required')
  assert.equal(result.target.addressClass, 'private')
  assert.equal(result.target.origin, 'http://router.internal:8080')
  assert.deepEqual(result.target.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '192.168.1.1', family: 4 }
  ])
  assert.equal(
    normalizeWebOrigin('https://Example.com:443/path'),
    'https://example.com'
  )
  assert.equal(
    normalizeWebOrigin('http://Example.com:8080/path'),
    'http://example.com:8080'
  )
})

test('classifies localhost by name as loopback even with a public DNS answer', async () => {
  const result = await inspectWebTarget('http://localhost:3000/app', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    isOriginGranted: async () => false
  })

  assert.equal(result.decision, 'authorization-required')
  assert.equal(result.target.addressClass, 'loopback')
  assert.equal(result.target.origin, 'http://localhost:3000')
})

test('returns allow-public and allow-granted decisions without weakening blocks', async () => {
  const publicResult = await inspectWebTarget('https://example.com/path', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }]
  })
  assert.equal(publicResult.decision, 'allow-public')
  assert.equal(publicResult.reason, 'public-target')

  const granted = await inspectWebTarget('http://kb.internal/app', {
    lookup: async () => [{ address: '10.1.2.3', family: 4 }],
    isOriginGranted: async (origin, target) => {
      assert.equal(origin, 'http://kb.internal')
      assert.equal(target.addressClass, 'private')
      return true
    }
  })
  assert.equal(granted.decision, 'allow-granted')

  let grantChecks = 0
  const dangerous = await inspectWebTarget(
    'http://metadata.internal/latest?token=secret#fragment',
    {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 }
      ],
      isOriginGranted: async () => {
        grantChecks += 1
        return true
      }
    }
  )
  assert.equal(dangerous.decision, 'blocked')
  assert.equal(dangerous.target.addressClass, 'dangerous')
  assert.equal(grantChecks, 0)
})

test('rejects unsupported protocols credentials and port zero with safe details', async () => {
  const cases = [
    ['file:///etc/passwd', /http|https/i],
    ['ftp://example.com/file', /http|https/i],
    ['javascript:alert(1)', /http|https/i],
    ['data:text/plain,secret', /http|https/i],
    ['blob:https://example.com/id', /http|https/i],
    ['https://user:password@example.com/private?token=x', /credential/i],
    ['http://example.com:0/', /port/i]
  ]

  for (const [url, message] of cases) {
    await assert.rejects(
      inspectWebTarget(url, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }]
      }),
      error => {
        assert.equal(error.code, 'WEB_ACCESS_BLOCKED')
        assert.match(error.message, message)
        const serialized = JSON.stringify(error.details)
        assert.doesNotMatch(
          serialized,
          /private\?token|password|user:|\/etc\/passwd|alert\(1\)/i
        )
        return true
      }
    )
  }
})

test('wraps empty and failed DNS lookups as safe network errors', async () => {
  for (const lookup of [
    async () => [],
    async () => {
      throw new Error('resolver leaked query token=secret')
    }
  ]) {
    await assert.rejects(
      inspectWebTarget('https://missing.example/path?token=secret', { lookup }),
      error => {
        assert.equal(error.code, 'WEB_NETWORK_ERROR')
        assert.equal(error.details.origin, 'https://missing.example')
        assert.doesNotMatch(error.message, /token=secret|resolver leaked/i)
        return true
      }
    )
  }
})
