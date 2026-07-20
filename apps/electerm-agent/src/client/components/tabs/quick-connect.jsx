import { useState, useRef, useEffect } from 'react'
import { Button, Space, Input, Select, Checkbox } from 'antd'
import { ArrowRightOutlined, ThunderboltOutlined } from '@ant-design/icons'
import message from '../common/message'
import InputAutoFocus from '../common/input-auto-focus'
import HelpIcon from '../common/help-icon'
import {
  buildQuickConnectBookmark,
  buildQuickConnectOptions,
  QUICK_CONNECT_DEFAULT_PORTS,
  QUICK_CONNECT_PROTOCOLS
} from './quick-connect-options.js'
import './quick-connect.styl'

const e = window.translate
const { TextArea } = Input

/**
 * Connect using parsed options
 * @param {object} opts - Connection options
 * @param {number} batch - Batch number
 */
function connectWithOptions (opts, batch) {
  const { store } = window
  const tabOptions = {
    ...opts,
    from: 'quickConnect',
    batch
  }

  delete window.openTabBatch
  store.addTab(tabOptions)
}

export default function QuickConnect ({ batch, inputOnly, formOnly }) {
  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [formValues, setFormValues] = useState({
    protocol: 'ssh',
    host: '',
    port: '22',
    username: '',
    password: '',
    authType: 'password',
    privateKey: '',
    passphrase: '',
    sshAgent: '',
    profile: '',
    title: '',
    saveAsBookmark: false
  })
  const inputRef = useRef(null)

  // When inputOnly is true, always show the input (without auto-focus)
  useEffect(() => {
    if (inputOnly) {
      setShowInput(true)
    } else if (showInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [inputOnly, showInput])

  const handleToggle = () => {
    setShowInput(!showInput)
    if (showInput) {
      setInputValue('')
    }
  }

  function handleChange (e) {
    setInputValue(e.target.value)
  }

  function updateFormValue (key, value) {
    const next = {
      ...formValues,
      [key]: value
    }
    if (key === 'protocol') {
      next.port = String(QUICK_CONNECT_DEFAULT_PORTS[value] || '')
      if (value !== 'ssh') {
        next.authType = 'password'
      }
    }
    setFormValues(next)
  }

  const handleConnect = () => {
    if (!inputValue.trim()) {
      return
    }

    const opts = window.store.parseQuickConnect(inputValue)
    if (!opts) {
      return message.error(e('shellpilotQuickConnectInvalidString'), 10)
    }

    connectWithOptions(opts, batch)
    setInputValue('')
    setShowInput(false)
  }

  const handleFormConnect = () => {
    if (!formValues.host.trim()) {
      return message.error(e('shellpilotQuickConnectHostRequired'))
    }
    const opts = buildQuickConnectOptions(formValues)
    if (!opts) {
      return message.error(e('shellpilotQuickConnectInvalidHostPort'))
    }
    if (formValues.saveAsBookmark) {
      window.store.addItem(buildQuickConnectBookmark(opts), 'bookmarks')
    }
    connectWithOptions(opts, batch)
    setFormValues({
      ...formValues,
      host: '',
      password: '',
      privateKey: '',
      passphrase: ''
    })
    setShowInput(false)
  }

  function renderInput () {
    if (!showInput && !inputOnly) {
      return null
    }
    const inputProps = {
      ref: inputRef,
      value: inputValue,
      onChange: handleChange,
      className: 'width-100 quick-connect-input',
      onPressEnter: handleConnect,
      placeholder: e('shellpilotQuickConnectPastePlaceholder'),
      prefix: inputOnly ? <HelpIcon link={wiki} /> : undefined
    }
    const iconProps = {
      onClick: handleConnect,
      title: e('connect'),
      icon: <ArrowRightOutlined />
    }
    const iconsProps1 = {
      icon: <ThunderboltOutlined />
    }
    return (
      <Space.Compact className='pd1y pd2x width-100'>
        <Button
          {...iconsProps1}
        />
        {inputOnly ? <Input {...inputProps} /> : <InputAutoFocus {...inputProps} />}
        <Button
          {...iconProps}
        />
      </Space.Compact>
    )
  }
  const wiki = 'https://github.com/lx3559359/ssh-agent-tool/blob/master/docs/USER_GUIDE_ZH.md'

  function renderForm () {
    if (!showInput && !formOnly) {
      return null
    }
    const isSsh = formValues.protocol === 'ssh'
    const profileOptions = (window.store.profiles || []).map(item => ({
      value: item.id,
      label: item.name || item.id
    }))
    return (
      <div className='quick-connect-form'>
        <div className='quick-connect-form-title'>
          <ThunderboltOutlined />
          <span>{e('shellpilotQuickConnectServer')}</span>
        </div>
        <Space.Compact className='width-100 mg1b'>
          <Select
            value={formValues.protocol}
            options={QUICK_CONNECT_PROTOCOLS}
            onChange={value => updateFormValue('protocol', value)}
            className='quick-connect-protocol'
          />
          <Input
            value={formValues.host}
            onChange={e => updateFormValue('host', e.target.value)}
            placeholder={e('shellpilotQuickConnectHostPlaceholder')}
            onPressEnter={handleFormConnect}
          />
          <Input
            value={formValues.port}
            onChange={e => updateFormValue('port', e.target.value)}
            placeholder={e('shellpilotPort')}
            className='quick-connect-port'
            onPressEnter={handleFormConnect}
          />
        </Space.Compact>
        <Space.Compact className='width-100 mg1b'>
          <Input
            value={formValues.username}
            onChange={e => updateFormValue('username', e.target.value)}
            placeholder={e('shellpilotOptionalUsername')}
            onPressEnter={handleFormConnect}
          />
          {
            isSsh
              ? (
                <Select
                  value={formValues.authType}
                  onChange={value => updateFormValue('authType', value)}
                  className='quick-connect-auth-type'
                  placeholder={e('shellpilotAuthenticationMethod')}
                  options={[
                    { value: 'password', label: e('shellpilotPassword') },
                    { value: 'privateKey', label: e('shellpilotPrivateKey') },
                    { value: 'sshAgent', label: 'SSH Agent' },
                    { value: 'profiles', label: e('shellpilotCredentialProfile') }
                  ]}
                />
                )
              : (
                <Input.Password
                  value={formValues.password}
                  onChange={e => updateFormValue('password', e.target.value)}
                  placeholder={e('shellpilotOptionalPassword')}
                  onPressEnter={handleFormConnect}
                />
                )
          }
        </Space.Compact>
        {
          isSsh && formValues.authType === 'password'
            ? (
              <Input.Password
                value={formValues.password}
                onChange={e => updateFormValue('password', e.target.value)}
                placeholder={e('shellpilotOptionalPassword')}
                className='width-100 mg1b'
                onPressEnter={handleFormConnect}
              />
              )
            : null
        }
        {
          isSsh && formValues.authType === 'privateKey'
            ? (
              <>
                <TextArea
                  value={formValues.privateKey}
                  onChange={e => updateFormValue('privateKey', e.target.value)}
                  placeholder={e('shellpilotPrivateKeyPlaceholder')}
                  className='width-100 mg1b'
                  autoSize={{ minRows: 3, maxRows: 6 }}
                />
                <Input.Password
                  value={formValues.passphrase}
                  onChange={e => updateFormValue('passphrase', e.target.value)}
                  placeholder={e('shellpilotOptionalPassphrase')}
                  className='width-100 mg1b'
                  onPressEnter={handleFormConnect}
                />
              </>
              )
            : null
        }
        {
          isSsh && formValues.authType === 'sshAgent'
            ? (
              <Input
                value={formValues.sshAgent}
                onChange={e => updateFormValue('sshAgent', e.target.value)}
                placeholder={e('shellpilotSshAgentPathPlaceholder')}
                className='width-100 mg1b'
                onPressEnter={handleFormConnect}
              />
              )
            : null
        }
        {
          isSsh && formValues.authType === 'profiles'
            ? (
              <Select
                value={formValues.profile || undefined}
                onChange={value => updateFormValue('profile', value)}
                className='width-100 mg1b'
                placeholder={e('shellpilotSelectCredentialProfile')}
                options={profileOptions}
                allowClear
              />
              )
            : null
        }
        <Space.Compact className='width-100 mg1b'>
          <Input
            value={formValues.title}
            onChange={e => updateFormValue('title', e.target.value)}
            placeholder={e('shellpilotConnectionNamePlaceholder')}
            onPressEnter={handleFormConnect}
          />
        </Space.Compact>
        <Checkbox
          checked={formValues.saveAsBookmark}
          onChange={e => updateFormValue('saveAsBookmark', e.target.checked)}
          className='mg1b'
        >
          {e('shellpilotSaveAsConnection')}
        </Checkbox>
        <Button
          type='primary'
          icon={<ArrowRightOutlined />}
          onClick={handleFormConnect}
          block
        >
          {e('connect')}
        </Button>
      </div>
    )
  }

  // If inputOnly is true, don't show the button, just render input directly
  if (inputOnly) {
    return renderInput()
  }

  if (formOnly) {
    return renderForm()
  }

  const btnProps = {
    onClick: handleToggle,
    icon: <ThunderboltOutlined />,
    title: e('quickConnect')
  }
  return (
    <>
      <Button
        {...btnProps}
      >
        <span className='mg1r'>{e('quickConnect')}</span>
        <HelpIcon link={wiki} />
      </Button>
      {renderForm()}
    </>
  )
}
