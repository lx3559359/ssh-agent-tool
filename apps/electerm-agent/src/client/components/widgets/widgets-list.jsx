/**
 * widgets list
 */
import React, { useState, useEffect } from 'react'
import {
  Empty,
  Input,
  Tabs,
  Tag
} from 'antd'
import {
  AppstoreOutlined,
  SearchOutlined
} from '@ant-design/icons'
import WidgetInstances from './widget-instances'
import classnames from 'classnames'
import highlight from '../common/highlight'
import { getWidgetDisplay } from './widget-i18n'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides'
import './widgets.styl'
import {
  auto
} from 'manate/react'

export default auto(function WidgetsList ({ activeItemId, store, languageVersion }) {
  const { widgetInstances } = store
  const e = window.translate
  const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)
  const [tab, setTab] = useState('widgets') // or instances
  const [widgets, setWidgets] = useState([])
  const [keyword, setKeyword] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
    }, 200)
    loadWidgets()
    return () => {
      clearTimeout(timer)
    }
  }, [])

  const loadWidgets = async () => {
    try {
      const widgets = await window.store.listWidgets()
      setWidgets(widgets)
    } catch (error) {
      console.error('Failed to load tools:', error)
    }
  }

  const handleSearch = (e) => {
    setKeyword(e.target.value)
  }

  const handleTabChange = (key) => {
    setTab(key)
  }

  const onClickWidget = (widget) => {
    window.store.setSettingItem(widget)
  }

  const renderWidgetItem = (widget, i) => {
    const meta = getWidgetDisplay(widget, e)
    const title = meta.title
    const running = widgetInstances.some(item => item.widgetId === widget.id)
    const cls = classnames(
      'widget-card',
      `widget-card-${meta.accent}`,
      {
        active: activeItemId === widget.id
      }
    )
    const titleHighlight = highlight(
      title,
      keyword
    )
    return (
      <div
        key={widget.id}
        data-widget-id={widget.id}
        data-widget-type={widget.info.type}
        className={cls}
        onClick={() => onClickWidget(widget)}
      >
        <div className='widget-card-icon'>
          <AppstoreOutlined />
        </div>
        <div className='widget-card-main'>
          <div className='widget-card-head'>
            <div title={title} className='elli widget-card-title'>
              {titleHighlight || title}
            </div>
            {
              running && (
                <Tag color='success' className='widget-card-tag'>{e('shellpilotWidgetRunning')}</Tag>
              )
            }
          </div>
          <div className='widget-card-desc'>
            {meta.description}
          </div>
          <div className='widget-card-meta'>
            <span>{meta.scene}</span>
            <span>{meta.typeLabel}</span>
          </div>
        </div>
      </div>
    )
  }

  const renderWidgetsList = () => {
    const filteredWidgets = keyword
      ? widgets.filter(widget => {
        const meta = getWidgetDisplay(widget, e)
        const text = [
          widget.info.name,
          meta.title,
          meta.description,
          meta.scene,
          ...(meta.keywords || [])
        ].join(' ').toLowerCase()
        return text.includes(keyword.toLowerCase())
      })
      : widgets

    return (
      <div className='widgets-tool-list item-list item-type-widgets'>
        <div className='widgets-search-wrap'>
          <Input.Search
            type='text'
            placeholder={e('shellpilotWidgetSearchPlaceholder')}
            value={keyword}
            onChange={handleSearch}
            className='form-control'
            prefix={<SearchOutlined />}
          />
        </div>
        <div className='widgets-list-summary'>
          <span>{tf('shellpilotWidgetBuiltinCount', { count: filteredWidgets.length })}</span>
          <span>{tf('shellpilotWidgetRunningCount', { count: widgetInstances.length })}</span>
        </div>
        <div className='widgets-card-list item-list-wrap pd1y'>
          {
            filteredWidgets.length
              ? filteredWidgets.map(renderWidgetItem)
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={e('shellpilotWidgetNoMatches')} />
          }
        </div>
      </div>
    )
  }

  const renderTabs = () => {
    const instancesTag = tf('shellpilotWidgetRunningTab', { count: widgetInstances.length })
    const items = [
      {
        key: 'widgets',
        label: e('shellpilotWidgetToolsTab'),
        children: null
      },
      {
        key: 'instances',
        label: instancesTag,
        children: null
      }
    ]
    return (
      <Tabs
        activeKey={tab}
        onChange={handleTabChange}
        items={items}
      />
    )
  }

  const renderInstancesSection = () => {
    return (
      <WidgetInstances
        widgetInstances={widgetInstances}
        languageVersion={languageVersion}
      />
    )
  }

  if (!ready) {
    return null
  }

  return (
    <div className='widgets-shell' data-language-version={languageVersion}>
      <div className='widgets-panel-title'>
        <div>
          <h3>{e('shellpilotWidgetToolCenter')}</h3>
          <p>{e('shellpilotWidgetToolCenterDescription')}</p>
        </div>
      </div>
      {renderTabs()}
      <div className='pd2x pd1y'>
        {
          tab === 'widgets'
            ? renderWidgetsList()
            : renderInstancesSection()
        }
      </div>
    </div>
  )
})
