import {
  Popconfirm,
  Popover,
  Tooltip,
  Tag
} from 'antd'
import { CloseOutlined, CopyOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import classnames from 'classnames'
import { auto } from 'manate/react'
import { formatInstanceTitle } from './widget-i18n'

const e = window.translate

export default auto(function WidgetInstance ({ item, languageVersion }) {
  const { id, title, serverInfo, autoRun } = item
  const displayTitle = formatInstanceTitle(item, e)
  const cls = classnames('item-list-unit', {
    'autorun-active': autoRun
  })
  const delProps = {
    title: e('del'),
    className: 'pointer list-item-remove'
  }
  const icon = (
    <CloseOutlined
      {...delProps}
    />
  )
  function onConfirm () {
    window.store.stopWidget(id)
  }
  const popProps = {
    title: e('del') + '?',
    onConfirm,
    okText: e('del'),
    cancelText: e('cancel'),
    placement: 'top'
  }
  const handleCopy = () => {
    if (serverInfo && serverInfo.url) {
      copy(serverInfo.url)
    }
  }
  const handleToggleAutoRun = () => {
    window.store.toggleAutoRunWidget(item)
  }
  const popoverContent = serverInfo
    ? (
      <div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span>{e('shellpilotWidgetAddress')} {serverInfo.url}</span>
          <CopyOutlined
            className='pointer mg1l'
            onClick={handleCopy}
          />
        </div>
        <div>{e('shellpilotWidgetDirectory')} {serverInfo.path}</div>
      </div>
      )
    : null
  const tag = autoRun ? <Tag color='green'>{e('shellpilotWidgetAutoRun')}</Tag> : null
  const titleDiv = (
    <div
      title={displayTitle || title}
      className='elli pd1y pd2x list-item-title'
    >
      {tag} {displayTitle || title}
    </div>
  )
  return (
    <div
      key={id}
      className={cls}
      data-language-version={languageVersion}
    >
      {
        serverInfo
          ? (
            <Popover
              content={popoverContent}
              trigger='hover'
              placement='top'
            >
              {titleDiv}
            </Popover>
            )
          : titleDiv
      }
      <Tooltip title={e('shellpilotWidgetToggleAutoRun')}>
        <ThunderboltOutlined
          className='pointer list-item-autorun'
          onClick={handleToggleAutoRun}
        />
      </Tooltip>
      <Popconfirm
        {...popProps}
      >
        {icon}
      </Popconfirm>
    </div>
  )
})
