/**
 * Widget control component - shows form for a selected widget
 */
import React, { useState } from 'react'
import WidgetForm from './widget-form'
import { showMsg } from './widget-notification-with-details'

export default function WidgetControl ({ formData, widgetInstancesLength }) {
  const [loading, setLoading] = useState(false)
  const widget = formData
  if (!widget.id) {
    return (
      <div className='widget-control-empty'>
        <div className='widget-control-empty-inner'>
          <h3>选择一个工具开始配置</h3>
          <p>左侧工具中心提供批量任务、文件服务、MCP 服务和文件整理能力。选择后可在这里查看说明并调整参数。</p>
        </div>
      </div>
    )
  }

  // Check if this widget already has a running instance
  // widgetInstancesLength is used to trigger re-render when instances change
  const hasRunningInstance = widgetInstancesLength > 0 && window.store.widgetInstances.some(
    instance => instance.widgetId === widget.id
  )

  const handleFormSubmit = async (config) => {
    setLoading(true)
    try {
      const result = await window.store.runWidget(widget.id, config)
      const {
        instanceId,
        success,
        error,
        msg
      } = result
      if (!instanceId) {
        if (success === false) {
          showMsg('工具运行失败', 'error', null, 10, error || '')
        } else {
          showMsg(msg, 'success', null, 10)
        }
        return
      }
      // Add instance to the store
      const instance = {
        id: result.instanceId,
        title: `${widget.info.name} (${result.instanceId})`,
        widgetId: result.widgetId,
        serverInfo: result.serverInfo,
        config
      }
      window.store.widgetInstances.push(instance)
      if (config.autoRun) {
        window.store.toggleAutoRunWidget(instance)
      }
      showMsg(msg, 'success', result.serverInfo, 10)
    } catch (err) {
      console.error('工具运行失败:', err)
      showMsg(`工具运行失败：${err.message}`, 'error', null, 10)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='widget-control'>
      <WidgetForm
        widget={widget}
        onSubmit={handleFormSubmit}
        loading={loading}
        hasRunningInstance={hasRunningInstance}
      />
    </div>
  )
}
