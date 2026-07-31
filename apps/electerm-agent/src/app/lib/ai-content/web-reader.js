const http = require('node:http')
const https = require('node:https')
const { assertSafePublicUrl } = require('./url-safety')

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_CHARS = 80000
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 12000

function decodeEntities (value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => (
      String.fromCharCode(Number(code))
    ))
}

function htmlToText (html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function createPinnedLookup (address, family) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    if (options?.all) {
      callback(null, [{ address, family }])
      return
    }
    callback(null, address, family)
  }
}

function requestPinned ({ url, address, family }) {
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html, text/plain, application/json;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'ShellPilot/AI-Web-Reader'
      },
      lookup: createPinnedLookup(address, family)
    }, response => {
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('网页内容超过 2 MB 读取上限。'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      })
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('网页读取超时。'))
    })
    request.on('error', reject)
    request.end()
  })
}

async function readPublicWebPage (input, redirects = 0) {
  const safe = await assertSafePublicUrl(input)
  const target = safe.addresses[0]
  const response = await requestPinned({
    url: safe.url,
    address: target.address,
    family: target.family
  })
  if (
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location
  ) {
    if (redirects >= MAX_REDIRECTS) {
      throw new Error('网页重定向次数过多。')
    }
    return readPublicWebPage(
      new URL(response.headers.location, safe.url).toString(),
      redirects + 1
    )
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`网页返回 HTTP ${response.statusCode}。`)
  }

  const contentType = String(response.headers['content-type'] || '')
  const rawText = /html/i.test(contentType)
    ? htmlToText(response.body)
    : response.body
  const truncated = rawText.length > MAX_TEXT_CHARS
  return {
    kind: 'web',
    url: safe.url.toString(),
    title: rawText.match(/^[^\n]{1,160}/)?.[0] || safe.url.hostname,
    text: truncated ? rawText.slice(0, MAX_TEXT_CHARS) : rawText,
    truncated
  }
}

module.exports = {
  readPublicWebPage,
  htmlToText,
  createPinnedLookup
}
