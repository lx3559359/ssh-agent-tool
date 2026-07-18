import React from 'react'
import { Button } from 'antd'
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { tryAutoRecoverChunkLoad } from './chunk-load-recovery'
import './lazy-module-boundary.styl'

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
    const moduleName = this.props.moduleName || '功能模块'
    return (
      <div className='lazy-module-error' role='alert'>
        <WarningOutlined className='lazy-module-error-icon' />
        <div className='lazy-module-error-copy'>
          <strong>{moduleName}加载失败</strong>
          <span>可能是更新后的旧缓存所致，SSH 会话不会因此中断。</span>
        </div>
        <Button
          size='small'
          icon={<ReloadOutlined />}
          onClick={this.handleReload}
        >
          重新加载模块
        </Button>
      </div>
    )
  }
}
