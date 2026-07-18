import React from 'react'
import {
  CopyOutlined,
  FrownOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Button, Space } from 'antd'
import {
  isMac,
  isWin,
  logoPath1,
  packInfo
} from '../../common/constants'
import Link from '../common/external-link'
import { copy } from '../../common/clipboard'
import { createSafeErrorDiagnostic } from '../../common/error-diagnostics'
import message from '../common/message'

const e = window.translate
const os = isMac ? 'mac' : isWin ? 'windows' : 'linux'

export default class ErrorBoundary extends React.PureComponent {
  constructor (props) {
    super(props)
    this.state = {
      hasError: false,
      diagnostic: null
    }
  }

  componentDidCatch (error, errorInfo) {
    console.error(error)
    window.pre?.runGlobalAsync?.('reportRendererError', {
      message: error?.message || String(error),
      stack: error?.stack || '',
      componentStack: errorInfo?.componentStack || '',
      location: window.location?.href || '',
      userAgent: window.navigator?.userAgent || ''
    }).catch(() => {})
    this.setState({
      hasError: true,
      diagnostic: createSafeErrorDiagnostic(error, {
        version: packInfo.version,
        os
      })
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleCopyDiagnostic = () => {
    const diagnostic = this.state.diagnostic
    if (!diagnostic) return
    copy(diagnostic.text)
    message.success(e('shellpilotDiagnosticCopied'))
  }

  renderFeedbackLink () {
    const bugReportLink = packInfo?.bugs?.url
    if (!bugReportLink) return null
    return (
      <Link to={`${bugReportLink}/new/choose`}>
        {e('shellpilotSubmitFeedback')}
      </Link>
    )
  }

  render () {
    if (!this.state.hasError) {
      return this.props.children
    }

    const diagnostic = this.state.diagnostic || createSafeErrorDiagnostic(null, {
      version: packInfo.version,
      os
    })

    return (
      <div className='pd3 error-wrapper'>
        <div className='pd2y'>
          <img src={logoPath1} className='iblock mwm-100' width={88} alt='ShellPilot' />
        </div>
        <h1>
          <FrownOutlined className='mg1r iblock' />
          <span className='iblock mg1r'>{e('shellpilotInterfaceError')}</span>
        </h1>
        <p>{e('shellpilotSafeErrorHint')}</p>
        <div className='sp-safe-error-diagnostic pd2'>
          <p><b>{e('shellpilotErrorNumber')}:</b> <code>{diagnostic.id}</code></p>
          <p className='wordbreak'>{diagnostic.safeMessage}</p>
        </div>
        <Space className='pd2y' wrap>
          <Button
            type='primary'
            onClick={this.handleReload}
            icon={<ReloadOutlined />}
          >
            {e('reload')}
          </Button>
          <Button
            onClick={this.handleCopyDiagnostic}
            icon={<CopyOutlined />}
          >
            {e('shellpilotCopyDiagnostic')}
          </Button>
          {this.renderFeedbackLink()}
        </Space>
      </div>
    )
  }
}
