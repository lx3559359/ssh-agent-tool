/**
 * Widget form component
 */
import React, { useState, useEffect } from 'react'
import { Form, Input, InputNumber, Switch, Select, Button, Tooltip, Alert, Space } from 'antd'
import { formItemLayout, tailFormItemLayout } from '../../common/form-layout'
import HelpIcon from '../common/help-icon'
import { nanoid } from 'nanoid'
import BatchOpEditor from '../batch-op/batch-op-editor'
import { getConfigDisplay, getWidgetDisplay } from './widget-i18n'

export default function WidgetForm ({ widget, onSubmit, loading, hasRunningInstance }) {
  const [form] = Form.useForm()
  const [showDownloadWarning, setShowDownloadWarning] = useState(false)

  useEffect(() => {
    let timer
    if (loading) {
      timer = setTimeout(() => {
        setShowDownloadWarning(true)
      }, 3000)
    } else {
      setShowDownloadWarning(false)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [loading])

  if (!widget) {
    return null
  }

  const { info } = widget
  const { configs, type, singleInstance } = info
  const isInstanceWidget = type === 'instance'
  const isFrontendWidget = type === 'frontend'
  const meta = getWidgetDisplay(widget)
  const txt = meta.actionText || (isInstanceWidget ? '启动服务' : '运行工具')
  const isDisabled = loading || (singleInstance && hasRunningInstance)

  const handleSubmit = async (values) => {
    onSubmit(values)
  }

  const renderFormItem = (config) => {
    const { name, type, choices, showGenerator } = config
    const display = getConfigDisplay(config)
    const { label, description } = display
    let control = null

    switch (type) {
      case 'string':
        control = <Input placeholder={description} />
        if (showGenerator) {
          return (
            <Form.Item
              key={name}
              {...formItemLayout}
              label={label}
              tooltip={description}
            >
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  noStyle
                  name={name}
                >
                  <Input placeholder={description} />
                </Form.Item>
                <Button
                  onClick={() => form.setFieldValue(name, 'ett_' + nanoid())}
                >
                  生成
                </Button>
              </Space.Compact>
            </Form.Item>
          )
        }
        break
      case 'textarea':
        control = <Input.TextArea autoSize={{ minRows: 3 }} placeholder={description} />
        break
      case 'number':
        control = <InputNumber style={{ width: '100%' }} placeholder={description} />
        break
      case 'boolean':
        return (
          <Form.Item
            key={name}
            {...formItemLayout}
            label={label}
            name={name}
            valuePropName='checked'
            tooltip={description}
          >
            <Switch />
          </Form.Item>
        )
      default:
        control = <Input placeholder={description} />
    }

    if (choices && choices.length > 0) {
      control = (
        <Select placeholder={description}>
          {choices.map(choice => (
            <Select.Option key={choice} value={choice}>
              {choice}
            </Select.Option>
          ))}
        </Select>
      )
    }

    return (
      <Form.Item
        key={name}
        {...formItemLayout}
        label={label}
        name={name}
        tooltip={description}
      >
        {control}
      </Form.Item>
    )
  }

  function renderWarn () {
    if (!showDownloadWarning) {
      return null
    }
    return (
      <Alert
        title='首次使用可能需要准备依赖，请稍等。'
        type='warning'
        showIcon
        className='mg1t'
      />
    )
  }

  const initialValues = configs.reduce((acc, config) => {
    acc[config.name] = config.default
    return acc
  }, {})

  if (isFrontendWidget && info.name === 'Batch Operation') {
    return <BatchOpEditor widget={widget} />
  }

  return (
    <div className='widget-form'>
      <div className='widget-form-hero'>
        <div>
          <div className='widget-form-kicker'>{meta.scene} / {meta.typeLabel}</div>
          <h3>
            {meta.title}
          </h3>
          <p>{meta.description}</p>
        </div>
        <div className='widget-form-actions'>
          {info.name === 'MCP Server' && (
            <HelpIcon link='https://github.com/electerm/electerm/wiki/MCP-Widget-Usage-Guide' />
          )}
        </div>
      </div>

      <Form
        form={form}
        onFinish={handleSubmit}
        initialValues={initialValues}
        layout='horizontal'
        className='widget-config-form'
      >
        {configs.map(renderFormItem)}
        <Form.Item
          {...tailFormItemLayout}
        >
          <Tooltip title={isDisabled && singleInstance && hasRunningInstance ? '该服务已经运行，当前只允许启动一个实例' : ''}>
            <Button
              type='primary'
              htmlType='submit'
              loading={loading}
              disabled={isDisabled}
            >
              {txt}
            </Button>
          </Tooltip>
          {renderWarn()}
        </Form.Item>
      </Form>
    </div>
  )
}
