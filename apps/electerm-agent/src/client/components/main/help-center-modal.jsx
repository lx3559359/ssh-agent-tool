import { Collapse } from 'antd'
import Modal from '../common/modal'
import './help-center-modal.styl'

const helpItems = [
  {
    key: 'connection',
    label: '服务器与 SSH 终端',
    children: <p>通过“新建”保存主机、端口、账号和认证方式。连接后可像常规 SSH 客户端一样直接输入命令，并使用 Ctrl+C、复制、粘贴、搜索、分屏和会话历史。</p>
  },
  {
    key: 'sftp',
    label: 'SFTP 文件管理',
    children: <p>连接服务器后打开 SFTP，可上传、下载、预览、重命名和管理远程文件。文件可以拖入 AI 助手分析；重要文件修改或删除前建议先执行一键备份。</p>
  },
  {
    key: 'safety',
    label: '安全备份与恢复',
    children: <p>“一键备份”会把选中的远程文件或文件夹复制到服务器的 .shellpilot-backups 目录。“安全操作中心”可查看备份、恢复最近版本和处理可恢复删除记录。</p>
  },
  {
    key: 'ai',
    label: 'AI 助手与模型 API',
    children: <p>在“模型 API”中至少填写 API 地址和密钥，可拉取并保存多个模型。AI 助手能够引用终端输出、选中文本、SFTP 文件和本地附件；执行命令前仍需用户确认。</p>
  },
  {
    key: 'commands',
    label: '快捷命令',
    children: <p>顶部“快捷命令”提供服务器、网络、日志、进程、防火墙和抓包等常用操作。带参数的命令先填写表单并预览，高风险修改会生成备份或回滚脚本。</p>
  },
  {
    key: 'extensions',
    label: 'MCP 与 CLI',
    children: <p>MCP 用于接入监控、CMDB、知识库等外部能力；CLI 用于调用本机允许列表中的工具。请只启用可信服务，并在执行前检查参数和数据范围。</p>
  },
  {
    key: 'update',
    label: '在线更新',
    children: <p>在“检查更新”或“设置”中选择自动、ModelScope 国内源或 GitHub。自动模式优先国内源并在失败时回退；只有已审批发布的版本才会进入客户端下载流程。</p>
  },
  {
    key: 'logs',
    label: '工具日志与问题排查',
    children: <p>左侧“日志”可查看客户端运行记录。遇到启动、连接、AI 或更新问题时，请记录操作时间、错误提示和工具日志；必要时导出诊断包用于定位。</p>
  }
]

export default function HelpCenterModal ({ open, onClose }) {
  if (!open) return null
  return (
    <Modal
      title='ShellPilot 帮助中心'
      open
      onCancel={onClose}
      footer={null}
      width='min(820px, calc(100vw - 32px))'
      wrapClassName='shellpilot-help-center'
    >
      <p className='shellpilot-help-intro'>面向日常服务器连接、维护、排障和 AI 辅助分析的快速使用说明。</p>
      <Collapse items={helpItems} defaultActiveKey={['connection']} />
      <p className='shellpilot-help-safety'>安全提示：修改网络、防火墙、SSH、权限和系统服务前，请确认有可用的控制台或回滚方案。</p>
    </Modal>
  )
}
