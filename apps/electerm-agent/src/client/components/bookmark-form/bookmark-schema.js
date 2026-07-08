const bookmarkSchema = {
  ssh: {
    type: 'ssh',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 22) - SSH port',
    username: 'string (required) - SSH username',
    password: 'string - password for authentication',
    privateKey: 'string - private key content or path for key-based auth',
    passphrase: 'string - passphrase for private key/certificate',
    certificate: 'string - certificate content',
    authType: 'string - auth type (password|privateKey|profiles), when have profile, should be profiles',
    profile: 'string - profile id to reuse saved auth',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    startDirectoryRemote: 'string - remote starting directory',
    startDirectoryLocal: 'string - local starting directory',
    enableSsh: 'boolean - enable ssh, default is true',
    enableSftp: 'boolean - enable sftp, default is true',
    sshTunnels: 'array - ssh tunnel definitions (see sshTunnels items)',
    connectionHoppings: 'array - connection hopping definitions',
    useSshAgent: 'boolean - use SSH agent, default is true',
    sshAgent: 'string - ssh agent path',
    serverHostKey: 'array - server host key algorithms',
    cipher: 'array - cipher list',
    compress: 'array - compression algorithms (zlib@openssh.com, zlib, none)',
    runScripts: 'array - run scripts after connected ({delay,script})',
    quickCommands: 'array - quick commands ({name,command})',
    proxy: 'string - proxy address (socks5://...)',
    x11: 'boolean - enable x11 forwarding, default is false',
    term: 'string - terminal type, default is xterm-256color, required',
    displayRaw: 'boolean - display raw output, default is false',
    encode: 'string - charset, default is utf8',
    envLang: 'string - ENV LANG, default is en_US.UTF-8',
    setEnv: 'string - environment variables, format: `KEY1=VALUE1 KEY2=VALUE2`',
    color: 'string - tag color, like #000000',
    interactiveValues: 'strings separated by newline'
  },
  sshTunnelsItem: {
    sshTunnel: 'string - forwardRemoteToLocal|forwardLocalToRemote|dynamicForward',
    sshTunnelLocalHost: 'string',
    sshTunnelLocalPort: 'number',
    sshTunnelRemoteHost: 'string',
    sshTunnelRemotePort: 'number',
    name: 'string - optional tunnel name'
  },
  connectionHoppingsItem: {
    host: 'string',
    port: 'number',
    username: 'string',
    password: 'string',
    privateKey: 'string',
    passphrase: 'string - passphrase',
    certificate: 'string',
    authType: 'string',
    profile: 'string - profile id'
  },
  telnet: {
    type: 'telnet',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 23) - Telnet port',
    username: 'string - username',
    password: 'string - password',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    loginPrompt: 'string - login prompt regex',
    passwordPrompt: 'string - password prompt regex',
    runScripts: 'array - run scripts after connected ({delay,script})',
    startDirectoryRemote: 'string - remote starting directory',
    startDirectoryLocal: 'string - local starting directory',
    profile: 'string - profile id',
    proxy: 'string - proxy address (socks5://...)'
  },
  serial: {
    type: 'serial',
    path: 'string (required) - serial port path, e.g., /dev/ttyUSB0 or COM1',
    baudRate: 'number (default: 9600) - baud rate',
    dataBits: 'number (default: 8) - data bits',
    stopBits: 'number (default: 1) - stop bits',
    parity: 'string - "none", "even", "odd", "mark", "space"',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    rtscts: 'boolean - enable RTS/CTS flow control, default is false',
    xon: 'boolean - enable XON flow control, default is false',
    xoff: 'boolean - enable XOFF flow control, default is false',
    xany: 'boolean - enable XANY flow control, default is false',
    txLineEnding: 'string - TX line ending on Enter: "\\r" (CR, default), "\\n" (LF), "\\r\\n" (CR+LF)',
    rxLineEnding: 'string - RX line ending conversion: "none" (default), "lf_to_crlf" (for LF-only devices), "cr_to_crlf" (for CR-only devices)',
    runScripts: 'array - run scripts after connected ({delay,script})',
    description: 'string - bookmark description'
  },
  vnc: {
    type: 'vnc',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 5900) - VNC port',
    username: 'string - VNC username',
    password: 'string - VNC password',
    viewOnly: 'boolean - view only mode, default is false',
    clipViewport: 'boolean - clip viewport to window, default is false',
    scaleViewport: 'boolean - scale viewport to window, default is true',
    qualityLevel: 'number (0-9) - VNC quality level, lower is faster, default is 3',
    compressionLevel: 'number (0-9) - VNC compression level, lower is faster, default is 1',
    shared: 'boolean - shared session, default is true',
    proxy: 'string - proxy address (socks5://...)',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    profile: 'string - profile id'
  },
  rdp: {
    type: 'rdp',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 3389) - RDP port',
    username: 'string - username',
    password: 'string - password',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    profile: 'string - profile id',
    proxy: 'string - proxy address (socks5://...)',
    domain: 'string - login domain'
  },
  ftp: {
    type: 'ftp',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 21) - FTP port',
    user: 'string - username',
    secure: 'boolean - use secure FTP (FTPS), default is false',
    password: 'string - password',
    encode: 'string - charset for file names, default is utf-8',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    profile: 'string - profile id',
    description: 'string - bookmark description'
  },
  web: {
    type: 'web',
    url: 'string (required) - website URL',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    useragent: 'string - custom user agent'
  },
  local: {
    type: 'local',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    description: 'string - bookmark description',
    startDirectoryLocal: 'string - local starting directory',
    runScripts: 'array - run scripts after connected ({delay,script})',
    execWindows: 'string - Windows exec path (overrides global setting)',
    execMac: 'string - Mac exec path (overrides global setting)',
    execLinux: 'string - Linux exec path (overrides global setting)',
    execWindowsArgs: 'array - Windows exec arguments',
    execMacArgs: 'array - Mac exec arguments',
    execLinuxArgs: 'array - Linux exec arguments'
  },
  spice: {
    type: 'spice',
    host: 'string (required) - hostname or IP address',
    port: 'number (default: 5900) - Spice port',
    password: 'string - Spice password',
    title: 'string - bookmark title',
    labels: 'array - server labels/tags for search and grouping',
    viewOnly: 'boolean - view only mode, default is false',
    scaleViewport: 'boolean - scale viewport to window, default is true',
    description: 'string - bookmark description',
    profile: 'string - profile id',
    proxy: 'string - proxy address (socks5://...)'
  }
}

export function buildPrompt (description) {
  const lang = window.store.config.languageAI || window.store.getLangName() || '简体中文'
  const schemaDescription = Object.entries(bookmarkSchema)
    .map(([type, fields]) => {
      const fieldList = Object.entries(fields)
        .map(([key, desc]) => `    ${key}: ${desc}`)
        .join('\n')
      return `  ${type}:\n${fieldList}`
    })
    .join('\n\n')

  return `你是连接书签配置生成器。请根据用户的自然语言描述，生成 JSON 格式的书签配置。

可用书签类型和字段：
${schemaDescription}

重要规则：
1. 分析用户描述，判断最合适的连接类型。
2. SSH 连接使用 type "ssh"，未指定端口时默认 22。
3. Telnet 连接使用 type "telnet"，未指定端口时默认 23。
4. VNC 连接使用 type "vnc"，未指定端口时默认 5900。
5. RDP 连接使用 type "rdp"，未指定端口时默认 3389。
6. FTP 连接使用 type "ftp"，未指定端口时默认 21。
7. 串口连接使用 type "serial"。
8. Web/浏览器连接使用 type "web"，并提供 url 字段。
9. 本地终端使用 type "local"。
10. 只包含当前连接类型相关字段。
11. 未指定标题时，生成有意义的 title。
12. 只返回有效 JSON，不要返回 Markdown 或解释。
13. 使用${lang}处理文本字段。

用户描述：${description}

生成书签 JSON：`
}

export default bookmarkSchema
