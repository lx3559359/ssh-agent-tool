const widgetDisplayMap = {
  'batch-op': {
    title: '批量任务',
    description: '编排多台服务器的 SSH/SFTP 操作，适合巡检、部署和批量排障。',
    scene: '运维自动化',
    typeLabel: '流程',
    actionText: '打开编排器',
    accent: 'blue',
    keywords: ['batch', 'operation', '批量', '巡检', '部署', 'ssh', 'sftp']
  },
  'local-file-server': {
    title: '静态文件服务',
    description: '把本机目录临时发布为 HTTP 文件服务，便于服务器下载脚本、包或日志。',
    scene: '文件分发',
    typeLabel: '服务',
    actionText: '启动服务',
    accent: 'green',
    keywords: ['static', 'file', 'server', 'http', '文件', '下载', '分发']
  },
  'local-ftp-server': {
    title: '本地 FTP 服务',
    description: '在本机启动 FTP 服务，用于临时上传、下载和跨服务器文件中转。',
    scene: '文件传输',
    typeLabel: '服务',
    actionText: '启动服务',
    accent: 'cyan',
    keywords: ['ftp', '文件', '上传', '下载', '传输']
  },
  'mcp-server': {
    title: 'MCP 服务',
    description: '把 AIGShell 的连接、SFTP 和命令能力开放给支持 MCP 的 AI 工具。',
    scene: 'AI 集成',
    typeLabel: '服务',
    actionText: '启动 MCP',
    accent: 'purple',
    keywords: ['mcp', 'agent', 'ai', 'api', '工具调用']
  },
  rename: {
    title: '批量重命名',
    description: '按模板批量修改本机文件名，适合整理日志、截图和备份文件。',
    scene: '文件整理',
    typeLabel: '工具',
    actionText: '执行重命名',
    accent: 'orange',
    keywords: ['rename', 'file', '重命名', '文件整理']
  }
}

const configDisplayMap = {
  host: {
    label: '监听地址',
    description: '服务绑定的 IP 地址。本机使用 127.0.0.1，局域网共享可使用 0.0.0.0。'
  },
  port: {
    label: '端口',
    description: '服务监听端口，请确认没有被其他程序占用。'
  },
  directory: {
    label: '目录',
    description: '要共享或处理的本机目录路径。'
  },
  maxAge: {
    label: '浏览器缓存时长',
    description: '静态文件缓存时长，单位为毫秒。'
  },
  cacheControl: {
    label: '启用缓存控制',
    description: '是否返回 Cache-Control 响应头。'
  },
  lastModified: {
    label: '启用 Last-Modified',
    description: '是否返回 Last-Modified 响应头。'
  },
  etag: {
    label: '启用 ETag',
    description: '是否生成 ETag 响应头。'
  },
  index: {
    label: '首页文件',
    description: '目录默认访问的文件名，例如 index.html。'
  },
  redirect: {
    label: '目录自动跳转',
    description: '访问目录时是否自动补全跳转。'
  },
  dotfiles: {
    label: '隐藏文件策略',
    description: '控制点号开头的隐藏文件如何被访问。'
  },
  acceptRanges: {
    label: '支持断点请求',
    description: '是否允许客户端使用 Range 请求。'
  },
  autoRun: {
    label: '开机自动运行',
    description: 'AIGShell 启动后自动运行这个工具。'
  },
  anonymous: {
    label: '允许匿名访问',
    description: '是否允许 FTP 匿名登录。'
  },
  username: {
    label: '用户名',
    description: 'FTP 登录用户名。'
  },
  password: {
    label: '密码',
    description: 'FTP 登录密码。'
  },
  apiKey: {
    label: 'API 密钥',
    description: 'MCP 请求认证密钥。为空时跳过认证；建议正式使用时填写。'
  },
  enableBookmarks: {
    label: '启用服务器 API',
    description: '允许 MCP 读取、新增、编辑和删除服务器连接。'
  },
  bookmarkKeyword: {
    label: '服务器过滤关键词',
    description: '只返回标题包含该关键词的服务器连接；留空返回全部。'
  },
  enableBookmarkGroups: {
    label: '启用分组 API',
    description: '允许 MCP 读取服务器分组。'
  },
  enableSftp: {
    label: '启用 SFTP API',
    description: '允许 MCP 执行目录列表、读取、删除、上传和下载等 SFTP 操作。'
  },
  enableSettings: {
    label: '启用设置 API',
    description: '允许 MCP 读取或修改客户端设置。'
  },
  commandBlacklist: {
    label: '命令黑名单',
    description: '每行一个正则表达式，匹配到的命令会被拒绝。内置高危命令规则始终生效。'
  },
  commandWhitelist: {
    label: '命令白名单',
    description: '每行一个正则表达式；填写后只有匹配白名单的命令允许执行。'
  },
  template: {
    label: '命名模板',
    description: '新文件名模板，支持 {name}、{n}、{ext}、{date}、{time}、{random}。'
  },
  includeSubfolders: {
    label: '包含子目录',
    description: '是否处理子目录中的文件。'
  },
  fileTypes: {
    label: '文件类型',
    description: '逗号分隔的扩展名，例如 jpg,png,gif；填写 * 表示全部文件。'
  },
  startNumber: {
    label: '起始序号',
    description: '顺序编号的起始数字。'
  },
  preserveCase: {
    label: '保留大小写',
    description: '是否保留原文件名大小写。'
  }
}

export function getWidgetDisplay (widget) {
  const fallbackTitle = widget?.info?.name || widget?.id || '工具'
  return {
    title: fallbackTitle,
    description: widget?.info?.description || 'AIGShell 内置工具。',
    scene: '内置工具',
    typeLabel: widget?.info?.type === 'instance' ? '服务' : '工具',
    actionText: widget?.info?.type === 'instance' ? '启动服务' : '运行工具',
    accent: 'blue',
    keywords: [],
    ...widgetDisplayMap[widget?.id]
  }
}

export function getConfigDisplay (config) {
  return {
    label: config.name,
    description: config.description,
    ...configDisplayMap[config.name]
  }
}

export function formatInstanceTitle (item) {
  const meta = widgetDisplayMap[item.widgetId]
  if (!meta) {
    return item.title
  }
  const suffix = item.id ? ` (${item.id})` : ''
  return `${meta.title}${suffix}`
}
