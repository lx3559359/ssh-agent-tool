/**
 * Widget control component - shows form for a selected widget
 */
import React, { useState } from 'react'
import WidgetForm from './widget-form'
import { showMsg } from './widget-notification-with-details'
import { formatWidgetSuccessMessage } from './widget-feedback.js'

export default function WidgetControl ({ formData, widgetInstancesLength, languageVersion }) {
  const [loading, setLoading] = useState(false)
  const widget = formData
  const e = window.translate
  if (!widget.id) {
    return (
      <div className='widget-control-empty'>
        <div className='widget-control-empty-inner'>
          <h3>{e('shellpilotWidgetSelectTitle')}</h3>
          <p>{e('shellpilotWidgetSelectDescription')}</p>
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
        error
      } = result
      if (!instanceId) {
        if (success === false) {
          showMsg(e('shellpilotWidgetRunFailed'), 'error', null, 10, error || '')
        } else {
          showMsg(formatWidgetSuccessMessage(result, e), 'success', null, 10)
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
      showMsg(formatWidgetSuccessMessage(result, e), 'success', result.serverInfo, 10)
    } catch (err) {
      console.error('Widget failed to run:', err)
      showMsg(e('shellpilotWidgetRunFailed'), 'error', null, 10, err.message)
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
        languageVersion={languageVersion}
      />
    </div>
  )
}
