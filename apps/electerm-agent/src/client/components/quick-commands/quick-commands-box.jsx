/**
 * quick commands footer selection wrap
 */

import { useEffect, useState, useRef } from 'react'
import { pinnedQuickCommandBarKey, quickCommandLabelsLsKey } from '../../common/constants'
import { sortBy } from 'lodash-es'
import { Button, Input, InputNumber, Select, Space, Flex, Modal } from 'antd'
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

const e = window.translate
const addQuickCommands = 'addQuickCommands'
const networkChangeCommandId = 'builtin-server-network-change-ip'
const { Option } = Select

export default function QuickCommandsFooterBox (props) {
  const [keyword, setKeyword] = useState('')
  const [label, setLabel] = useState(ls.getItem(quickCommandLabelsLsKey, ''))
  const [pendingCommand, setPendingCommand] = useState(null)
  const [showPendingPreview, setShowPendingPreview] = useState(false)
  const [networkProbe, setNetworkProbe] = useState({ loading: false, error: '', detected: null })
  const [safetyRecords, setSafetyRecords] = useState(() => readSafetyOperationRecords(ls))
  const timer = useRef(null)
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

  async function mcpRunQuickCommandNetworkProbe (item, context) {
    setNetworkProbe({ loading: true, error: '', detected: null })
    try {
      const tabId = props.currentTab?.id || window.store.activeTabId
      const terminal = refs.get('term-' + tabId)
      if (!terminal?.pid || !terminal?.isSsh?.()) {
        throw new Error('当前标签不是已连接的 SSH 会话，请连接服务器后重新检测')
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
        error: error?.message || '自动识别失败，请手动填写网络参数',
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
      message.warning(`请先连接服务器 ${rollbackRecord.host || ''}，再执行快捷回滚。`)
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
                  {networkInterface.name} · {networkInterface.cidr || '无 IPv4'} · {networkInterface.state}
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
            <div className='qm-network-probe-title'>当前服务器网络</div>
            {
              networkProbe.loading
                ? <div className='qm-network-probe-status'>正在自动识别网卡和网络参数...</div>
                : null
            }
            {
              detected
                ? (
                  <div className='qm-network-probe-values'>
                    <span>识别到 {interfaceCount} 张网卡</span>
                    <span>当前选择：{selectedName}</span>
                    <span>当前 CIDR：{selectedInterface?.cidr || detected.cidr || '未获取'}</span>
                    <span>状态：{selectedInterface?.state || '未知'}</span>
                    <span>网关：{detected.gateway || '未获取'}</span>
                    <span>DNS：{detected.dns || '未获取'}</span>
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
            重新检测
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
          <div className='qm-rollback-preview-title'>快捷回滚：{pendingCommand.item.rollback.title}</div>
          <Button
            danger
            size='small'
            disabled={!(rollbackRecord?.rollbackPath || rollbackRecord?.path)}
            onClick={() => handleRollbackAction('rollback')}
          >
            {(rollbackRecord?.rollbackPath || rollbackRecord?.path) ? '立即回滚上一次修改' : '暂无可回滚修改'}
          </Button>
        </div>
        <div>
          {isNetworkChange
            ? (enabled
                ? `执行修改后 ${values.自动回滚秒数 || 120} 秒内未确认保留，服务器将自动恢复原 IP、路由和 NetworkManager 配置。`
                : '关闭后客户端仍会生成回滚脚本，但不会自动恢复网络。')
            : '执行修改前会记录原状态并生成远端回滚脚本；执行后可在快捷命令面板点击“立即回滚”。'}
        </div>
        <div className='qm-rollback-preview-path'>回滚脚本：{values[pendingCommand.item.rollback.pathParam] || pendingCommand.context.rollbackPath}</div>
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
          <div className='qm-rollback-record-title'>{rollbackRecord.title || '服务器修改'} · 快捷回滚</div>
          <div className='qm-rollback-record-desc'>
            {rollbackRecord.host || '当前服务器'} · {rollbackRecord.protected ? `${rollbackRecord.seconds} 秒自动回滚保护已启动` : '已生成手动回滚脚本'}
          </div>
          <div className='qm-rollback-record-path'>{path}</div>
        </div>
        <Space>
          <Button
            disabled={Boolean(rollbackRunning)}
            loading={rollbackRunning === rollbackRecord.id}
            onClick={() => handleRollbackAction('keep')}
          >
            保留新配置
          </Button>
          <Button
            danger
            type='primary'
            disabled={Boolean(rollbackRunning)}
            loading={rollbackRunning === rollbackRecord.id}
            onClick={() => handleRollbackAction('rollback')}
          >
            立即回滚
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
        <div className='qm-command-param-title'>按表单填写参数（推荐）</div>
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
          高级：查看/微调命令
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
                收起命令预览
              </Button>
              )
            : null
        }
        <div className='qm-command-preview-label'>最终命令预览（高级用户可手动微调）</div>
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
            <div className='qm-panel-title'>快捷命令</div>
            <div className='qm-panel-subtitle'>常用服务器维护、调试、排查命令，带参数的命令会先编辑确认。</div>
          </div>
          <div className='qm-panel-count'>{sorted.length}/{all.length}</div>
        </Flex>
        <Flex justify='space-between' className='qm-flex'>
          <Input.Search
            value={keyword}
            onChange={handleChange}
            placeholder='搜索命令、用途或标签'
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
              aria-label={pinnedQuickCommandBar ? '取消固定快捷命令面板' : '固定快捷命令面板'}
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
        title={`确认快捷命令：${pendingCommand?.name || ''}`}
        open={Boolean(pendingCommand)}
        onCancel={handlePendingCancel}
        onOk={handlePendingOk}
        okText='发送到 SSH'
        cancelText='取消'
        className='qm-command-modal'
        width={720}
      >
        <div className='qm-command-modal-desc'>
          <div className='qm-command-modal-context'>当前上下文：{pendingCommand?.contextLabel}</div>
          <div>{pendingCommand?.description}</div>
          <div>{pendingCommand?.usage}</div>
        </div>
        {renderNetworkProbe()}
        {renderPendingParams()}
        {renderRollbackProtection()}
        {
          pendingCommand?.advancedUsage?.length
            ? (
              <div className='qm-command-modal-tips'>
                <div className='qm-command-modal-tips-title'>进阶用法</div>
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
