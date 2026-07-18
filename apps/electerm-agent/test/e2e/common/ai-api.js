const express = require('express')

const DEFAULT_PORT = 43434

function extractUserInput (message) {
  const match = String(message || '').match(/user input: "([^"]*)"/)
  return match ? match[1] : ''
}

function generateTestCommands (userInput) {
  return Array.from({ length: 5 }, (_, index) => `${userInput}-test-command-${index + 1}`)
}

function generateTestBookmark (description) {
  return {
    title: 'Test Server',
    host: 'test.example.com',
    port: 22,
    username: 'testuser',
    type: 'ssh',
    description
  }
}

function mockResponse () {
  return '# Response to your query\n\n' +
    'Here is a sample response with different markdown elements:\n\n' +
    '## Code Example\n' +
    '```javascript\n' +
    'console.log("Hello World!");\n' +
    '```\n\n' +
    '## List Example\n' +
    '- Item 1\n' +
    '- Item 2\n' +
    '- Item 3\n\n' +
    '## Text Formatting\n' +
    '**Bold text** and *italic text*\n\n' +
    '> This is a blockquote\n\n' +
    '[This is a link](https://example.com)'
}

function createLocalAiApp (options = {}) {
  const app = express()
  const state = options.state || {
    requests: 0,
    aborted: 0,
    completed: 0,
    firstChunkAt: 0
  }
  app.use(express.json({ limit: '2mb' }))
  app.use((req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }
    next()
  })
  app.post('/chat/completions', (req, res) => {
    state.requests += 1
    req.on('aborted', () => { state.aborted += 1 })
    const messages = Array.isArray(req.body.messages) ? req.body.messages : []
    const lastMessage = String(messages.at(-1)?.content || '')
    if (lastMessage.includes('give me max 5 command suggestions for user input')) {
      return res.json({
        choices: [{ message: { content: JSON.stringify(generateTestCommands(extractUserInput(lastMessage))) } }]
      })
    }
    if (lastMessage.includes('Generate the bookmark JSON')) {
      return res.json({
        choices: [{ message: { content: JSON.stringify(generateTestBookmark(lastMessage), null, 2) } }]
      })
    }
    if (!req.body.stream) {
      return res.json({ choices: [{ message: { content: mockResponse() } }] })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const chunks = mockResponse().split(' ')
    const delayMs = Number(options.chunkDelayMs) || 25
    let index = 0
    let completed = false
    res.once('close', () => {
      if (!completed) state.aborted += 1
    })
    const sendChunk = () => {
      if (res.destroyed || res.writableEnded) return
      if (index >= chunks.length) {
        completed = true
        state.completed += 1
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      if (!state.firstChunkAt) state.firstChunkAt = Date.now()
      const content = chunks[index] + (index < chunks.length - 1 ? ' ' : '')
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      index += 1
      setTimeout(sendChunk, delayMs)
    }
    setTimeout(sendChunk, Number(options.firstChunkDelayMs) || delayMs)
  })
  return { app, state }
}

async function startLocalAiServer (options = {}) {
  const { app, state } = createLocalAiApp(options)
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(options.port ?? 0, '127.0.0.1', () => resolve(listening))
    listening.once('error', reject)
  })
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

if (require.main === module) {
  const { app } = createLocalAiApp()
  app.listen(DEFAULT_PORT, '127.0.0.1')
}

module.exports = {
  createLocalAiApp,
  startLocalAiServer
}
