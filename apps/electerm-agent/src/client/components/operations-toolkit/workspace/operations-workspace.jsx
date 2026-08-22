import { useEffect, useMemo, useState } from 'react'
import { auto } from 'manate/react'
import {
  Button,
  Empty,
  Modal,
  Segmented,
  Spin,
  Tag
} from 'antd'
import {
  CheckCircleOutlined,
  CloseOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import QuickCommandsFooterBox from '../../quick-commands/quick-commands-box'
import message from '../../common/message'
import { refsStatic } from '../../common/ref'
import { getOperationsCatalog, getOperationsTool } from '../catalog'
import {
  getSafeMaintenanceCommands,
  isSafeMaintenanceCommand
} from '../catalog/maintenance.js'
import { hiddenQuickActionIds } from '../catalog/migrations'
import { buildOperationsAIContext } from '../shared/ai-context'
import {
  createOperationsResourceConfirmation
} from '../shared/resource-confirmation.js'
import { formatShellPilotTranslation } from '../../../common/shellpilot-i18n-overrides.js'
import ToolCatalog from './tool-catalog'
import ParameterForm, { buildParameterDefaults } from './parameter-form'
import {
  normalizeOperationsParameterDependencies
} from './parameter-value.js'
import TaskPanel from './task-panel'
import ResultViewer from './result-viewer'
import './operations-workspace.styl'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const tabs = [
  { value: 'quick', label: e('shellpilotOperationsQuickActions') },
  { value: 'diagnostic', label: e('shellpilotOperationsDiagnostics') },
  { value: 'maintenance', label: e('shellpilotOperationsSafeMaintenance') },
  { value: 'custom', label: e('shellpilotOperationsMyTools') },
  { value: 'history', label: e('shellpilotOperationsHistory') }
]
const recommendedDiagnosticIds = [
  'service.inventory-health',
  'network.tcp-connections',
  'logs.system-anomaly-summary',
  'network.interface-health'
]

function OperationsWorkspace (props) {
  const { store, shellGeometry } = props
  const tools = getOperationsCatalog()
  const diagnosticTools = tools.filter(tool => tool.type === 'diagnostic')
  const scriptTools = tools.filter(tool => tool.type === 'script')
  const maintenanceTools = getSafeMaintenanceCommands(
    store.currentQuickCommands || []
  )
  const [selectedToolId, setSelectedToolId] = useState(diagnosticTools[0]?.id || '')
  const [selectedScriptId, setSelectedScriptId] = useState(scriptTools[0]?.id || '')
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('全部')
  const [scriptKeyword, setScriptKeyword] = useState('')
  const [scriptCategory, setScriptCategory] = useState('全部')
  const [params, setParams] = useState(() => buildParameterDefaults(diagnosticTools[0]))
  const [scriptParams, setScriptParams] = useState(() => buildParameterDefaults(scriptTools[0]))
  const selectedTool = getOperationsTool(selectedToolId) || diagnosticTools[0]
  const selectedScript = getOperationsTool(selectedScriptId) || scriptTools[0]
  const endpoint = store.getCurrentOperationsEndpoint?.()
  const endpointKey = endpoint
    ? `${endpoint.connectionUsername || endpoint.username}@${endpoint.host}:${endpoint.port}`
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
        bottom: shellGeometry.quickCommandBar.bottom,
        minHeight: 0
      }
    : {}
  const compactPinned = store.pinnedQuickCommandBar &&
    shellGeometry.quickCommandBar.height < 220

  useEffect(() => {
    setParams(buildParameterDefaults(selectedTool))
  }, [selectedToolId])

  useEffect(() => {
    setScriptParams(buildParameterDefaults(selectedScript))
  }, [selectedScriptId])

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
    setParams(current => normalizeOperationsParameterDependencies(
      selectedTool,
      { ...current, [id]: value }
    ))
  }

  function executeRun (tool, values, confirmation) {
    try {
      const active = store.runOperationsTool(
        tool.id,
        values,
        confirmation ? { confirmation } : {}
      )
      active.completion.catch(error => window.store.onError(error))
    } catch (error) {
      message.warning(error?.message || String(error))
    }
  }

  function handleRun (tool = selectedTool, values = params) {
    if (tool.risk !== 'resource-sensitive') {
      executeRun(tool, values)
      return
    }
    Modal.confirm({
      title: e('shellpilotOperationsCaptureConfirmTitle'),
      content: (
        <div className='operations-sensitive-confirmation'>
          <p>{e('shellpilotOperationsCaptureConfirmHint')}</p>
          <dl>
            <dt>{e('shellpilotOperationsCurrentServerLabel')}</dt>
            <dd>{endpointKey}</dd>
            {(tool.parameters || []).map(parameter => (
              <div key={parameter.id}>
                <dt>{parameter.label}</dt>
                <dd>{String(values[parameter.id] ?? '')}</dd>
              </div>
            ))}
          </dl>
        </div>
      ),
      okText: e('shellpilotOperationsConfirmCapture'),
      cancelText: e('cancel'),
      onOk: () => {
        const confirmation = createOperationsResourceConfirmation({
          toolId: tool.id,
          endpointKey,
          params: values
        })
        executeRun(tool, values, confirmation)
      }
    })
  }

  function handleAnalyze (task) {
    const tool = getOperationsTool(task.toolId)
    const prompt = buildOperationsAIContext({ task, tool })
    store.handleOpenAIPanel()
    refsStatic.get('AIChat')?.setPrompt(prompt)
    message.info(e('shellpilotOperationsAIContextReady'))
  }

  function handleHistorySelect (task) {
    const tool = getOperationsTool(task.toolId)
    store.activeOperationsTaskId = task.id
    const current = store.operationsTasks.filter(item => item.id !== task.id)
    store.operationsTasks = [task, ...current]
    if (tool?.type === 'script') {
      setSelectedScriptId(tool.id)
      setScriptParams(buildParameterDefaults(tool))
      store.operationsToolkitTab = 'custom'
    } else {
      setSelectedToolId(tool?.id || task.toolId)
      setParams(buildParameterDefaults(tool))
      store.operationsToolkitTab = 'diagnostic'
    }
  }

  function handleRecommendedDiagnostic (toolId) {
    const tool = getOperationsTool(toolId)
    if (!tool) return
    setSelectedToolId(tool.id)
    setParams(buildParameterDefaults(tool))
    store.operationsToolkitTab = 'diagnostic'
  }

  function renderRecommendedFlow () {
    const items = recommendedDiagnosticIds
      .map(id => getOperationsTool(id))
      .filter(Boolean)
    if (!items.length) return null
    return (
      <section className='operations-recommended-flow' aria-label={e('shellpilotOperationsRecommendedFlow')}>
        <span>{e('shellpilotOperationsRecommendedFlow')}</span>
        <div>
          {items.map((tool, index) => (
            <Button
              key={tool.id}
              type='text'
              size='small'
              onClick={() => handleRecommendedDiagnostic(tool.id)}
            >
              {index + 1}. {tool.title}
            </Button>
          ))}
        </div>
      </section>
    )
  }

  function renderReadOnlyWorkspace ({
    className,
    catalogTools,
    tool,
    currentKeyword,
    currentCategory,
    values,
    onKeywordChange,
    onCategoryChange,
    onSelect,
    onParamChange,
    script = false
  }) {
    const visibleTask = activeTask?.toolId === tool?.id ? activeTask : null
    return (
      <div className={className}>
        <ToolCatalog
          tools={catalogTools}
          selectedToolId={tool?.id}
          keyword={currentKeyword}
          category={currentCategory}
          onKeywordChange={onKeywordChange}
          onCategoryChange={onCategoryChange}
          onSelect={onSelect}
          searchPlaceholder={script ? e('shellpilotOperationsSearchRunbooks') : undefined}
          modeLabel={script ? e('shellpilotOperationsRunbook') : undefined}
        />
        <main className='operations-tool-detail'>
          <header className='operations-tool-title'>
            <div>
              <h3>{tool.title}</h3>
              <p>{tool.description}</p>
            </div>
            <Tag color={tool.risk === 'resource-sensitive' ? 'orange' : 'green'}>
              {tool.risk === 'resource-sensitive'
                ? e('shellpilotOperationsResourceSensitive')
                : (script
                    ? tf('shellpilotOperationsRunbookStepCount', {
                      count: tool.steps.length
                    })
                    : e('shellpilotOperationsReadonly'))}
            </Tag>
          </header>
          <div className='operations-connection-status'>
            <span className={endpoint ? 'connected' : ''} />
            {endpoint
              ? tf('shellpilotOperationsCurrentServer', { endpoint: endpointKey })
              : e('shellpilotOperationsDisconnectedHint')}
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
                  {e('shellpilotOperationsRediscover')}
                </Button>
                )
              : (
                <Button
                  type='link'
                  size='small'
                  onClick={() => window.store.onNewSsh()}
                >
                  {e('shellpilotOperationsConnectServer')}
                </Button>
                )}
          </div>
          {store.operationsDiscoveryError
            ? <div className='operations-discovery-error'>{store.operationsDiscoveryError}</div>
            : null}
          <ParameterForm
            tool={tool}
            values={values}
            capabilities={store.operationsCapabilities || {}}
            disabled={!endpoint}
            onChange={onParamChange}
          />
          {script
            ? (
              <section className='operations-script-steps'>
                <strong>{e('shellpilotOperationsRunbookSteps')}</strong>
                <ol>
                  {tool.steps.map(step => <li key={step.id}>{step.title}</li>)}
                </ol>
              </section>
              )
            : null}
          <div className='operations-run-actions'>
            <Button
              type='primary'
              onClick={() => {
                if (!endpoint) {
                  window.store.onNewSsh()
                  return
                }
                handleRun(tool, values)
              }}
            >
              {!endpoint
                ? e('shellpilotOperationsConnectAndRun')
                : (tool.risk === 'resource-sensitive'
                    ? e('shellpilotOperationsRunSensitive')
                    : (script
                        ? e('shellpilotOperationsRunScript')
                        : e('shellpilotOperationsRunReadonly')))}
            </Button>
            <span>
              {!endpoint
                ? e('shellpilotOperationsDisconnectedHint')
                : (tool.risk === 'resource-sensitive'
                    ? e('shellpilotOperationsSensitiveConfirmationRequired')
                    : (script
                        ? e('shellpilotOperationsRunbookNoConfirmation')
                        : e('shellpilotOperationsNoConfirmation')))}
            </span>
          </div>
          {visibleTask
            ? (
              <TaskPanel
                task={visibleTask}
                tool={tool}
                onCancel={id => store.cancelOperationsTask(id)}
                onAnalyze={handleAnalyze}
              />
              )
            : (
              <div className='operations-no-task'>
                <SafetyCertificateOutlined />
                <strong>{e('shellpilotOperationsAwaiting')}</strong>
                <span>{e('shellpilotOperationsCurrentTerminalTaskHint')}</span>
              </div>
              )}
        </main>
      </div>
    )
  }

  function renderDiagnostic () {
    return renderReadOnlyWorkspace({
      className: 'operations-diagnostic',
      catalogTools: diagnosticTools,
      tool: selectedTool,
      currentKeyword: keyword,
      currentCategory: category,
      values: params,
      onKeywordChange: setKeyword,
      onCategoryChange: setCategory,
      onSelect: setSelectedToolId,
      onParamChange: handleParamChange
    })
  }

  function renderScriptCenter () {
    return renderReadOnlyWorkspace({
      className: 'operations-diagnostic operations-script-center',
      catalogTools: scriptTools,
      tool: selectedScript,
      currentKeyword: scriptKeyword,
      currentCategory: scriptCategory,
      values: scriptParams,
      onKeywordChange: setScriptKeyword,
      onCategoryChange: setScriptCategory,
      onSelect: setSelectedScriptId,
      onParamChange: (id, value) => {
        setScriptParams(current => ({ ...current, [id]: value }))
      },
      script: true
    })
  }

  function renderMaintenance () {
    const openSafetyCenter = () => {
      window.dispatchEvent(new CustomEvent('shellpilot-open-safety-center'))
    }
    return (
      <div className='operations-maintenance'>
        <section className='operations-maintenance-safety'>
          <div className='operations-maintenance-guarantees'>
            <div>
              <SafetyCertificateOutlined />
              <span>
                <strong>{e('shellpilotOperationsBackupBeforeChange')}</strong>
                <small>{e('shellpilotOperationsBackupBeforeChangeHint')}</small>
              </span>
            </div>
            <div>
              <CheckCircleOutlined />
              <span>
                <strong>{e('shellpilotOperationsVerifyAfterChange')}</strong>
                <small>{e('shellpilotOperationsVerifyAfterChangeHint')}</small>
              </span>
            </div>
            <div>
              <HistoryOutlined />
              <span>
                <strong>{e('shellpilotOperationsRollbackFromCenter')}</strong>
                <small>{e('shellpilotOperationsRollbackFromCenterHint')}</small>
              </span>
            </div>
            <div
              aria-label={e('shellpilotOperationsSafetyContract')}
              className='operations-maintenance-contract'
            >
              <Tag color='green'>{e('shellpilotOperationsReadonly')}</Tag>
              <Tag color='orange'>{e('shellpilotOperationsNeedsEdit')}</Tag>
              <span>
                {e('shellpilotOperationsPreviewBeforeRun')}
                {' · '}
                {e('shellpilotOperationsConfirmBeforeChange')}
                {' · '}
                {e('shellpilotOperationsRollbackFromCenter')}
              </span>
            </div>
          </div>
          <Button onClick={openSafetyCenter}>
            {e('shellpilotOperationsOpenSafetyCenter')}
          </Button>
        </section>
        <div className='operations-maintenance-catalog'>
          <QuickCommandsFooterBox
            {...props}
            embedded
            commandFilter={isSafeMaintenanceCommand}
            panelTitle={e('shellpilotOperationsMaintenanceCatalog')}
            panelSubtitle={tf('shellpilotOperationsMaintenanceCatalogHint', {
              count: maintenanceTools.length
            })}
            initialLabel=''
            persistFilters={false}
            showRiskFilter={false}
            showPanelActions={false}
          />
        </div>
      </div>
    )
  }

  function renderContent () {
    if (store.operationsToolkitTab === 'quick') {
      return (
        <QuickCommandsFooterBox
          {...props}
          embedded
          hiddenCommandIds={hiddenQuickActionIds}
          showPanelActions={false}
        />
      )
    }
    if (store.operationsToolkitTab === 'diagnostic') return renderDiagnostic()
    if (store.operationsToolkitTab === 'maintenance') return renderMaintenance()
    if (store.operationsToolkitTab === 'custom') return renderScriptCenter()
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
    return (
      <div className='operations-placeholder'>
        <Empty description={e('shellpilotOperationsNoMatches')} />
      </div>
    )
  }

  return (
    <section
      className={`operations-toolkit-workspace${compactPinned ? ' operations-toolkit-compact-pinned' : ''}`}
      style={{
        left,
        '--operations-right-offset': `${right + 10}px`,
        ...pinnedGeometry
      }}
    >
      {compactPinned
        ? (
          <Button
            className='operations-toolkit-compact-close'
            type='text'
            icon={<CloseOutlined />}
            aria-label={e('shellpilotOperationsClose')}
            onClick={() => store.closeOperationsToolkit()}
          />
          )
        : null}
      <header className='operations-workspace-head'>
        <div>
          <strong>{e('shellpilotOperationsTitle')}</strong>
          <span>{e('shellpilotOperationsSubtitle')}</span>
        </div>
        <Button
          type='text'
          icon={<CloseOutlined />}
          aria-label={e('shellpilotOperationsClose')}
          onClick={() => store.closeOperationsToolkit()}
        />
      </header>
      <Segmented
        className='operations-workspace-tabs'
        options={tabs}
        value={store.operationsToolkitTab}
        onChange={value => { store.operationsToolkitTab = value }}
      />
      {renderRecommendedFlow()}
      <div className='operations-workspace-body'>
        {store.operationsDiscoveryStatus === 'loading' &&
        ['diagnostic', 'custom'].includes(store.operationsToolkitTab) &&
        !store.operationsCapabilities
          ? <Spin className='operations-discovery-spin' tip={e('shellpilotOperationsDiscovering')} />
          : null}
        {renderContent()}
      </div>
    </section>
  )
}

export default auto(OperationsWorkspace)
