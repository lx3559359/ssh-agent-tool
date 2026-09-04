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

test('AI composer exposes a fixed shared stop control for chat and Agent', () => {
  const aiChatSource = read('src/client/components/ai/ai-chat.jsx')
  const stopIcon = read('src/client/components/ai/ai-stop-icon.jsx')
  const style = read('src/client/components/ai/ai.styl')

  assert.match(aiChatSource, /const agentRunning = activeEndpoint[\s\S]*?agentTaskRegistry\.isEndpointBusy\(activeEndpoint\)[\s\S]*?agentTaskRegistry\.isScopeBusy\(conversationScopeId\)/)
  assert.match(aiChatSource, /getActiveAIChatRun\(visibleHistory\)/)
  assert.match(aiChatSource, /cancelScopedAIChatRun\(\{/)
  assert.match(aiChatSource, /getAgentComposerActionState\(\{[\s\S]*?isAgent,[\s\S]*?agentRunning,[\s\S]*?disabled: submitDisabled/)
  assert.match(aiChatSource, /\['stop', 'stopping'\]\.includes\(composerActionState\.kind\)[\s\S]*?<AIStopIcon/)
  assert.match(aiChatSource, /<SendOutlined[\s\S]*?composerActionState\.disabled[\s\S]*?send-to-ai-icon/)
  assert.match(stopIcon, /aria-label=/)
  assert.match(stopIcon, /StopOutlined/)
  assert.match(style, /\.ai-stop-icon-square[\s\S]*?width 28px[\s\S]*?height 28px/)
})

test('AI prompt updates reuse scoped history and keep the history subtree memoized', () => {
  const aiChat = read('src/client/components/ai/ai-chat.jsx')
  const history = read('src/client/components/ai/ai-chat-history.jsx')

  assert.match(
    aiChat,
    /const visibleHistory = useMemo\(\s*\(\) => getAIChatHistoryForScope\([\s\S]*?props\.aiChatHistory,[\s\S]*?conversationScopeId[\s\S]*?\),\s*\[props\.aiChatHistory, conversationScopeId\]\s*\)/
  )
  assert.match(aiChat, /getActiveAIChatRun\(visibleHistory\)/)
  assert.match(
    aiChat,
    /const activeAIConfig = useMemo\(\s*\(\) => getActiveAIConfig\(stableConfig\),\s*\[stableConfig\]\s*\)/
  )
  assert.match(aiChat, /<AiChatHistory[\s\S]*?history=\{visibleHistory\}[\s\S]*?config=\{stableConfig\}/)
  assert.match(history, /auto\(function AIChatHistory \(\{\s*history,\s*agentRunning,\s*config = \{\}\s*\}\)/)
  assert.doesNotMatch(history, /window\.store\?\.config/)
})

test('loaded AI surfaces stay mounted while the right panel is hidden or switched', () => {
  const aiChat = read('src/client/components/ai/ai-chat.jsx')
  const aiStyle = read('src/client/components/ai/ai.styl')
  const panel = read('src/client/components/side-panel-r/side-panel-r.jsx')
  const panelStyle = read('src/client/components/side-panel-r/right-side-panel.styl')

  assert.match(panel, /const hasBeenVisibleRef = useRef\(rightPanelVisible\)/)
  assert.match(panel, /right-side-panel-hidden/)
  assert.match(panel, /inert: !rightPanelVisible/)
  assert.doesNotMatch(panel, /if \(!rightPanelVisible\) \{\s*return null\s*\}/)
  assert.match(
    panelStyle,
    /\.right-side-panel-hidden\s+visibility hidden\s+pointer-events none\s+overflow hidden/
  )
  assert.doesNotMatch(panelStyle, /\.right-side-panel-hidden\s+display none/)
  assert.match(panelStyle, /\.right-side-panel-content[\s\S]*?position static/)
  assert.match(panelStyle, /\.right-side-panel-content-stacked[\s\S]*?display grid/)
  assert.match(panel, /right-side-panel-content-stacked/)
  assert.match(aiChat, /const aiPanelVisible = props\.rightPanelTab === 'ai'/)
  assert.match(aiChat, /ai-chat-container-hidden/)
  assert.match(aiChat, /inert=\{!aiPanelVisible\}/)
  assert.doesNotMatch(aiChat, /if \(props\.rightPanelTab !== 'ai'\) \{\s*return null\s*\}/)
  assert.match(aiStyle, /\.ai-chat-container-hidden\s+visibility hidden\s+pointer-events none/)
  assert.doesNotMatch(aiStyle, /\.ai-chat-container-hidden\s+display none/)
})

test('AI chat entry skips shell-only rerenders without hiding meaningful prop changes', async () => {
  const { areAIChatEntryPropsEqual, haveSameAIConfig } = await import(pathToFileURL(path.join(
    root,
    'src/client/components/ai/ai-chat-entry-props.js'
  )))
  const tab = { id: 'tab-a' }
  const history = [{ id: 'history-a' }]
  const config = {
    activeAIProfileId: 'profile-a',
    aiProfiles: [{ id: 'profile-a', modelAI: 'model-a' }]
  }
  const previous = {
    activeTabId: 'tab-a',
    aiChatHistory: history,
    config,
    conversationScopeId: 'tab-a',
    rightPanelTab: 'ai',
    selectedTabIds: ['tab-a'],
    tabs: [tab]
  }

  assert.equal(areAIChatEntryPropsEqual(previous, {
    ...previous,
    config: {
      activeAIProfileId: 'profile-a',
      aiProfiles: [{ id: 'profile-a', modelAI: 'model-a' }]
    },
    selectedTabIds: ['tab-a'],
    tabs: [tab]
  }), true)
  assert.equal(areAIChatEntryPropsEqual(previous, {
    ...previous,
    config: {
      activeAIProfileId: 'profile-a',
      aiProfiles: [{ id: 'profile-a', modelAI: 'model-b' }]
    }
  }), false)
  assert.equal(areAIChatEntryPropsEqual(previous, {
    ...previous,
    aiChatHistory: [...history]
  }), false)
  assert.equal(areAIChatEntryPropsEqual(previous, {
    ...previous,
    tabs: [{ id: 'tab-a' }]
  }), false)

  assert.equal(haveSameAIConfig(config, {
    activeAIProfileId: 'profile-a',
    aiProfiles: [{ id: 'profile-a', modelAI: 'model-a' }]
  }), true)
  assert.equal(haveSameAIConfig(config, {
    activeAIProfileId: 'profile-a',
    aiProfiles: [{ id: 'profile-a', modelAI: 'model-b' }]
  }), false)

  const entry = read('src/client/components/ai/ai-chat-entry.jsx')
  const chat = read('src/client/components/ai/ai-chat.jsx')
  assert.match(entry, /memo\(AIChatEntry, areAIChatEntryPropsEqual\)/)
  assert.match(chat, /stableConfigRef = useRef\(props\.config\)/)
  assert.match(chat, /haveSameAIConfig\(stableConfigRef\.current, props\.config\)/)
  assert.match(chat, /config=\{stableConfig\}/)
})

test('composer state renders disabled Send without pretending a task is running', async () => {
  const submitUrl = pathToFileURL(path.join(
    root,
    'src/client/components/ai/ai-chat-submit.js'
  )).href
  const { getAgentComposerActionState } = await import(submitUrl)

  assert.deepEqual(getAgentComposerActionState({
    isAgent: true,
    agentRunning: false,
    disabled: true
  }), { kind: 'send', disabled: true })
  assert.deepEqual(getAgentComposerActionState({
    isAgent: false,
    agentRunning: true,
    disabled: true
  }), { kind: 'send', disabled: true })
})

test('Agent registry completion failure cancellation and registration cleanup restore Send', async () => {
  const registryUrl = pathToFileURL(path.join(
    root,
    'src/client/components/ai/agent-task-registry.js'
  )).href
  const submitUrl = pathToFileURL(path.join(
    root,
    'src/client/components/ai/ai-chat-submit.js'
  )).href
  const [registryModule, submitModule] = await Promise.all([
    import(registryUrl),
    import(submitUrl)
  ])
  const { createAgentTaskRegistry } = registryModule
  const { getAgentComposerActionState } = submitModule
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
  const action = (disabled = false) => getAgentComposerActionState({
    isAgent: true,
    agentRunning: registry.isEndpointBusy(endpoint),
    disabled
  })

  assert.deepEqual(action(), { kind: 'send', disabled: false })

  for (const terminalState of ['completed', 'failed', 'cancelled']) {
    register(terminalState)
    assert.deepEqual(action(), { kind: 'loading', disabled: true })
    registry.unregister(terminalState)
    assert.deepEqual(action(), { kind: 'send', disabled: false })
  }

  register('cancel-via-registry')
  assert.deepEqual(action(), { kind: 'loading', disabled: true })
  await registry.cancel('cancel-via-registry')
  assert.deepEqual(action(), { kind: 'send', disabled: false })

  register('first')
  assert.deepEqual(action(), { kind: 'loading', disabled: true })
  assert.throws(
    () => register('registration-failed'),
    error => error.code === 'AI_AGENT_SESSION_BUSY'
  )
  assert.deepEqual(action(), { kind: 'loading', disabled: true })
  registry.unregister('first')
  assert.deepEqual(action(), { kind: 'send', disabled: false })

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
