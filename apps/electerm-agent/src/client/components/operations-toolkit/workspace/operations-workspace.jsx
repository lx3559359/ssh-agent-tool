import { useEffect, useMemo, useState } from 'react'
import { auto } from 'manate/react'
import {
  Button,
  Empty,
  Segmented,
  Spin,
  Tag
} from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import QuickCommandsFooterBox from '../../quick-commands/quick-commands-box'
import message from '../../common/message'
import { refsStatic } from '../../common/ref'
import { getOperationsCatalog, getOperationsTool } from '../catalog'
import { hiddenQuickActionIds } from '../catalog/migrations'
import { buildOperationsAIContext } from '../shared/ai-context'
import ToolCatalog from './tool-catalog'
import ParameterForm, { buildParameterDefaults } from './parameter-form'
import TaskPanel from './task-panel'
import ResultViewer from './result-viewer'
import './operations-workspace.styl'

const tabs = [
  { value: 'quick', label: '快捷操作' },
  { value: 'diagnostic', label: '诊断脚本' },
  { value: 'maintenance', label: '安全维护' },
  { value: 'custom', label: '我的工具' },
  { value: 'history', label: '执行记录' }
]

function OperationsWorkspace (props) {
  const { store, shellGeometry } = props
  const tools = getOperationsCatalog()
  const [selectedToolId, setSelectedToolId] = useState(tools[0]?.id || '')
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('全部')
  const [params, setParams] = useState(() => buildParameterDefaults(tools[0]))
  const selectedTool = getOperationsTool(selectedToolId) || tools[0]
  const endpoint = store.getCurrentOperationsEndpoint?.()
  const endpointKey = endpoint
    ? `${endpoint.username}@${endpoint.host}:${endpoint.port}`
    : ''
  const activeTask = useMemo(() => {
    return store.operationsTasks.find(item => {
      return item.id === store.activeOperationsTaskId
    }) || null
  }, [store.operationsTasks, store.activeOperationsTaskId])
  const { left, right } = shellGeometry.terminalInsets
  const pinnedGeometry = store.pinnedQuickCommandBar
    ? {
        height: shellGeometry.quickCommandBar.height,
        bottom: shellGeometry.quickCommandBar.bottom
      }
    : {}

  useEffect(() => {
    setParams(buildParameterDefaults(selectedTool))
  }, [selectedToolId])

  useEffect(() => {
    if (!endpointKey) return
    if (
      store.operationsDiscoveryStatus === 'loading' ||
      store.operationsCapabilitiesEndpointKey === endpointKey
    ) {
      return
    }
    store.refreshOperationsCapabilities().catch(() => {})
  }, [endpointKey])

  function handleParamChange (id, value) {
    setParams(current => ({ ...current, [id]: value }))
  }

  function handleRun () {
    try {
      const active = store.runOperationsTool(selectedTool.id, params)
      active.completion.catch(error => window.store.onError(error))
    } catch (error) {
      message.warning(error?.message || String(error))
    }
  }

  function handleAnalyze (task) {
    const tool = getOperationsTool(task.toolId)
    const prompt = buildOperationsAIContext({ task, tool })
    store.handleOpenAIPanel()
    refsStatic.get('AIChat')?.setPrompt(prompt)
    message.info('诊断结果已放入 AI 输入框，请确认后发送')
  }

  function handleHistorySelect (task) {
    store.activeOperationsTaskId = task.id
    const current = store.operationsTasks.filter(item => item.id !== task.id)
    store.operationsTasks = [task, ...current]
    store.operationsToolkitTab = 'diagnostic'
  }

  function renderDiagnostic () {
    return (
      <div className='operations-diagnostic'>
        <ToolCatalog
          tools={tools}
          selectedToolId={selectedTool?.id}
          keyword={keyword}
          category={category}
          onKeywordChange={setKeyword}
          onCategoryChange={setCategory}
          onSelect={setSelectedToolId}
        />
        <main className='operations-tool-detail'>
          <header className='operations-tool-title'>
            <div>
              <h3>{selectedTool.title}</h3>
              <p>{selectedTool.description}</p>
            </div>
            <Tag color='green'>只读</Tag>
          </header>
          <div className='operations-connection-status'>
            <span className={endpoint ? 'connected' : ''} />
            {endpoint
              ? `当前服务器：${endpointKey}`
              : '尚未连接 SSH，可浏览脚本；连接后即可运行'}
            {endpoint
              ? (
                <Button
                  type='text'
                  size='small'
                  icon={<ReloadOutlined />}
                  loading={store.operationsDiscoveryStatus === 'loading'}
                  onClick={() => store.refreshOperationsCapabilities().catch(error => {
                    message.warning(error?.message || String(error))
                  })}
                >
                  重新识别
                </Button>
                )
              : null}
          </div>
          {store.operationsDiscoveryError
            ? <div className='operations-discovery-error'>{store.operationsDiscoveryError}</div>
            : null}
          <ParameterForm
            tool={selectedTool}
            values={params}
            capabilities={store.operationsCapabilities || {}}
            disabled={!endpoint}
            onChange={handleParamChange}
          />
          <div className='operations-run-actions'>
            <Button
              type='primary'
              disabled={!endpoint}
              onClick={handleRun}
            >
              运行只读诊断
            </Button>
            <span>不修改配置、文件或服务，无需二次确认</span>
          </div>
          {activeTask
            ? (
              <TaskPanel
                task={activeTask}
                tool={getOperationsTool(activeTask.toolId)}
                onCancel={id => store.cancelOperationsTask(id)}
                onAnalyze={handleAnalyze}
              />
              )
            : (
              <div className='operations-no-task'>
                <SafetyCertificateOutlined />
                <strong>等待执行诊断</strong>
                <span>结果在独立后台任务中采集，不会占用当前 SSH 输入区。</span>
              </div>
              )}
        </main>
      </div>
    )
  }

  function renderPlaceholder (kind) {
    return (
      <div className='operations-placeholder'>
        <Empty
          description={kind === 'maintenance'
            ? '安全维护将在下一阶段接入备份、确认和快捷回滚'
            : '我的工具将在下一阶段支持自定义脚本和导入'}
        />
      </div>
    )
  }

  function renderContent () {
    if (store.operationsToolkitTab === 'quick') {
      return (
        <QuickCommandsFooterBox
          embedded
          hiddenCommandIds={hiddenQuickActionIds}
          {...props}
        />
      )
    }
    if (store.operationsToolkitTab === 'diagnostic') return renderDiagnostic()
    if (store.operationsToolkitTab === 'history') {
      return (
        <ResultViewer
          records={store.operationsHistory || []}
          tools={tools}
          onSelect={handleHistorySelect}
          onAnalyze={handleAnalyze}
          onClear={() => store.clearOperationsHistory()}
        />
      )
    }
    return renderPlaceholder(store.operationsToolkitTab)
  }

  return (
    <section
      className='operations-toolkit-workspace'
      style={{
        left,
        '--operations-right-offset': `${right + 10}px`,
        ...pinnedGeometry
      }}
    >
      <header className='operations-workspace-head'>
        <div>
          <strong>运维工具</strong>
          <span>快捷操作与只读诊断</span>
        </div>
        <Button
          type='text'
          icon={<CloseOutlined />}
          aria-label='关闭运维工具'
          onClick={() => store.closeOperationsToolkit()}
        />
      </header>
      <Segmented
        className='operations-workspace-tabs'
        options={tabs}
        value={store.operationsToolkitTab}
        onChange={value => { store.operationsToolkitTab = value }}
      />
      <div className='operations-workspace-body'>
        {store.operationsDiscoveryStatus === 'loading' &&
        store.operationsToolkitTab === 'diagnostic' &&
        !store.operationsCapabilities
          ? <Spin className='operations-discovery-spin' tip='正在识别服务器环境...' />
          : null}
        {renderContent()}
      </div>
    </section>
  )
}

export default auto(OperationsWorkspace)
