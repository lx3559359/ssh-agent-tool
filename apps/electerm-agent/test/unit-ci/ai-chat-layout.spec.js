const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('AI chat history keeps a stable scroll container when history is empty', () => {
  const source = read('src/client/components/ai/ai-chat-history.jsx')

  assert.match(source, /className='ai-history-wrap ai-history-empty'/)
  assert.doesNotMatch(source, /return <div \/>/)
})

test('AI chat layout lets history scroll while the input remains fixed at the bottom', () => {
  const style = read('src/client/components/ai/ai.styl')

  assert.match(style, /\.ai-chat-history[\s\S]*?display flex/)
  assert.match(style, /\.ai-chat-history[\s\S]*?overflow hidden/)
  assert.match(style, /\.ai-history-wrap[\s\S]*?overflow-y auto/)
  assert.match(style, /\.ai-chat-input[\s\S]*?flex 0 0 auto/)
})

test('session takeover controls wrap inside the current AI header dimensions', () => {
  const aiStyle = read('src/client/components/ai/ai.styl')
  const panelStyle = read('src/client/components/side-panel-r/right-side-panel.styl')

  assert.match(aiStyle, /\.agent-takeover-controls[\s\S]*?max-width 100%/)
  assert.match(aiStyle, /@media \(max-width: 780px\)/)
  assert.doesNotMatch(aiStyle, /agent-takeover[^\n]*width\s+\d+px/)
  assert.doesNotMatch(panelStyle, /agent-takeover[^\n]*width\s+\d+px/)
})

test('Agent send affordance spins only while the task registry reports a real run', () => {
  const aiChatSource = read('src/client/components/ai/ai-chat.jsx')

  assert.match(aiChatSource, /const agentRunning = activeEndpoint[\s\S]*?agentTaskRegistry\.isEndpointBusy\(activeEndpoint\)[\s\S]*?agentTaskRegistry\.isScopeBusy\(conversationScopeId\)/)
  assert.match(aiChatSource, /const submitDisabled = isAgent && agentRunning/)
  assert.match(aiChatSource, /if \(submitDisabled\)[\s\S]*?<LoadingOutlined[\s\S]*?spin[\s\S]*?agent-send-running/)
  assert.doesNotMatch(aiChatSource, /if \(submitDisabled\)[\s\S]{0,180}<SendOutlined/)
  assert.match(aiChatSource, /<SendOutlined[\s\S]*?onClick=\{handleSubmit\}[\s\S]*?send-to-ai-icon/)
})

test('Agent registry completion failure cancellation and registration cleanup restore Send', async () => {
  const registryUrl = pathToFileURL(path.join(
    root,
    'src/client/components/ai/agent-task-registry.js'
  )).href
  const { createAgentTaskRegistry } = await import(registryUrl)
  const endpoint = {
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    host: 'srv.test',
    port: 22,
    username: 'root',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const registry = createAgentTaskRegistry()
  const register = (taskId, cancel = async () => true) => registry.register({
    taskId,
    endpoint,
    scopeId: 'tab-a',
    kind: 'chat-agent',
    controller: { abort () {} },
    runner: { cancel }
  })

  for (const terminalState of ['completed', 'failed', 'cancelled']) {
    register(terminalState)
    assert.equal(registry.isEndpointBusy(endpoint), true)
    registry.unregister(terminalState)
    assert.equal(registry.isEndpointBusy(endpoint), false)
  }

  register('cancel-via-registry')
  await registry.cancel('cancel-via-registry')
  assert.equal(registry.isEndpointBusy(endpoint), false)

  register('first')
  assert.throws(
    () => register('registration-failed'),
    error => error.code === 'AI_AGENT_SESSION_BUSY'
  )
  registry.unregister('first')
  assert.equal(registry.isEndpointBusy(endpoint), false)

  const agentSource = read('src/client/components/ai/agent.js')
  assert.match(agentSource, /finally \{[\s\S]*?agentTaskRegistry\.unregister\(taskId\)/)
})

test('Agent stop remains independent from the send running affordance', () => {
  const historyItem = read('src/client/components/ai/ai-chat-history-item.jsx')
  const stopIcon = read('src/client/components/ai/ai-stop-icon.jsx')

  assert.match(historyItem, /<AIStopIcon[\s\S]*?onClick=\{handleStop\}/)
  assert.match(stopIcon, /onClick=\{props\.onClick\}/)
  assert.doesNotMatch(stopIcon, /agent-send-running|submitDisabled/)
})
