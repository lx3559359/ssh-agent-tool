const http = require('node:http')

const DEFAULT_SENTENCE = 'ShellPilot isolated SPA knowledge is available for the authorized operator.'
const AUTH_COOKIE = 'sp_ai_auth=authorized'

function sendHtml (response, html, statusCode = 200, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  })
  response.end(html)
}

function createCounters () {
  return {
    total: 0,
    static: 0,
    app: 0,
    appScript: 0,
    login: 0,
    logout: 0,
    redirect: 0,
    blockedSubresource: 0
  }
}

function hasAuthorizationCookie (request) {
  return String(request.headers.cookie || '')
    .split(';')
    .some(value => value.trim() === AUTH_COOKIE)
}

function validateRedirectTarget (value) {
  const target = new URL(String(value || ''))
  if (
    target.protocol !== 'http:' ||
    target.hostname !== '127.0.0.1'
  ) {
    throw new Error('AI web fixture redirects must target 127.0.0.1 HTTP.')
  }
  return target.toString()
}

async function startAIWebFixture ({ sentence = DEFAULT_SENTENCE } = {}) {
  const counters = createCounters()
  let redirectTarget = ''
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    counters.total += 1

    if (requestUrl.pathname === '/static') {
      counters.static += 1
      sendHtml(response, [
        '<!doctype html><html><head><title>Static Knowledge</title></head>',
        '<body><main><h1>Static Knowledge</h1><p>',
        'Deterministic public-style fixture content. '.repeat(20),
        '</p></main></body></html>'
      ].join(''))
      return
    }

    if (requestUrl.pathname === '/app' && request.method === 'GET') {
      counters.app += 1
      if (!hasAuthorizationCookie(request)) {
        sendHtml(response, [
          '<!doctype html><html><head><title>Fixture Sign In</title></head>',
          '<body><main><h1>Sign in</h1>',
          '<form method="post" action="/login">',
          '<label>Account <input name="account" autocomplete="username"></label>',
          '<label>Password <input name="password" type="password" autocomplete="current-password"></label>',
          '<button type="submit">Sign in</button>',
          '</form></main></body></html>'
        ].join(''))
        return
      }
      sendHtml(response, [
        '<!doctype html><html><head><title>Authorized Knowledge</title></head>',
        '<body><main id="app">Loading…</main>',
        '<script src="/app.js"></script>',
        '<script src="/blocked-subresource.js"></script>',
        '</body></html>'
      ].join(''))
      return
    }

    if (requestUrl.pathname === '/app.js') {
      counters.appScript += 1
      response.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      response.end([
        'setTimeout(() => {',
        `document.getElementById('app').textContent = ${JSON.stringify(sentence)}`,
        '}, 40)'
      ].join('\n'))
      return
    }

    if (requestUrl.pathname === '/blocked-subresource.js') {
      counters.blockedSubresource += 1
      response.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      response.end('window.__fixtureSubresourceLoaded = true')
      return
    }

    if (requestUrl.pathname === '/login' && request.method === 'POST') {
      counters.login += 1
      let bytes = 0
      request.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 8192) request.destroy()
      })
      request.on('end', () => {
        response.writeHead(303, {
          Location: '/app#/sharingPath',
          'Set-Cookie': `${AUTH_COOKIE}; HttpOnly; SameSite=Lax; Path=/`,
          'Cache-Control': 'no-store'
        })
        response.end()
      })
      return
    }

    if (requestUrl.pathname === '/logout') {
      counters.logout += 1
      response.writeHead(303, {
        Location: '/app',
        'Set-Cookie': 'sp_ai_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        'Cache-Control': 'no-store'
      })
      response.end()
      return
    }

    if (requestUrl.pathname === '/redirect') {
      counters.redirect += 1
      if (!redirectTarget) {
        response.writeHead(503, { 'Content-Type': 'text/plain' })
        response.end('Redirect target unavailable')
        return
      }
      response.writeHead(302, {
        Location: redirectTarget,
        'Cache-Control': 'no-store'
      })
      response.end()
      return
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    sentence,
    urls: {
      static: `${origin}/static`,
      app: `${origin}/app#/sharingPath`,
      redirect: `${origin}/redirect`
    },
    setRedirectTarget (value) {
      redirectTarget = validateRedirectTarget(value)
    },
    snapshot () {
      return { ...counters }
    },
    close () {
      return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

module.exports = {
  AUTH_COOKIE,
  DEFAULT_SENTENCE,
  startAIWebFixture
}
