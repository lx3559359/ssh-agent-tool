/**
 * quick commands footer selection
 */

import {
  PureComponent
} from 'react'
import {
  Button
} from 'antd'
import classNames from 'classnames'

const e = window.translate

export default class QuickCommandsItem extends PureComponent {
  handleSelect = (id) => {
    this.props.onSelect(
      this.props.item.id
    )
  }

  render () {
    const {
      name,
      id,
      shortcut,
      description,
      usage,
      labels = [],
      editBeforeRun,
      confirmRequired
    } = this.props.item
    const {
      draggable,
      handleDragOver,
      handleDragStart,
      handleDragEnter,
      handleDragLeave,
      handleDrop
    } = this.props
    const cls = classNames('qm-item mg1r mg1b')
    const btnProps = {
      className: cls,
      onClick: this.handleSelect,
      'data-id': id,
      title: shortcut,
      draggable,
      onDragOver: handleDragOver,
      onDragStart: handleDragStart,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
    const visibleLabels = labels
      .filter(label => !['内置', '服务器维护'].includes(label))
      .slice(0, 2)
    return (
      <Button
        key={id}
        {...btnProps}
      >
        <span className='qm-item-content'>
          <span className='qm-item-head'>
            <span className='qm-item-title'>{name}</span>
            {
              editBeforeRun
                ? <span className='qm-item-pill qm-item-pill-warn'>{e('shellpilotQuickEditFirst')}</span>
                : null
            }
            {
              confirmRequired && !editBeforeRun
                ? <span className='qm-item-pill qm-item-pill-warn'>{e('shellpilotQuickConfirmationRequired')}</span>
                : null
            }
          </span>
          {
            description
              ? <span className='qm-item-desc'>{description}</span>
              : null
          }
          {
            usage
              ? <span className='qm-item-usage'>{usage}</span>
              : null
          }
          <span className='qm-item-meta'>
            {
              visibleLabels.map(label => (
                <span className='qm-item-pill' key={label}>{label}</span>
              ))
            }
          </span>
        </span>
      </Button>
    )
  }
}
