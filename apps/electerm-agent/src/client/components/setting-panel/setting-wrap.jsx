/**
 * settings page
 */

import { Component } from 'react'
import Drawer from '../common/drawer'
import { sidebarWidth } from '../../common/constants'
import AppDrag from '../tabs/app-drag'
import './setting-wrap.styl'

export default class SettingWrap extends Component {
  renderDrag () {
    return (
      <AppDrag />
    )
  }

  render () {
    const pops = {
      open: this.props.visible,
      onClose: this.props.onCancel,
      className: 'setting-wrap',
      size: this.props.innerWidth - sidebarWidth,
      zIndex: 888,
      placement: 'left'
    }
    return (
      <Drawer
        {...pops}
      >
        {
          this.props.useSystemTitleBar ? null : <AppDrag />
        }
        {this.props.children}
      </Drawer>
    )
  }
}
