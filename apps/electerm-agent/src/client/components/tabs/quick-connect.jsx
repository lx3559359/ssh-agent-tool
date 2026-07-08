import { useState, useRef, useEffect } from 'react'
import { Button, Space, Input, Select } from 'antd'
import { ArrowRightOutlined, ThunderboltOutlined } from '@ant-design/icons'
import message from '../common/message'
import InputAutoFocus from '../common/input-auto-focus'
import HelpIcon from '../common/help-icon'
import {
  buildQuickConnectOptions,
  QUICK_CONNECT_DEFAULT_PORTS,
  QUICK_CONNECT_PROTOCOLS
} from './quick-connect-options.js'
import './quick-connect.styl'

const e = window.translate

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
    password: ''
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
    }
    setFormValues(next)
  }

  const handleConnect = () => {
    if (!inputValue.trim()) {
      return
    }

    const opts = window.store.parseQuickConnect(inputValue)
    if (!opts) {
      return message.error('连接信息格式不正确，请检查服务器地址、用户名、端口或协议', 10)
    }

    connectWithOptions(opts, batch)
    setInputValue('')
    setShowInput(false)
  }

  const handleFormConnect = () => {
    if (!formValues.host.trim()) {
      return message.error('请填写服务器地址或 IP')
    }
    const opts = buildQuickConnectOptions(formValues)
    if (!opts) {
      return message.error('连接信息格式不正确，请检查主机和端口')
    }
    connectWithOptions(opts, batch)
    setFormValues({
      ...formValues,
      host: '',
      password: ''
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
      placeholder: '粘贴连接字符串，或使用上方快速连接表单填写服务器信息',
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
  const wiki = 'https://github.com/electerm/electerm/wiki/quick-connect'

  function renderForm () {
    if (!showInput && !formOnly) {
      return null
    }
    return (
      <div className='quick-connect-form'>
        <div className='quick-connect-form-title'>
          <ThunderboltOutlined />
          <span>快速连接服务器</span>
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
            placeholder='服务器 IP 或域名，例如 10.0.1.23'
            onPressEnter={handleFormConnect}
          />
          <Input
            value={formValues.port}
            onChange={e => updateFormValue('port', e.target.value)}
            placeholder='端口'
            className='quick-connect-port'
            onPressEnter={handleFormConnect}
          />
        </Space.Compact>
        <Space.Compact className='width-100 mg1b'>
          <Input
            value={formValues.username}
            onChange={e => updateFormValue('username', e.target.value)}
            placeholder='用户名，选填'
            onPressEnter={handleFormConnect}
          />
          <Input.Password
            value={formValues.password}
            onChange={e => updateFormValue('password', e.target.value)}
            placeholder='密码，选填'
            onPressEnter={handleFormConnect}
          />
        </Space.Compact>
        <Button
          type='primary'
          icon={<ArrowRightOutlined />}
          onClick={handleFormConnect}
          block
        >
          连接
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
