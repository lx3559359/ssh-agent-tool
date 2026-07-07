import React from 'react'
import { FrownOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import {
  logoPath1,
  packInfo,
  isMac,
  isWin
} from '../../common/constants'
import Link from '../common/external-link'
import { copy } from '../../common/clipboard'
import compare from '../../common/version-compare'

const e = window.translate
const version = packInfo.version
const os = isMac ? 'mac' : isWin ? 'windows' : 'linux'
const isVersion2OrAbove = compare(version, '2.0.0') >= 0

// 历史兼容：底层仍沿用 Electerm 的数据目录，避免用户升级后丢失原有连接配置。
const userDataPath = {
  mac: '~/Library/Application\\ Support/electerm/users/default_user',
  linux: '~/.config/electerm/users/default_user',
  windows: 'C:\\Users\\your-user-name\\AppData\\Roaming\\electerm\\users\\default_user'
}

const troubleshootContent = {
  runInCommandLine: {
    title: '从命令行启动',
    mac: '/Applications/AIGShell.app/Contents/MacOS/AIGShell',
    linux: 'path/to/AIGShell',
    windows: 'path\\to\\AIGShell.exe'
  },
  clearConfig: {
    title: '清理本地配置',
    mac: isVersion2OrAbove
      ? `rm -rf ${userDataPath.mac}/electerm_data.db`
      : `rm -rf ${userDataPath.mac}/electerm.data.nedb`,
    linux: isVersion2OrAbove
      ? `rm -rf ${userDataPath.linux}/electerm_data.db`
      : `rm -rf ${userDataPath.linux}/electerm.data.nedb`,
    windows: isVersion2OrAbove
      ? `删除 ${userDataPath.windows}\\electerm_data.db`
      : `删除 ${userDataPath.windows}\\electerm.data.nedb`
  },
  backupData: {
    title: '备份本地数据',
    mac: `cp -r ${userDataPath.mac} ~/Desktop/aigshell_backup_${Date.now()}`,
    linux: `cp -r ${userDataPath.linux} ~/Desktop/aigshell_backup_${Date.now()}`,
    windows: `xcopy "${userDataPath.windows}\\*" "%USERPROFILE%\\Desktop\\aigshell_backup_${Date.now()}" /E /I`
  }
}

export default class ErrorBoundary extends React.PureComponent {
  constructor (props) {
    super(props)
    this.state = {
      hasError: false,
      error: {}
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
      error
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  renderIconCopy = (cmd) => {
    return (
      <CopyOutlined
        className='mg2l pointer'
        onClick={() => copy(cmd)}
      />
    )
  }

  renderTroubleShoot = () => {
    if (window.et.isWebApp) {
      return this.renderContacts()
    }
    return (
      <div className='pd1y wordbreak'>
        <h2>排查建议</h2>
        <p>AIGShell 版本：{packInfo.version}，系统：{os}</p>
        <p>说明：为兼容 Electerm 底座和历史数据，部分本地数据目录名称仍保留 electerm。</p>
        {
          Object.keys(troubleshootContent).map((k) => {
            const v = troubleshootContent[k]
            const cmd = v[os]
            return (
              <div className='pd1b' key={k}>
                <h3>{v.title} {this.renderIconCopy(cmd)}</h3>
                <p><code>{cmd}</code></p>
              </div>
            )
          })
        }
        {this.renderContacts()}
      </div>
    )
  }

  renderContacts () {
    const {
      bugs: {
        url: bugReportLink
      }
    } = packInfo
    const bugUrl = `${bugReportLink}/new/choose`
    return (
      <>
        <div className='pd1b'>
          <Link to={bugUrl}>提交问题反馈</Link>
        </div>
      </>
    )
  }

  render () {
    if (this.state.hasError) {
      const { stack, message } = this.state.error
      return (
        <div className='pd3 error-wrapper'>
          <div className='pd2y'>
            <img src={logoPath1} className='iblock mwm-100' width={100} />
          </div>
          <h1>
            <FrownOutlined className='mg1r iblock' />
            <span className='iblock mg1r'>界面发生错误</span>
            <Button
              onClick={this.handleReload}
              icon={<ReloadOutlined />}
            >
              {e('reload')}
            </Button>
          </h1>
          <div className='pd1y'>{message}</div>
          <div className='pd1y'>{stack}</div>
          {
            this.renderTroubleShoot()
          }
        </div>
      )
    }
    return this.props.children
  }
}
