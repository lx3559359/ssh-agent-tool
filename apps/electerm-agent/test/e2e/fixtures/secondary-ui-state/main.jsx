import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getShellPilotTranslation } from '../../../../src/client/common/shellpilot-i18n-overrides.js'

const packInfo = { homepage: 'https://example.invalid' }
window.et = {
  isWebApp: true,
  isWin: true,
  isMac: false,
  isArm: false,
  packInfo
}
window.pre = {
  isWin: true,
  isMac: false,
  isArm: false,
  packInfo,
  openExternal: () => {},
  runGlobalAsync: async () => ({}),
  runSync: () => ''
}
window.store = {
  getLangName: () => window.fixtureLanguage === 'zh_cn' ? '简体中文' : 'English',
  getLangNames: () => ['简体中文', 'English'],
  onError: () => {},
  updateConfig: () => {}
}
window.fixtureLanguage = 'zh_cn'
window.localStorage.clear()
window.localStorage.setItem('ai_config_history', '[]')

const baseCopy = {
  zh_cn: {
    aiSuggestionsCache: 'AI 建议缓存',
    clear: '清空',
    language: '语言',
    modelAi: '模型',
    proxy: '代理',
    roleAI: 'AI 角色',
    save: '保存',
    testConnection: '测试连接'
  },
  en_us: {
    aiSuggestionsCache: 'AI Suggestion Cache',
    clear: 'Clear',
    language: 'Language',
    modelAi: 'Model',
    proxy: 'Proxy',
    roleAI: 'AI Role',
    save: 'Save',
    testConnection: 'Test Connection'
  }
}

window.translate = key => {
  return getShellPilotTranslation(key, window.fixtureLanguage) ||
    baseCopy[window.fixtureLanguage]?.[key] ||
    key
}

const { default: AIConfig } = await import('../../../../src/client/components/ai/ai-config.jsx')
const { default: BatchOpEditor } = await import('../../../../src/client/components/batch-op/batch-op-editor.jsx')

const initialProfile = {
  id: 'profile-1',
  nameAI: '',
  baseURLAI: 'https://stored.example.com/v1',
  apiPathAI: '',
  modelAI: 'stored-model',
  modelOptionsAI: ['stored-model'],
  roleAI: 'stored-role',
  apiKeyAI: 'stored-fixture-key',
  authHeaderNameAI: 'Authorization: Bearer',
  languageAI: '简体中文',
  agentSkills: [],
  mcpServers: [],
  proxyAI: ''
}

const initialSource = {
  ...initialProfile,
  aiProfiles: [initialProfile],
  activeAIProfileId: initialProfile.id
}

function copySource (source) {
  return {
    ...source,
    aiProfiles: source.aiProfiles.map(profile => ({ ...profile }))
  }
}

function LanguageButton ({ language, onChange }) {
  return (
    <button
      data-testid='language-toggle'
      type='button'
      onClick={() => {
        const next = language === 'zh_cn' ? 'en_us' : 'zh_cn'
        window.fixtureLanguage = next
        onChange(next)
      }}
    >
      {language === 'zh_cn' ? 'Preview English' : '预览简体中文'}
    </button>
  )
}

function AIConfigFixture () {
  const [language, setLanguage] = useState('zh_cn')
  const [source, setSource] = useState(initialSource)
  const initialValues = copySource(source)

  function loadExternalSource () {
    const profile = {
      ...source.aiProfiles[0],
      baseURLAI: 'https://external.example.com/v1',
      apiKeyAI: 'external-fixture-key',
      roleAI: 'external-role'
    }
    setSource({
      ...source,
      ...profile,
      aiProfiles: [profile]
    })
  }

  return (
    <main data-fixture-ready='true'>
      <div className='fixture-controls'>
        <LanguageButton language={language} onChange={setLanguage} />
        <button data-testid='external-source' type='button' onClick={loadExternalSource}>
          Load external source
        </button>
      </div>
      <div className='fixture-content'>
        <AIConfig
          initialValues={initialValues}
          languageVersion={language}
          onSubmit={() => {}}
          showAIConfig
        />
      </div>
    </main>
  )
}

function BatchFixture () {
  const [language, setLanguage] = useState('en_us')
  if (window.fixtureLanguage !== language) {
    window.fixtureLanguage = language
  }
  return (
    <main data-fixture-ready='true'>
      <div className='fixture-controls'>
        <LanguageButton language={language} onChange={setLanguage} />
      </div>
      <div className='fixture-content'>
        <BatchOpEditor
          widget={{ id: 'batch-op' }}
          languageVersion={language}
        />
      </div>
    </main>
  )
}

const fixture = new URLSearchParams(window.location.search).get('fixture')
createRoot(document.getElementById('root')).render(
  fixture === 'batch' ? <BatchFixture /> : <AIConfigFixture />
)
