/**
 * quick commands footer selection wrap
 */

import { useEffect, useState, useRef } from 'react'
import { pinnedQuickCommandBarKey, quickCommandLabelsLsKey } from '../../common/constants'
import { sortBy } from 'lodash-es'
import { AutoComplete, Button, Input, InputNumber, Select, Space, Flex, Modal } from 'antd'
import * as ls from '../../common/safe-local-storage'
import { refs } from '../common/ref'
import { runCmd } from '../terminal/terminal-apis'
import message from '../common/message'
import CmdItem from './quick-command-item'
import {
  EditOutlined,
  CloseCircleOutlined,
  PushpinOutlined
} from '@ant-design/icons'
import classNames from 'classnames'
import onDropFunc from './on-drop'
import {
  applyQuickCommandDefaults,
  applyQuickCommandParamValues,
  buildAdvancedUsage,
  buildQuickCommandContext,
  buildQuickCommandRollbackContext,
  buildQuickCommandParamValues,
  describeQuickCommandContext
} from './quick-command-context'
import {
  buildNetworkProbeCommand,
  mergeDetectedNetworkParams,
  parseNetworkProbeOutput
} from './quick-command-network'
import { discoverQuickCommandTargets } from './quick-command-service-discovery.js'
import {
  assertVerifiedQuickCommandRollbackResult,
  buildVerifiedQuickCommandRollbackAction,
  findSafetyOperationSession,
  readSafetyOperationRecords,
  safetyOperationUpdatedEvent,
  updateSafetyOperationRecord,
  writeSafetyOperationRecords
} from '../../common/safety-operation-records'
import './qm.styl'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
const addQuickCommands = 'addQuickCommands'
const networkChangeCommandId = 'builtin-server-network-change-ip'
const { Option } = Select

const targetDiscoveryMessageKeys = Object.freeze({
  cancelled: 'shellpilotFleetCancelled',
  permission: 'shellpilotFleetPermissionDenied',
  unsupported: 'shellpilotFleetServiceDetectionUnsupported',
  disconnected: 'shellpilotFleetDisconnected',
  error: 'shellpilotFleetDetectionFailed',
  empty: 'shellpilotFleetNoServicesFound',
  partial: 'shellpilotFleetResultsTruncated'
})

export default function QuickCommandsFooterBox (props) {
  const [keyword, setKeyword] = useState('')
  const [label, setLabel] = useState(ls.getItem(quickCommandLabelsLsKey, ''))
  const [pendingCommand, setPendingCommand] = useState(null)
  const [showPendingPreview, setShowPendingPreview] = useState(false)
  const [networkProbe, setNetworkProbe] = useState({ loading: false, error: '', detected: null })
  const [targetDiscovery, setTargetDiscovery] = useState({
    loading: false,
    error: '',
    status: 'idle',
    message: '',
    options: [],
    truncated: false
  })
  const [safetyRecords, setSafetyRecords] = useState(() => readSafetyOperationRecords(ls))
  const timer = useRef(null)
  const targetDiscoveryAbortRef = useRef(null)
  const rollbackRunningRef = useRef('')
  const [rollbackRunning, setRollbackRunning] = useState('')
  const rollbackRecord = safetyRecords.find(record => {
    return record.source === 'quick-command' && record.status === 'available'
  })

  useEffect(() => {
    const refresh = () => setSafetyRecords(readSafetyOperationRecords(ls))
    window.addEventListener(safetyOperationUpdatedEvent, refresh)
    return () => window.removeEventListener(safetyOperationUpdatedEvent, refresh)
  }, [])

  useEffect(() => () => targetDiscoveryAbortRef.current?.abort(), [])

  function handleMouseLeave () {
    timer.current = setTimeout(() => {
      toggle(false)
    }, 500)
  }

  function handleMouseEnter () {
    clearTimeout(timer.current)
  }

  function toggle (openQuickCommandBar) {
    window.store.openQuickCommandBar = openQuickCommandBar
  }

  function handleTogglePinned () {
    const current = !window.store.pinnedQuickCommandBar
    ls.setItem(pinnedQuickCommandBarKey, current ? 'y' : 'n')
    window.store.pinnedQuickCommandBar = current
  }

  async function handleSelect (id) {
    const {
      store
    } = window
    if (id === addQuickCommands) {
      store.handleOpenQuickCommandsSetting()
    } else {
      const item = props.currentQuickCommands.find(item => item.id === id)
      if (item?.editBeforeRun) {
        const context = buildQuickCommandRollbackContext(
          item,
          buildQuickCommandContext(props.currentTab)
        )
        const paramValues = buildQuickCommandParamValues(item, context)
        setPendingCommand({
          item,
          context,
          id: item.id,
          name: item.name,
          description: item.description,
          usage: item.usage,
          advancedUsage: buildAdvancedUsage(item, context),
          contextLabel: describeQuickCommandContext(context),
          inputOnly: item.inputOnly,
          params: item.params || [],
          paramValues,
          text: getCommandText(item, context, paramValues)
        })
        setShowPendingPreview(!(item.params || []).length)
        const targetParam = (item.params || []).find(param => param.type === 'service-target')
        if (targetParam) {
          runTargetDiscovery(targetParam)
        } else {
          resetTargetDiscovery()
        }
        if (item.id === networkChangeCommandId) {
          mcpRunQuickCommandNetworkProbe(item, context)
        } else {
          setNetworkProbe({ loading: false, error: '', detected: null })
        }
        return
      }
      store.runQuickCommandItem(id)
    }
  }

  function resetTargetDiscovery () {
    targetDiscoveryAbortRef.current?.abort()
    targetDiscoveryAbortRef.current = null
    setTargetDiscovery({
      loading: false,
      error: '',
      status: 'idle',
      message: '',
      options: [],
      truncated: false
    })
  }

  async function runTargetDiscovery (targetParam) {
    targetDiscoveryAbortRef.current?.abort()
    const controller = new AbortController()
    targetDiscoveryAbortRef.current = controller
    setTargetDiscovery({
      loading: true,
      error: '',
      status: 'loading',
      message: e('shellpilotQuickDiscoveringServicesContainers'),
      options: [],
      truncated: false
    })
    try {
      const bookmark = props.currentTab
      if (!bookmark?.host) {
        throw new Error(e('shellpilotQuickDiscoveryRequiresSsh'))
      }
      const result = await discoverQuickCommandTargets(bookmark, {
        type: targetParam.targetType,
        sources: targetParam.sources,
        signal: controller.signal,
        translate: e
      })
      if (controller.signal.aborted) return
      setTargetDiscovery({
        loading: false,
        error: '',
        status: result.status,
        message: result.options.length
          ? tf(
            result.truncated ? 'shellpilotFleetFoundItemsPartial' : 'shellpilotFleetFoundItems',
            { count: result.options.length }
          )
          : e(targetDiscoveryMessageKeys[result.status] || 'shellpilotFleetDetectionFailed'),
        options: result.options,
        truncated: result.truncated
      })
    } catch (error) {
      if (error?.name === 'AbortError') return
      setTargetDiscovery({
        loading: false,
        error: error?.message || e('shellpilotQuickTargetDiscoveryFailed'),
        status: 'error',
        message: '',
        options: [],
        truncated: false
      })
    }
  }

  async function mcpRunQuickCommandNetworkProbe (item, context) {
    setNetworkProbe({ loading: true, error: '', detected: null })
    try {
      const tabId = props.currentTab?.id || window.store.activeTabId
      const terminal = refs.get('term-' + tabId)
      if (!terminal?.pid || !terminal?.isSsh?.()) {
        throw new Error(e('shellpilotQuickDiscoveryRequiresSsh'))
      }
      const output = await runCmd(terminal.pid, buildNetworkProbeCommand())
      const detected = parseNetworkProbeOutput(String(output || ''))
      setPendingCommand(old => {
        if (!old || old.id !== networkChangeCommandId) {
          return old
        }
        const paramValues = mergeDetectedNetworkParams(old.paramValues, detected)
        return {
          ...old,
          detectedNetwork: detected,
          paramValues,
          text: getCommandText(item || old.item, context || old.context, paramValues)
        }
      })
      setNetworkProbe({ loading: false, error: '', detected })
    } catch (error) {
      setNetworkProbe({
        loading: false,
        error: error?.message || e('shellpilotQuickNetworkDiscoveryFailed'),
        detected: null
      })
    }
  }

  function getCommandText (item, context, paramValues) {
    const text = item?.commands?.length
      ? item.commands.map(step => step.command).join('\n')
      : item?.command || ''
    if (item?.params?.length) {
      return applyQuickCommandParamValues(text, paramValues || {}, context)
    }
    return applyQuickCommandDefaults(text, context)
  }

  function handlePendingChange (event) {
    const text = event.target.value
    setPendingCommand(old => ({
      ...old,
      text
    }))
  }

  function handlePendingParamChange (name, value) {
    setPendingCommand(old => {
      if (!old) {
        return old
      }
      const paramValues = {
        ...(old.paramValues || {}),
        [name]: value === undefined || value === null ? '' : value
      }
      return {
        ...old,
        paramValues,
        text: getCommandText(old.item, old.context, paramValues)
      }
    })
  }

  function handlePendingCancel () {
    resetTargetDiscovery()
    setPendingCommand(null)
    setShowPendingPreview(false)
  }

  async function handleRollbackAction (action) {
    if (rollbackRunningRef.current) return
    const path = rollbackRecord?.rollbackPath || rollbackRecord?.path
    if (!path) {
      return
    }
    const terminal = findSafetyOperationSession(
      rollbackRecord,
      [props.currentTab?.id, window.store.activeTabId],
      tabId => refs.get('term-' + tabId)
    )
    if (!terminal) {
      message.warning(tf('shellpilotQuickConnectBeforeRollback', { host: rollbackRecord.host || '' }))
      return
    }
    rollbackRunningRef.current = rollbackRecord.id
    setRollbackRunning(rollbackRecord.id)
    try {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const output = await runCmd(
        terminal.pid,
        buildVerifiedQuickCommandRollbackAction(rollbackRecord, action, token)
      )
      assertVerifiedQuickCommandRollbackResult(output, token)
      const records = updateSafetyOperationRecord(readSafetyOperationRecords(ls), rollbackRecord.id, {
        status: action === 'rollback' ? 'restored' : 'kept',
        rollbackStatus: action === 'rollback' ? 'completed' : 'kept',
        restoredAt: action === 'rollback' ? new Date().toISOString() : '',
        keptAt: action === 'keep' ? new Date().toISOString() : ''
      })
      setSafetyRecords(writeSafetyOperationRecords(ls, records))
    } catch (error) {
      const records = updateSafetyOperationRecord(readSafetyOperationRecords(ls), rollbackRecord.id, {
        status: 'failed',
        rollbackStatus: 'failed',
        error: error?.message || String(error)
      })
      setSafetyRecords(writeSafetyOperationRecords(ls, records))
      window.store.onError(error)
    } finally {
      rollbackRunningRef.current = ''
      setRollbackRunning('')
    }
  }

  function handlePendingOk () {
    if (!pendingCommand?.text?.trim()) {
      return
    }
    window.store.runQuickCommandItem(pendingCommand.id, {
      commandText: pendingCommand.text,
      inputOnly: pendingCommand.inputOnly,
      confirmed: true
    })
    resetTargetDiscovery()
    setPendingCommand(null)
    setShowPendingPreview(false)
  }

  function handleClose () {
    ls.setItem(pinnedQuickCommandBarKey, 'n')
    window.store.pinnedQuickCommandBar = false
    window.store.openQuickCommandBar = false
  }

  function handleChange (e) {
    setKeyword(e.target.value)
  }

  function handleChangeLabels (v) {
    ls.setItem(quickCommandLabelsLsKey, v || '')
    setLabel(v)
  }

  // function filterFunc (v, opt) {
  //   const c = opt.props.children.toLowerCase()
  //   const m = opt.props.cmd.toLowerCase()
  //   const vv = v.toLowerCase()
  //   return c.includes(vv) || m.includes(vv)
  // }

  function onDragOver (e) {
    e.preventDefault()
  }

  function onDragStart (e) {
    e.dataTransfer.setData('idDragged', e.target.getAttribute('data-id'))
  }

  function onDragEnter (e) {
    e.target.closest('.qm-item')?.classList.add('qm-item-dragover')
  }

  function onDragLeave (e) {
    e.target.closest('.qm-item')?.classList.remove('qm-item-dragover')
  }

  function onDrop (e) {
    onDropFunc(e, '.qm-item')
  }

  function renderNoCmd () {
    return (
      <div className='pd1'>
        <Button
          type='primary'
          onClick={window.store.handleOpenQuickCommandsSetting}
        >
          {e(addQuickCommands)}
        </Button>
      </div>
    )
  }

  function renderItem (item) {
    const {
      qmSortByFrequency
    } = props
    return (
      <CmdItem
        item={item}
        key={item.id}
        onSelect={handleSelect}
        draggable={!qmSortByFrequency}
        handleDragOver={onDragOver}
        handleDragStart={onDragStart}
        handleDragEnter={onDragEnter}
        handleDragLeave={onDragLeave}
        handleDrop={onDrop}
      />
    )
  }

  function renderTag (tag) {
    return (
      <Option
        value={tag}
        key={'tag-' + tag}
      >
        {tag}
      </Option>
    )
  }

  function renderPendingParamControl (param, value) {
    if (param.type === 'service-target') {
      if (param.multiple) {
        const values = Array.isArray(value)
          ? value
          : String(value || '').split(',').map(item => item.trim()).filter(Boolean)
        return (
          <Select
            mode={param.multiple ? 'tags' : undefined}
            value={values}
            options={targetDiscovery.options}
            tokenSeparators={[',']}
            showSearch
            allowClear
            loading={targetDiscovery.loading}
            placeholder={param.placeholder}
            onChange={next => handlePendingParamChange(param.name, next)}
            className='qm-command-param-control'
          />
        )
      }
      return (
        <AutoComplete
          value={value}
          options={targetDiscovery.options}
          filterOption={(input, option) => String(option?.label || option?.value || '').toLowerCase().includes(input.toLowerCase())}
          onChange={next => handlePendingParamChange(param.name, next)}
          className='qm-command-param-control'
        >
          <Input placeholder={param.placeholder} />
        </AutoComplete>
      )
    }
    if (param.type === 'network-interface') {
      const detected = networkProbe.detected || pendingCommand?.detectedNetwork
      const interfaces = detected?.networkInterfaces || []
      if (interfaces.length) {
        return (
          <Select
            value={value}
            showSearch
            onChange={next => handlePendingParamChange(param.name, next)}
            className='qm-command-param-control'
          >
            {
              interfaces.map(networkInterface => (
                <Option value={networkInterface.name} key={networkInterface.name}>
                  {networkInterface.name} · {networkInterface.cidr || e('shellpilotQuickNoIpv4')} · {networkInterface.state}
                </Option>
              ))
            }
          </Select>
        )
      }
    }
    if (param.type === 'select') {
      return (
        <Select
          value={value || param.defaultValue}
          onChange={next => handlePendingParamChange(param.name, next)}
          className='qm-command-param-control'
        >
          {
            (param.options || []).map(option => (
              <Option value={option.value} key={`${param.name}-${option.value}`}>
                {option.label}
              </Option>
            ))
          }
        </Select>
      )
    }
    if (param.type === 'number') {
      const numberValue = value === '' ? null : Number(value)
      return (
        <InputNumber
          value={Number.isNaN(numberValue) ? null : numberValue}
          min={param.min}
          max={param.max}
          placeholder={param.placeholder}
          onChange={next => handlePendingParamChange(param.name, next)}
          className='qm-command-param-control'
        />
      )
    }
    return (
      <Input
        value={value}
        placeholder={param.placeholder}
        onChange={event => handlePendingParamChange(param.name, event.target.value)}
        className='qm-command-param-control'
      />
    )
  }

  function renderPendingParam (param) {
    if (param.type === 'hidden') {
      return null
    }
    const value = pendingCommand?.paramValues?.[param.name] ?? ''
    return (
      <div className='qm-command-param-item' key={param.name}>
        <div className='qm-command-param-label'>{param.label || param.name}</div>
        {renderPendingParamControl(param, value)}
        {
          param.help
            ? <div className='qm-command-param-help'>{param.help}</div>
            : null
        }
      </div>
    )
  }

  function renderNetworkProbe () {
    if (pendingCommand?.id !== networkChangeCommandId) {
      return null
    }
    const detected = networkProbe.detected || pendingCommand.detectedNetwork
    const selectedName = pendingCommand?.paramValues?.网卡 || detected?.interface
    const selectedInterface = detected?.networkInterfaces?.find(item => item.name === selectedName)
    const interfaceCount = detected?.networkInterfaces?.length || detected?.interfaces?.length || 0
    return (
      <div className={classNames('qm-network-probe', { 'qm-network-probe-error': networkProbe.error })}>
        <Flex justify='space-between' align='center' gap='small'>
          <div>
            <div className='qm-network-probe-title'>{e('shellpilotQuickCurrentServerNetwork')}</div>
            {
              networkProbe.loading
                ? <div className='qm-network-probe-status'>{e('shellpilotQuickDetectingNetwork')}</div>
                : null
            }
            {
              detected
                ? (
                  <div className='qm-network-probe-values'>
                    <span>{tf('shellpilotQuickInterfacesDetected', { count: interfaceCount })}</span>
                    <span>{e('shellpilotQuickCurrentSelection')}：{selectedName}</span>
                    <span>{e('shellpilotQuickCurrentCidr')}：{selectedInterface?.cidr || detected.cidr || e('shellpilotQuickNotAvailable')}</span>
                    <span>{e('shellpilotQuickStatus')}：{selectedInterface?.state || e('shellpilotUnknown')}</span>
                    <span>{e('shellpilotQuickGateway')}：{detected.gateway || e('shellpilotQuickNotAvailable')}</span>
                    <span>{e('shellpilotQuickDns')}：{detected.dns || e('shellpilotQuickNotAvailable')}</span>
                  </div>
                  )
                : null
            }
            {
              networkProbe.error
                ? <div className='qm-network-probe-status'>{networkProbe.error}</div>
                : null
            }
          </div>
          <Button
            size='small'
            loading={networkProbe.loading}
            onClick={() => mcpRunQuickCommandNetworkProbe(pendingCommand.item, pendingCommand.context)}
          >
            {e('shellpilotQuickDetectAgain')}
          </Button>
        </Flex>
      </div>
    )
  }

  function renderTargetDiscovery () {
    const targetParam = pendingCommand?.params?.find(param => param.type === 'service-target')
    if (!targetParam) return null
    const typeLabel = e(targetParam.targetType === 'container'
      ? 'shellpilotQuickTargetContainer'
      : 'shellpilotQuickTargetService')
    return (
      <div className={classNames('qm-target-discovery', { 'qm-target-discovery-error': targetDiscovery.error })}>
        <Flex justify='space-between' align='center' gap='small'>
          <div>
            <div className='qm-target-discovery-title'>{e('shellpilotQuickAutoDetectServicesContainers')}</div>
            <div className='qm-target-discovery-status'>
              {targetDiscovery.error || targetDiscovery.message || tf('shellpilotQuickAvailableTargetsAfterSsh', { type: typeLabel })}
            </div>
          </div>
          <Button
            size='small'
            loading={targetDiscovery.loading}
            onClick={() => runTargetDiscovery(targetParam)}
          >
            {e('shellpilotQuickDetectAgain')}
          </Button>
        </Flex>
      </div>
    )
  }

  function renderRollbackProtection () {
    if (!pendingCommand?.item?.mutatesServer) {
      return null
    }
    const values = pendingCommand.paramValues || {}
    const enabled = values.回滚保护 === 'enabled'
    const isNetworkChange = pendingCommand.id === networkChangeCommandId
    return (
      <div className={classNames('qm-rollback-preview', { 'qm-rollback-preview-disabled': isNetworkChange && !enabled })}>
        <div className='qm-rollback-preview-head'>
          <div className='qm-rollback-preview-title'>{e('shellpilotQuickRollback')}：{pendingCommand.item.rollback.title}</div>
          <Button
            danger
            size='small'
            disabled={!(rollbackRecord?.rollbackPath || rollbackRecord?.path)}
            onClick={() => handleRollbackAction('rollback')}
          >
            {(rollbackRecord?.rollbackPath || rollbackRecord?.path) ? e('shellpilotQuickRollbackLastChange') : e('shellpilotQuickNoRollbackAvailable')}
          </Button>
        </div>
        <div>
          {isNetworkChange
            ? (enabled
                ? tf('shellpilotQuickAutoRollbackProtection', { seconds: values.自动回滚秒数 || 120 })
                : e('shellpilotQuickManualRollbackOnly'))
            : e('shellpilotQuickRollbackDescription')}
        </div>
        <div className='qm-rollback-preview-path'>{e('shellpilotQuickRollbackScript')}：{values[pendingCommand.item.rollback.pathParam] || pendingCommand.context.rollbackPath}</div>
      </div>
    )
  }

  function renderRollbackRecord () {
    const path = rollbackRecord?.rollbackPath || rollbackRecord?.path
    if (!path) {
      return null
    }
    return (
      <div className='qm-rollback-record'>
        <div>
          <div className='qm-rollback-record-title'>{rollbackRecord.title || e('shellpilotQuickServerChange')} · {e('shellpilotQuickRollback')}</div>
          <div className='qm-rollback-record-desc'>
            {rollbackRecord.host || e('shellpilotQuickCurrentServer')} · {rollbackRecord.protected ? tf('shellpilotQuickAutoRollbackStarted', { seconds: rollbackRecord.seconds }) : e('shellpilotQuickManualRollbackCreated')}
          </div>
          <div className='qm-rollback-record-path'>{path}</div>
        </div>
        <Space>
          <Button
            disabled={Boolean(rollbackRunning)}
            loading={rollbackRunning === rollbackRecord.id}
            onClick={() => handleRollbackAction('keep')}
          >
            {e('shellpilotQuickKeepNewConfiguration')}
          </Button>
          <Button
            danger
            type='primary'
            disabled={Boolean(rollbackRunning)}
            loading={rollbackRunning === rollbackRecord.id}
            onClick={() => handleRollbackAction('rollback')}
          >
            {e('shellpilotQuickRollbackNow')}
          </Button>
        </Space>
      </div>
    )
  }

  function renderPendingParams () {
    if (!pendingCommand?.params?.length) {
      return null
    }
    return (
      <div className='qm-command-param-section'>
        <div className='qm-command-param-title'>{e('shellpilotQuickFillParameters')}</div>
        <div className='qm-command-param-grid'>
          {pendingCommand.params.map(renderPendingParam)}
        </div>
      </div>
    )
  }

  function renderCommandPreview () {
    if (!pendingCommand) {
      return null
    }
    const hasParams = Boolean(pendingCommand.params?.length)
    if (hasParams && !showPendingPreview) {
      return (
        <Button
          className='qm-command-preview-toggle'
          onClick={() => setShowPendingPreview(true)}
        >
          {e('shellpilotQuickAdvancedEditCommand')}
        </Button>
      )
    }
    return (
      <div className='qm-command-preview-wrap'>
        {
          hasParams
            ? (
              <Button
                size='small'
                className='qm-command-preview-toggle qm-command-preview-toggle-inline'
                onClick={() => setShowPendingPreview(false)}
              >
                {e('shellpilotQuickCollapsePreview')}
              </Button>
              )
            : null
        }
        <div className='qm-command-preview-label'>{e('shellpilotQuickFinalCommandPreview')}</div>
        <Input.TextArea
          value={pendingCommand?.text || ''}
          onChange={handlePendingChange}
          rows={8}
          spellCheck={false}
        />
      </div>
    )
  }

  function filterArray (array, keyword, label) {
    return array.filter(obj => {
      const text = [
        obj.name,
        obj.description,
        obj.usage,
        ...(obj.labels || [])
      ].filter(Boolean).join(' ').toLowerCase()
      const nameMatches = !keyword || text.includes(keyword)
      const labelMatches = !label || (obj.labels || []).includes(label)
      return nameMatches && labelMatches
    })
  }

  const {
    openQuickCommandBar,
    pinnedQuickCommandBar,
    qmSortByFrequency,
    inActiveTerminal,
    shellGeometry
  } = props
  if ((!openQuickCommandBar && !pinnedQuickCommandBar) || !inActiveTerminal) {
    return null
  }
  const all = props.currentQuickCommands
  // if (!all.length) {
  //   return renderNoCmd()
  // }
  const keyword0 = keyword.toLowerCase()
  const filtered = filterArray(all, keyword0, label)
  const sorted = qmSortByFrequency
    ? sortBy(filtered, (obj) => -(obj.clickCount || 0))
    : filtered
  const sprops = {
    value: label,
    onChange: handleChangeLabels,
    placeholder: e('labels'),
    className: 'qm-label-select',
    allowClear: true
  }
  const tp = pinnedQuickCommandBar
    ? 'primary'
    : 'text'
  const cls = classNames('qm-list-wrap')
  const type = qmSortByFrequency ? 'primary' : 'default'
  const { left, right } = shellGeometry.terminalInsets
  const pinnedGeometry = pinnedQuickCommandBar
    ? {
        height: shellGeometry.quickCommandBar.height,
        bottom: shellGeometry.quickCommandBar.bottom
      }
    : {}
  const qmProps = {
    className: 'qm-wrap-tooltip',
    style: {
      left,
      '--quick-command-right-offset': `${right + 10}px`,
      ...pinnedGeometry
    },
    onMouseLeave: handleMouseLeave,
    onMouseEnter: handleMouseEnter
  }
  return (
    <div
      {...qmProps}
    >
      <div className='pd2'>
        <Flex className='qm-panel-head' justify='space-between' align='center'>
          <div>
            <div className='qm-panel-title'>{e('shellpilotQuickCommands')}</div>
            <div className='qm-panel-subtitle'>{e('shellpilotQuickCommandsDescription')}</div>
          </div>
          <div className='qm-panel-count'>{sorted.length}/{all.length}</div>
        </Flex>
        <Flex justify='space-between' className='qm-flex'>
          <Input.Search
            value={keyword}
            onChange={handleChange}
            placeholder={e('shellpilotQuickSearchPlaceholder')}
            className='qm-search-input'
          />
          <Flex gap='small'>
            <Select
              {...sprops}
            >
              {props.quickCommandTags.map(
                renderTag
              )}
            </Select>
            <Button
              type={type}
              onClick={window.store.handleSortByFrequency}
            >
              {e('sortByFrequency')}
            </Button>
          </Flex>
          <Space.Compact className='mg2l'>
            <Button
              onClick={handleTogglePinned}
              icon={<PushpinOutlined />}
              type={tp}
              aria-label={pinnedQuickCommandBar ? e('shellpilotQuickUnpinPanel') : e('shellpilotQuickPinPanel')}
            />
            <Button
              onClick={window.store.handleOpenQuickCommandsSetting}
              icon={<EditOutlined />}
            />
            <Button
              onClick={handleClose}
              icon={<CloseCircleOutlined />}
            />
          </Space.Compact>
        </Flex>
        {renderRollbackRecord()}
        <div className={cls}>
          {sorted.map(renderItem)}
          {
            !sorted.length && renderNoCmd()
          }
        </div>
      </div>
      <Modal
        title={tf('shellpilotQuickConfirmCommand', { name: pendingCommand?.name || '' })}
        open={Boolean(pendingCommand)}
        onCancel={handlePendingCancel}
        onOk={handlePendingOk}
        okText={e('shellpilotQuickSendToSsh')}
        cancelText={e('cancel')}
        className='qm-command-modal'
        width={720}
      >
        <div className='qm-command-modal-desc'>
          <div className='qm-command-modal-context'>{e('shellpilotQuickCurrentContext')}：{pendingCommand?.contextLabel}</div>
          <div>{pendingCommand?.description}</div>
          <div>{pendingCommand?.usage}</div>
        </div>
        {renderNetworkProbe()}
        {renderTargetDiscovery()}
        {renderPendingParams()}
        {renderRollbackProtection()}
        {
          pendingCommand?.advancedUsage?.length
            ? (
              <div className='qm-command-modal-tips'>
                <div className='qm-command-modal-tips-title'>{e('shellpilotQuickAdvancedUsage')}</div>
                {
                  pendingCommand.advancedUsage.map((tip, index) => (
                    <div className='qm-command-modal-tip' key={`${tip}-${index}`}>{tip}</div>
                  ))
                }
              </div>
              )
            : null
        }
        {renderCommandPreview()}
      </Modal>
    </div>
  )
}
