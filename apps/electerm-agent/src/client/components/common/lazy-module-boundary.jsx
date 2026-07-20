import React from 'react'
import { Button } from 'antd'
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { tryAutoRecoverChunkLoad } from './chunk-load-recovery'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import './lazy-module-boundary.styl'

const e = window.translate

export default class LazyModuleBoundary extends React.Component {
  constructor (props) {
    super(props)
    this.state = { error: null, recovering: false }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  componentDidCatch (error) {
    if (tryAutoRecoverChunkLoad(error)) {
      this.setState({ recovering: true })
    }
  }

  handleReload = () => {
    globalThis.location?.reload?.()
  }

  render () {
    const { error, recovering } = this.state
    if (!error) return this.props.children
    if (recovering) return this.props.fallback || null
    const moduleName = this.props.moduleName || e('shellpilotFeatureModule')
    return (
      <div className='lazy-module-error' role='alert'>
        <WarningOutlined className='lazy-module-error-icon' />
        <div className='lazy-module-error-copy'>
          <strong>{formatShellPilotTranslation(e, 'shellpilotModuleLoadFailed', { module: moduleName })}</strong>
          <span>{e('shellpilotModuleLoadCacheHint')}</span>
        </div>
        <Button
          size='small'
          icon={<ReloadOutlined />}
          onClick={this.handleReload}
        >
          {e('shellpilotReloadModule')}
        </Button>
      </div>
    )
  }
}
