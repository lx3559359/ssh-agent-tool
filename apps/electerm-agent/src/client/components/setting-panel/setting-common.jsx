import React, { Component } from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowRightOutlined,
  LoadingOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons'
import message from '../common/message'
import {
  Select,
  Switch,
  Button,
  Table,
  Space,
  Tag
} from 'antd'
import deepCopy from 'json-deep-copy'
import Password from '../common/password'
import InputConfirm from '../common/input-confirm'
import NativeNumberConfirm from './native-number-confirm'
import TextareaConfirm from '../common/textarea-confirm'
import {
  settingMap,
  proxyHelpLink
} from '../../common/constants'
import defaultSettings from '../../common/default-setting'
import Link from '../common/external-link'
import { isNumber } from 'lodash-es'
import { getThemeDisplayName } from '../../common/shellpilot-ui-palettes.js'
import { createFrameBatchedMount } from '../../common/frame-batched-mount.js'
import StartSession from './start-session-select'
import HelpIcon from '../common/help-icon'
import delay from '../../common/wait.js'
import isColorDark from '../../common/is-color-dark'
import DeepLinkControl from './deep-link-control'
import HotkeySetting from './hotkey'
import SettingSection from './setting-section'
import UiFontPicker from './ui-font-picker'
import './setting.styl'

const { Option } = Select
const e = window.translate

export default class SettingCommon extends Component {
  state = {
    mountedSectionIndexes: [1],
    mountedStartupDetails: [],
    submittingPass: false,
    passInputFocused: false,
    placeholderLogin: window.pre.requireAuth ? '********' : e('notSet'),
    loginPass: ''
  }

  sectionPlaceholders = new Map()

  visibleSectionIndexes = new Set()

  sectionMountEnabled = false

  componentDidMount () {
    this.startSectionMount()
    this.startStartupDetailsMount()
  }

  componentWillUnmount () {
    clearTimeout(this.timer1)
    clearTimeout(this.sectionFallbackTimer)
    clearTimeout(this.startupDetailsTimer)
    if (
      this.startupDetailsIdleId !== undefined &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(this.startupDetailsIdleId)
    }
    this.sectionScheduler?.cancel()
    this.startupDetailsScheduler?.cancel()
    this.sectionObserver?.disconnect()
    this.sectionRoot?.removeEventListener('scroll', this.handleSectionScroll)
  }

  mountStartupDetail = detail => {
    this.setState(state => ({
      mountedStartupDetails: state.mountedStartupDetails.includes(detail)
        ? state.mountedStartupDetails
        : [...state.mountedStartupDetails, detail]
    }), () => {
      if (detail === 'hotkey') this.scheduleStartupDetails()
    })
  }

  scheduleStartupDetails = () => {
    if (this.startupDetailsTimer !== undefined) return
    const mountDetails = () => {
      this.startupDetailsIdleId = undefined
      this.mountStartupDetail('session')
      this.mountStartupDetail('numbers')
    }
    this.startupDetailsTimer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        this.startupDetailsIdleId = window.requestIdleCallback(mountDetails, { timeout: 600 })
      } else {
        mountDetails()
      }
    }, 160)
  }

  startStartupDetailsMount = () => {
    this.startupDetailsScheduler = createFrameBatchedMount({
      onMount: detail => {
        flushSync(() => this.mountStartupDetail(detail))
      }
    })
    this.startupDetailsScheduler.start()
    this.startupDetailsScheduler.request('hotkey')
  }

  startSectionMount = () => {
    this.sectionScheduler = createFrameBatchedMount({
      onMount: index => this.setState(state => ({
        mountedSectionIndexes: state.mountedSectionIndexes.includes(index)
          ? state.mountedSectionIndexes
          : [...state.mountedSectionIndexes, index]
      }))
    })
    this.sectionScheduler.start([1])
    this.sectionRoot = this.formRoot?.closest('.setting-col-content')
    if (window.IntersectionObserver) {
      this.sectionObserver = new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          const index = Number(entry.target.dataset.sectionIndex)
          if (entry.isIntersecting) this.visibleSectionIndexes.add(index)
          else this.visibleSectionIndexes.delete(index)
        }
        if (this.sectionMountEnabled) this.requestVisibleSections()
      }, {
        root: this.sectionRoot,
        rootMargin: '0px 0px -50% 0px'
      })
      this.sectionRoot?.addEventListener('scroll', this.handleSectionScroll, {
        passive: true
      })
      for (const node of this.sectionPlaceholders.values()) {
        this.sectionObserver.observe(node)
      }
      return
    }
    this.sectionFallbackTimer = window.setTimeout(() => {
      [2, 3, 4].forEach(index => this.sectionScheduler.request(index))
    }, 100)
  }

  requestVisibleSections = () => {
    for (const index of this.visibleSectionIndexes) {
      this.sectionScheduler.request(index)
    }
  }

  handleSectionScroll = () => {
    if (this.sectionMountEnabled || !this.sectionRoot) return
    if (this.sectionRoot.scrollTop <= 0) return
    this.sectionMountEnabled = true
    this.requestVisibleSections()
  }

  setSectionPlaceholder = (index, node) => {
    const previous = this.sectionPlaceholders.get(index)
    if (previous) this.sectionObserver?.unobserve(previous)
    if (!node) {
      this.sectionPlaceholders.delete(index)
      return
    }
    this.sectionPlaceholders.set(index, node)
    this.sectionObserver?.observe(node)
  }

  renderDeferredSection = ({
    index,
    name,
    title,
    description,
    renderBody
  }) => {
    const className = `sp-setting-section-${name}`
    if (this.state.mountedSectionIndexes.includes(index)) {
      return (
        <SettingSection
          key={name}
          className={className}
          title={title}
          description={description}
        >
          {renderBody()}
        </SettingSection>
      )
    }
    return (
      <div
        key={name}
        aria-hidden='true'
        className={`sp-setting-section-placeholder ${className}`}
        data-section-index={index}
        ref={node => this.setSectionPlaceholder(index, node)}
      />
    )
  }

  handleLoginSubmit = async () => {
    if (this.submitting) {
      return
    }
    this.submitting = true
    this.setState({
      submittingPass: true
    })
    const pass = this.state.loginPass
    const r = await window.pre.runGlobalAsync(
      'setPassword',
      pass
    )
    await delay(600)
    if (r === true) {
      window.pre.requireAuth = !!pass
      this.setState({
        loginPass: pass ? '********' : '',
        submittingPass: false,
        placeholderLogin: pass ? '********' : e('notSet')
      }, () => {
        this.submitting = false
      })
      message.success(e('ok'))
    } else {
      this.setState({
        submittingPass: false
      }, () => {
        this.submitting = false
      })
    }
  }

  handleLoginPassFocus = () => {
    this.setState({
      passInputFocused: true
    })
  }

  blurPassInput = () => {
    this.setState({
      passInputFocused: false
    })
  }

  handleLoginPassBlur = () => {
    this.timer1 = setTimeout(
      this.blurPassInput, 300
    )
  }

  handleChangeLoginPass = e => {
    this.setState({
      loginPass: e.target.value
    })
  }

  handleResetAll = () => {
    this.saveConfig(
      deepCopy(defaultSettings)
    )
  }

  onChangeTimeout = sshReadyTimeout => {
    return this.saveConfig({
      sshReadyTimeout
    })
  }

  handleChangeTerminalTheme = id => {
    this.props.store.setTheme(id)
  }

  handleCustomCss = (value) => {
    this.onChangeValue(value, 'customCss')
  }

  onChangeValue = (value, name) => {
    if (name === 'useSystemTitleBar') {
      message.info(e('useSystemTitleBarTip'), 5)
    }
    if (name === 'disableConnectionHistory' && value) {
      window.store.history = []
    }
    this.saveConfig({
      [name]: value
    })
  }

  onChangeStartSessions = value => {
    this.onChangeValue(value, 'onStartSessions')
  }

  saveConfig = async (ext) => {
    const { config } = this.props
    if (ext.hotkey && ext.hotkey !== config.hotkey) {
      const res = await window.pre.runGlobalAsync('changeHotkey', ext.hotkey)
      if (!res) {
        message.warning(e('hotkeyNotOk'))
        delete ext.hotkey
      } else {
        message.success(e('saved'))
      }
    }
    this.props.store.setConfig(ext)
  }

  renderToggle = (name, extra = null) => {
    const checked = !!this.props.config[name]
    return (
      <div className='pd2b' key={'rt' + name}>
        <Switch
          checked={checked}
          checkedChildren={e(name)}
          unCheckedChildren={e(name)}
          onChange={v => this.onChangeValue(v, name)}
        />
        {isNumber(extra) ? null : extra}
      </div>
    )
  }

  renderNumber = (name, options, title = '') => {
    let value = this.props.config[name]
    if (options.valueParser) {
      value = options.valueParser(value)
    }
    const defaultValue = defaultSettings[name]
    const inputId = `setting-number-${name}`
    const helpId = `setting-number-${name}-help`
    const description = [title, options.extraDesc].filter(Boolean).join(' · ')
    const {
      step = 1,
      min,
      max,
      cls,
      onChange = (v) => {
        this.onChangeValue(v, name)
      }
    } = options
    const opts = {
      step,
      value,
      min,
      max,
      onChange,
      placeholder: defaultValue
    }
    return (
      <div className={`sp-setting-field sp-setting-number-field pd2b ${cls || ''}`}>
        <label htmlFor={inputId}>{description}</label>
        <NativeNumberConfirm
          {...opts}
          id={inputId}
          aria-describedby={helpId}
          aria-label={title}
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={value}
        />
        <small className='setting-number-help' id={helpId}>
          {description}
        </small>
      </div>
    )
  }

  renderText = (name, placeholder) => {
    const value = this.props.config[name]
    const defaultValue = defaultSettings[name]
    const onChange = (v) => this.onChangeValue(v, name)
    return (
      <div className='sp-setting-control pd2b'>
        <InputConfirm
          value={value}
          onChange={onChange}
          placeholder={placeholder || defaultValue}
        />
      </div>
    )
  }

  renderTextExec = (name) => {
    const agrsProp = `${name}Args`
    const args = this.props.config[agrsProp]
    const value = this.props.config[name]
    const defaultValue = defaultSettings[name]
    const onChange = (v) => this.onChangeValue(v, name)
    const onChangeArgs = (v) => this.onChangeValue(v, agrsProp)
    const styleArg = {
      style: {
        width: '40%'
      }
    }
    return (
      <div className='sp-setting-control pd2b'>
        <Space.Compact className='width-100'>
          <InputConfirm
            value={value}
            onChange={onChange}
            placeholder={defaultValue}
          />
          <Select
            {...styleArg}
            placeholder={e('shellpilotArguments')}
            onChange={onChangeArgs}
            value={args}
            mode='tags'
          >
            {
              args.map((arg, i) => {
                return (
                  <Option key={arg + '__' + i} value={arg}>
                    {arg}
                  </Option>
                )
              })
            }
          </Select>
        </Space.Compact>
      </div>
    )
  }

  renderReset = () => {
    return (
      <div className='sp-setting-actions pd1b pd1t'>
        <Button
          onClick={this.handleResetAll}
        >
          {e('resetAllToDefault')}
        </Button>
      </div>
    )
  }

  renderProxy () {
    const {
      enableGlobalProxy
    } = this.props.config
    const helps = `http# http://proxy-server-over-tcp.com:3128
      https#https://proxy-server-over-tls.com:3129
      socks(v5)#socks://username:password@some-socks-proxy.com:9050 (username & password are optional)
      socks5#socks5://username:password@some-socks-proxy.com:9050 (username & password are optional)
      socks5h#socks5h://username:password@some-socks-proxy.com:9050 (username & password are optional)
      socks4#socks4://some-socks-proxy.com:9050
      socks4a#socks4a://some-socks-proxy.com:9050`
      .split('\n')
      .filter(d => d.trim())
      .map(d => {
        const [protocol, example] = d.split('#')
        return {
          protocol, example
        }
      })
    const cols = Object.keys(helps[0]).map(k => {
      return {
        title: k,
        dataIndex: k,
        key: k,
        render: (k) => k || ''
      }
    })
    const table = (
      <div>
        <Table
          columns={cols}
          dataSource={helps}
          bordered
          pagination={false}
          size='small'
          rowKey='protocol'
        />
        <div>
          <Link to={proxyHelpLink}>{proxyHelpLink}</Link>
        </div>
      </div>
    )
    const style = {
      height: '414px',
      width: '500px'
    }
    return (
      <div className='sp-setting-field sp-setting-field-stacked pd1b'>
        <div className='pd1b'>
          <span className='pd1r'>
            {e('global')} {e('proxy')}
            <HelpIcon
              title={table}
              style={{ body: { style } }}
            />
          </span>
          <Switch
            checked={enableGlobalProxy}
            onChange={v => {
              this.onChangeValue(v, 'enableGlobalProxy')
            }}
          />
        </div>
        {
          this.renderText('proxy', 'socks5://127.0.0.1:1080')
        }
      </div>
    )
  }

  renderLoginPassAfter () {
    const {
      loginPass,
      submittingPass,
      passInputFocused
    } = this.state
    if (!loginPass && !passInputFocused) {
      return null
    } else if (
      submittingPass
    ) {
      return <LoadingOutlined />
    }
    return (
      <ArrowRightOutlined
        className='pointer'
        onClick={this.handleLoginSubmit}
      />
    )
  }

  renderLoginPass () {
    if (window.et.isWebApp) {
      return null
    }
    const {
      loginPass,
      submittingPass,
      placeholderLogin
    } = this.state
    const props = {
      value: loginPass,
      disabled: submittingPass,
      onFocus: this.handleLoginPassFocus,
      onBlur: this.handleLoginPassBlur,
      onChange: this.handleChangeLoginPass,
      suffix: this.renderLoginPassAfter(),
      placeholder: placeholderLogin
    }
    return (
      <div>
        <div className='pd1b'>{e('loginPassword')}</div>
        <div className='pd2b'>
          <Password
            {...props}
          />
        </div>
      </div>
    )
  }

  renderUpdateChannel () {
    const value = this.props.config.updateChannel || defaultSettings.updateChannel
    return (
      <div className='sp-setting-field pd2b'>
        <span className='inline-title mg1r'>{e('themeUpdateChannel')}</span>
        <Select
          onChange={v => this.onChangeValue(v, 'updateChannel')}
          popupMatchSelectWidth={false}
          value={value}
        >
          <Option value='stable'>{e('shellpilotStableRelease')}</Option>
          <Option value='beta'>{e('shellpilotBetaRelease')}</Option>
        </Select>
        <span className='mg1l color-grey'>
          {e('shellpilotUpdateChannelDescription')}
        </span>
      </div>
    )
  }

  renderUpdateSource () {
    const value = this.props.config.updateSource || defaultSettings.updateSource
    return (
      <div className='sp-setting-field pd2b'>
        <span className='inline-title mg1r'>{e('shellpilotUpdateSource')}</span>
        <Select
          onChange={v => this.onChangeValue(v, 'updateSource')}
          popupMatchSelectWidth={false}
          value={value}
        >
          <Option value='auto'>{e('shellpilotAutomaticRecommended')}</Option>
          <Option value='modelscope'>{e('shellpilotModelScopeRegionalSource')}</Option>
          <Option value='github'>GitHub</Option>
        </Select>
        <span className='mg1l color-grey'>
          {e('shellpilotUpdateSourceDescription')}
        </span>
      </div>
    )
  }

  renderAppearanceFields = (terminalThemes, theme, customCss) => {
    return (
      <>
        {
          this.renderNumber('opacity', {
            step: 0.05,
            min: 0,
            max: 1,
            cls: 'opacity'
          }, e('opacity'))
        }
        <div className='sp-setting-field pd2b'>
          <span className='inline-title mg1r'>{e('uiThemes')}</span>
          <Select
            onChange={this.handleChangeTerminalTheme}
            popupMatchSelectWidth={false}
            value={theme}
          >
            {
              terminalThemes
                .filter(d => d.id && d.name && d.uiThemeConfig)
                .map(l => {
                  const { id, uiThemeConfig } = l
                  const displayName = getThemeDisplayName(l, e)
                  const { main, text } = uiThemeConfig
                  const isDark = isColorDark(main)
                  const txt = isDark ? <MoonOutlined /> : <SunOutlined />
                  const tag = (
                    <Tag
                      color={main}
                      className='mg1l'
                      variant='solid'
                      style={
                        {
                          color: text
                        }
                      }
                    >
                      {txt}
                    </Tag>
                  )
                  return (
                    <Option key={id} value={id}>
                      {tag} {displayName}
                    </Option>
                  )
                })
            }
          </Select>
        </div>

        <UiFontPicker store={this.props.store} />

        <div className='sp-setting-field sp-setting-field-stacked pd2b'>
          <span className='inline-title mg1r'>{e('customCss')}</span>
          <TextareaConfirm
            onChange={this.handleCustomCss}
            value={customCss}
            rows={3}
          />
        </div>
      </>
    )
  }

  renderAdvancedFields = () => {
    return (
      <>
        <div className='sp-setting-field sp-setting-field-stacked'>
          <div className='pd1b'>{e('default')} {e('execWindows')}</div>
          {this.renderTextExec('execWindows')}
        </div>
        <div className='sp-setting-field sp-setting-field-stacked'>
          <div className='pd1b'>{e('default')} {e('execMac')}</div>
          {this.renderTextExec('execMac')}
        </div>
        <div className='sp-setting-field sp-setting-field-stacked'>
          <div className='pd1b'>{e('default')} {e('execLinux')}</div>
          {this.renderTextExec('execLinux')}
        </div>
        <div className='sp-setting-field sp-setting-field-stacked'>
          <div className='pd1b'>{e('keyword2FA')}</div>
          {this.renderText('keyword2FA')}
        </div>
        <div className='sp-setting-toggle-grid'>
          {
            [
              'autoRefreshWhenSwitchToSftp',
              'showHiddenFilesOnSftpStart',
              'screenReaderMode',
              'initDefaultTabOnStart',
              'disableConnectionHistory',
              'disableTransferHistory',
              'checkUpdateOnStart',
              'useSystemTitleBar',
              'confirmBeforeExit',
              'hideIP',
              'allowMultiInstance',
              'disableDeveloperTool',
              'debug'
            ].map(this.renderToggle)
          }
        </div>
        {
          window.et.isWebApp ? null : <DeepLinkControl />
        }
        {this.renderLoginPass()}
        {this.renderReset()}
      </>
    )
  }

  render () {
    const { props } = this
    const {
      hotkey,
      theme,
      customCss
    } = props.config
    const terminalThemes = props.store.getSidebarList(settingMap.terminalThemes)
    const pops = {
      onStartSessions: props.config.onStartSessions,
      bookmarks: props.bookmarks,
      bookmarkGroups: props.bookmarkGroups,
      workspaces: props.store.workspaces,
      onChangeStartSessions: this.onChangeStartSessions
    }
    const hotkeyProps = {
      hotkey,
      onSaveConfig: this.saveConfig
    }
    return (
      <div
        className='form-wrap sp-settings-form'
        ref={node => { this.formRoot = node }}
      >
        <header className='sp-settings-page-header'>
          <h1>{e('generalSettings')}</h1>
          <p>{e('generalSettingsDescription')}</p>
        </header>
        {this.renderDeferredSection({
          index: 1,
          name: 'startup',
          title: e('startupAndConnection'),
          description: e('startupAndConnectionDescription'),
          renderBody: () => (
            <>
              {this.state.mountedStartupDetails.includes('hotkey')
                ? <HotkeySetting {...hotkeyProps} />
                : (
                  <div
                    aria-hidden='true'
                    className='sp-setting-startup-detail-placeholder sp-setting-startup-hotkey-placeholder'
                  />
                  )}
              {this.state.mountedStartupDetails.includes('session')
                ? (
                  <div className='sp-setting-field sp-setting-field-stacked sp-setting-startup-session'>
                    <div className='pd1b'>{e('onStartBookmarks')}</div>
                    <div className='pd2b'>
                      <StartSession {...pops} />
                    </div>
                  </div>
                  )
                : (
                  <div
                    aria-hidden='true'
                    className='sp-setting-startup-detail-placeholder sp-setting-startup-session-placeholder'
                  />
                  )}
              {this.state.mountedStartupDetails.includes('numbers')
                ? (
                  <div className='sp-setting-startup-numbers'>
                    {this.renderNumber('sshReadyTimeout', {
                      step: 200,
                      min: 100,
                      cls: 'timeout-desc',
                      extraDesc: e('shellpilotMillisecondsUnit')
                    }, e('timeoutDesc'))}
                    {this.renderNumber('keepaliveInterval', {
                      step: 1000,
                      min: 0,
                      max: 20000000,
                      cls: 'keepalive-interval-desc',
                      extraDesc: e('shellpilotMillisecondsUnit')
                    }, e('keepaliveIntervalDesc'))}
                  </div>
                  )
                : (
                  <div
                    aria-hidden='true'
                    className='sp-setting-startup-detail-placeholder sp-setting-startup-numbers-placeholder'
                  />
                  )}
            </>
          )
        })}
        {this.renderDeferredSection({
          index: 2,
          name: 'network',
          title: e('networkAndUpdates'),
          description: e('networkAndUpdatesDescription'),
          renderBody: () => (
            <>
              {this.renderProxy()}
              {this.renderUpdateChannel()}
              {this.renderUpdateSource()}
            </>
          )
        })}
        {this.renderDeferredSection({
          index: 3,
          name: 'interface',
          title: e('interfaceAndLanguage'),
          description: e('interfaceAndLanguageDescription'),
          renderBody: () => this.renderAppearanceFields(terminalThemes, theme, customCss)
        })}
        {this.renderDeferredSection({
          index: 4,
          name: 'advanced',
          title: e('advancedSettings'),
          description: e('advancedSettingsDescription'),
          renderBody: this.renderAdvancedFields
        })}
      </div>
    )
  }
}
