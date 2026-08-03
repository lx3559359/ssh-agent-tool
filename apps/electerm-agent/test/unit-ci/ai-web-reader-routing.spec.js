const test = require('node:test')
const assert = require('node:assert/strict')

const {
  evaluateWebContentQuality,
  extractHtmlTitle
} = require('../../src/app/lib/ai-content/web-reader')

test('routes useful static content without a browser', () => {
  const detail = 'Operational detail '.repeat(30)
  const result = evaluateWebContentQuality({
    url: 'https://example.com/article',
    html: '<html><title>Report</title><body><h1>Report</h1><p>' +
      detail + '</p></body></html>',
    text: 'Report\n' + detail
  })

  assert.deepEqual(result, {
    requiresBrowser: false,
    browserReason: ''
  })
})

test('keeps short meaningful plain text and JSON on the static path', () => {
  for (const input of [
    {
      url: 'https://status.example.com/health',
      html: '',
      text: 'status: healthy'
    },
    {
      url: 'https://api.example.com/status',
      html: '',
      text: '{"status":"healthy"}'
    },
    {
      url: 'https://example.com/notice',
      html: '<p>Maintenance starts at 22:00 UTC.</p>',
      text: 'Maintenance starts at 22:00 UTC.'
    }
  ]) {
    assert.equal(
      evaluateWebContentQuality(input).requiresBrowser,
      false,
      input.url
    )
  }
})

test('routes SPA mount shells to the browser', () => {
  const cases = [
    {
      url: 'https://example.com/app',
      html: '<div id="root"></div><script src="/runtime.js"></script>' +
        '<script src="/app.js"></script>',
      text: ''
    },
    {
      url: 'https://example.com/dashboard',
      html: '<main id="app">Loading...</main><script src="/app.js"></script>',
      text: 'Loading...'
    },
    {
      url: 'https://example.com/portal',
      html: '<noscript>Please enable JavaScript to continue.</noscript>',
      text: 'Please enable JavaScript to continue.'
    }
  ]

  for (const input of cases) {
    const result = evaluateWebContentQuality(input)
    assert.equal(result.requiresBrowser, true, input.url)
    assert.match(
      result.browserReason,
      /empty-content|spa-shell|javascript-required/
    )
  }
})

test('routes hash applications but not ordinary document anchors', () => {
  assert.deepEqual(evaluateWebContentQuality({
    url: 'https://example.com/app#/sharingPath',
    html: '<div id="app">Application</div>',
    text: 'Application'
  }), {
    requiresBrowser: true,
    browserReason: 'hash-route'
  })

  assert.equal(evaluateWebContentQuality({
    url: 'https://example.com/article#section-two',
    html: '<h1>Article</h1><p>Short but meaningful.</p>',
    text: 'Article\nShort but meaningful.'
  }).requiresBrowser, false)
})

test('routes login forms and login shells to the browser', () => {
  for (const input of [
    {
      url: 'https://example.com/login',
      html: '<form><input name="user"><input type="password"></form>',
      text: 'Sign in'
    },
    {
      url: 'https://example.com/auth',
      html: '<main>登录后查看知识库</main>',
      text: '登录后查看知识库'
    }
  ]) {
    assert.deepEqual(evaluateWebContentQuality(input), {
      requiresBrowser: true,
      browserReason: 'login-required'
    })
  }
})

test('extracts and decodes the HTML title before text fallback', () => {
  assert.equal(
    extractHtmlTitle(
      '<html><head><title>Knowledge &amp; Operations</title></head></html>'
    ),
    'Knowledge & Operations'
  )
  assert.equal(extractHtmlTitle('<html><body>No title</body></html>'), '')
})
