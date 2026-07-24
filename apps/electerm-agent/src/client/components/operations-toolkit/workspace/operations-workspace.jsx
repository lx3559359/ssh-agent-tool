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
import { formatShellPilotTranslation } from '../../../common/shellpilot-i18n-overrides.js'
import ToolCatalog from './tool-catalog'
import ParameterForm, { buildParameterDefaults } from './parameter-form'
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

function OperationsWorkspace (props) {
  const { store, shellGeometry } = props
  const tools = getOperationsCatalog()
  const maintenanceTools = getSafeMaintenanceCommands(
    store.currentQuickCommands || []
  )
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
    message.info(e('shellpilotOperationsAIContextReady'))
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
            <Tag color='green'>{e('shellpilotOperationsReadonly')}</Tag>
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
              {e('shellpilotOperationsRunReadonly')}
            </Button>
            <span>{e('shellpilotOperationsNoConfirmation')}</span>
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
                <strong>{e('shellpilotOperationsAwaiting')}</strong>
                <span>{e('shellpilotOperationsIndependentTaskHint')}</span>
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
            ? e('shellpilotOperationsMaintenancePhaseTwo')
            : e('shellpilotOperationsCustomPhaseTwo')}
        />
      </div>
    )
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
      <div className='operations-workspace-body'>
        {store.operationsDiscoveryStatus === 'loading' &&
        store.operationsToolkitTab === 'diagnostic' &&
        !store.operationsCapabilities
          ? <Spin className='operations-discovery-spin' tip={e('shellpilotOperationsDiscovering')} />
          : null}
        {renderContent()}
      </div>
    </section>
  )
}

export default auto(OperationsWorkspace)
