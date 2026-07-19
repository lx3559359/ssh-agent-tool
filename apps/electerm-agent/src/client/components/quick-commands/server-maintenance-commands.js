const COMMON_DELAY = 100
const BUILTIN = '内置'
const MAINTENANCE = '服务器维护'
const READ_ONLY = '只读'
const NEED_EDIT = '需编辑'

function step (command, delay = COMMON_DELAY) {
  return {
    command,
    delay
  }
}

function command (item) {
  const params = [...(item.params || [])]
  if (item.mutatesServer) {
    if (!params.some(param => param.name === '回滚脚本')) {
      params.push({
        name: '回滚脚本',
        label: '回滚脚本',
        type: 'hidden',
        defaultValue: '{{回滚脚本}}',
        help: '由 ShellPilot 自动生成并保存在服务器 /tmp/shellpilot-rollback 目录。'
      })
    }
    if (!params.some(param => param.name === '确认执行')) {
      params.push({
        name: '确认执行',
        label: '确认执行',
        type: 'select',
        defaultValue: 'no',
        help: '默认不修改服务器；只有选择“是”才会执行变更并创建回滚点。',
        options: [
          { label: '否，只预览', value: 'no' },
          { label: '是，执行修改', value: 'yes' }
        ]
      })
    }
  }
  return {
    inputOnly: false,
    advancedUsage: item.advancedUsage || [],
    ...item,
    params,
    labels: [BUILTIN, MAINTENANCE, ...(item.labels || [])]
  }
}

function inputParam (name, label, defaultValue, help, placeholder = '') {
  return { name, label, type: 'input', defaultValue, help, placeholder }
}

function numberParam (name, label, defaultValue, help, min = 1, max = 10000) {
  return { name, label, type: 'number', defaultValue, help, min, max }
}

function selectParam (name, label, defaultValue, help, options) {
  return { name, label, type: 'select', defaultValue, help, options }
}

const NETWORK_CHANGE_COMMAND = [
  'IFACE="{{网卡}}"',
  'NEW_CIDR="{{新IP/CIDR}}"',
  'GATEWAY="{{网关}}"',
  'DNS_SERVERS="{{DNS}}"',
  'CONFIG_MODE="{{配置方式}}"',
  'APPLY_CHANGE="{{确认执行}}"',
  'ROLLBACK_PROTECT="{{回滚保护}}"',
  'ROLLBACK_SECONDS="{{自动回滚秒数}}"',
  'ROLLBACK_DIR="/tmp/shellpilot-rollback"',
  'ROLLBACK_SCRIPT="{{回滚脚本}}"',
  'RUN_AS=""',
  'if [ "$(id -u)" != "0" ]; then if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "当前不是 root 且没有 sudo，无法修改网络配置"; exit 1; fi; fi',
  'if [ -z "$IFACE" ] || [ -z "$NEW_CIDR" ]; then echo "请填写网卡和新 IP/CIDR"; exit 1; fi',
  'case "$IFACE" in *[!a-zA-Z0-9_.:-]*) echo "网卡名称包含非法字符"; exit 1;; esac',
  'case "$NEW_CIDR" in *[!0-9a-fA-F:./]*) echo "新 IP/CIDR 格式不正确"; exit 1;; esac',
  'case "$ROLLBACK_SECONDS" in *[!0-9]*|"") echo "自动回滚秒数必须是整数"; exit 1;; esac',
  'echo "当前网卡地址:"; ip -brief address show "$IFACE" 2>/dev/null || true',
  'echo "当前默认路由:"; ip route show default 2>/dev/null || true',
  'echo "将修改: 网卡=$IFACE 新地址=$NEW_CIDR 网关=$GATEWAY DNS=$DNS_SERVERS 方式=$CONFIG_MODE"',
  'echo "回滚脚本: $ROLLBACK_SCRIPT"',
  'echo "回滚参考: sudo sh $ROLLBACK_SCRIPT"',
  'if [ "$APPLY_CHANGE" != "yes" ] || [ "$CONFIG_MODE" = "preview" ]; then echo "当前为预演模式，未执行任何修改。"; exit 0; fi',
  'if [ "$CONFIG_MODE" != "temporary" ] && [ "$CONFIG_MODE" != "nmcli" ]; then echo "未知配置方式: $CONFIG_MODE"; exit 1; fi',
  'OLD_ADDRS="$(ip -4 -o addr show dev "$IFACE" scope global 2>/dev/null | awk \'{print $4}\')"',
  'OLD_ROUTE="$(ip route show default 2>/dev/null | head -n 1)"',
  'CON_NAME=""; OLD_NM_METHOD=""; OLD_NM_ADDRS=""; OLD_NM_GATEWAY=""; OLD_NM_DNS=""',
  'if [ "$CONFIG_MODE" = "nmcli" ]; then',
  '  if ! command -v nmcli >/dev/null 2>&1; then echo "未安装 nmcli，请改用临时生效"; exit 1; fi',
  '  CON_NAME="$(nmcli -t -f NAME,DEVICE con show --active | awk -F: -v dev="$IFACE" \'$2==dev {print $1; exit}\')"',
  '  if [ -z "$CON_NAME" ]; then echo "未找到网卡 $IFACE 对应的 NetworkManager 连接"; exit 1; fi',
  '  OLD_NM_METHOD="$(nmcli -g ipv4.method con show "$CON_NAME")"',
  '  OLD_NM_ADDRS="$(nmcli -g ipv4.addresses con show "$CON_NAME")"',
  '  OLD_NM_GATEWAY="$(nmcli -g ipv4.gateway con show "$CON_NAME")"',
  '  OLD_NM_DNS="$(nmcli -g ipv4.dns con show "$CON_NAME")"',
  'fi',
  '$RUN_AS mkdir -p "$ROLLBACK_DIR"',
  'TMP_ROLLBACK="/tmp/shellpilot-rollback-$$.sh"',
  '{',
  '  printf \'%s\\n\' \'#!/bin/sh\' \'set -u\'',
  '  printf \'IFACE="%s"\\n\' "$IFACE"',
  '  printf \'RUN_AS="%s"\\n\' "$RUN_AS"',
  '  printf \'$RUN_AS ip -4 addr flush dev "$IFACE" scope global 2>/dev/null || true\\n\'',
  '  for OLD_CIDR in $OLD_ADDRS; do printf \'$RUN_AS ip addr add "%s" dev "$IFACE" || true\\n\' "$OLD_CIDR"; done',
  '  printf \'$RUN_AS ip route del default 2>/dev/null || true\\n\'',
  '  if [ -n "$OLD_ROUTE" ]; then printf \'$RUN_AS ip route add %s || true\\n\' "$OLD_ROUTE"; fi',
  '  if [ -n "$CON_NAME" ]; then printf \'$RUN_AS nmcli con mod "%s" ipv4.method "%s" ipv4.addresses "%s" ipv4.gateway "%s" ipv4.dns "%s" || true\\n$RUN_AS nmcli con up "%s" || true\\n\' "$CON_NAME" "$OLD_NM_METHOD" "$OLD_NM_ADDRS" "$OLD_NM_GATEWAY" "$OLD_NM_DNS" "$CON_NAME"; fi',
  '  printf \'rm -f "$0.armed"\\n\'',
  '} > "$TMP_ROLLBACK"',
  '$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"',
  'if [ "$ROLLBACK_PROTECT" = "enabled" ]; then',
  '  $RUN_AS touch "$ROLLBACK_SCRIPT.armed"',
  '  $RUN_AS sh -c "(sleep $ROLLBACK_SECONDS; if [ -f \'$ROLLBACK_SCRIPT.armed\' ]; then sh \'$ROLLBACK_SCRIPT\' > \'$ROLLBACK_SCRIPT.log\' 2>&1; fi) >/dev/null 2>&1 &"',
  '  echo "回滚保护已启动：$ROLLBACK_SECONDS 秒内未确认保留，将自动执行 $ROLLBACK_SCRIPT"',
  'else echo "警告：自动回滚保护已关闭"; fi',
  'if [ "$CONFIG_MODE" = "temporary" ]; then',
  '  $RUN_AS ip addr add "$NEW_CIDR" dev "$IFACE"',
  '  if [ -n "$GATEWAY" ]; then $RUN_AS ip route replace default via "$GATEWAY" dev "$IFACE"; fi',
  'else',
  '  DNS_NM="$(printf \'%s\' "$DNS_SERVERS" | tr \',\' \' \')"',
  '  $RUN_AS nmcli con mod "$CON_NAME" ipv4.addresses "$NEW_CIDR" ipv4.method manual',
  '  if [ -n "$GATEWAY" ]; then $RUN_AS nmcli con mod "$CON_NAME" ipv4.gateway "$GATEWAY"; fi',
  '  if [ -n "$DNS_NM" ]; then $RUN_AS nmcli con mod "$CON_NAME" ipv4.dns "$DNS_NM"; fi',
  '  $RUN_AS nmcli con up "$CON_NAME"',
  'fi',
  'echo "网络修改命令已完成。确认网络正常后，请在 ShellPilot 点击‘保留新配置’；需要撤销时点击‘立即回滚’。"'
].join('\n')

export function getServerMaintenanceQuickCommands () {
  return [
    command({
      id: 'builtin-server-overview',
      name: '系统概览',
      description: '查看运行时间、系统版本和当前登录用户。',
      usage: '用于快速判断服务器是否重启、系统类型和当前登录会话。',
      labels: [READ_ONLY, '系统'],
      advancedUsage: [
        '进一步看内核：uname -a',
        '进一步看登录来源：last -n 20'
      ],
      commands: [
        step('uptime'),
        step('hostnamectl 2>/dev/null || uname -a'),
        step('who -u')
      ]
    }),
    command({
      id: 'builtin-server-disk',
      name: '磁盘空间',
      description: '查看磁盘分区、文件系统类型和根目录占用排行。',
      usage: '适合排查磁盘满、日志占用过高、挂载异常等问题。',
      labels: [READ_ONLY, '磁盘'],
      advancedUsage: [
        '查看指定目录：du -xh --max-depth=1 /var/log | sort -h',
        '查大文件：find / -xdev -type f -size +500M -print 2>/dev/null | head -n 50'
      ],
      commands: [
        step('df -hT'),
        step('du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -n 20')
      ]
    }),
    command({
      id: 'builtin-server-memory',
      name: '内存与 Swap',
      description: '查看内存、Swap 和占用内存最高的进程。',
      usage: '适合排查内存不足、Swap 过高、进程异常占用。',
      labels: [READ_ONLY, '内存'],
      advancedUsage: [
        '实时观察：vmstat 1 10',
        '按内存查看更多进程：ps aux --sort=-%mem | head -n 30'
      ],
      commands: [
        step('free -h'),
        step('ps aux --sort=-%mem | head -n 15')
      ]
    }),
    command({
      id: 'builtin-server-process-top',
      name: '进程资源排行',
      description: '按 CPU 和内存查看当前资源占用最高的进程。',
      usage: '用于初步定位高负载、高 CPU、高内存进程。',
      labels: [READ_ONLY, '进程'],
      advancedUsage: [
        '看进程树：pstree -ap 2>/dev/null | head -n 80',
        '查看指定 PID：ps -fp <PID>'
      ],
      commands: [
        step('ps aux --sort=-%cpu | head -n 15'),
        step('ps aux --sort=-%mem | head -n 15')
      ]
    }),
    command({
      id: 'builtin-server-network-listen',
      name: '端口监听总览',
      description: '查看 TCP/UDP 监听端口、进程和路由信息。',
      usage: '适合确认服务是否监听、端口是否被占用、默认路由是否正常。',
      labels: [READ_ONLY, '网络'],
      advancedUsage: [
        '只看 TCP：ss -tnlp',
        '只看某端口：ss -tunlp | grep :{{端口}}'
      ],
      commands: [
        step('ss -tunlp'),
        step('ip route'),
        step('ip addr show')
      ]
    }),
    command({
      id: 'builtin-server-port-process',
      name: '端口进程查询',
      description: '按当前连接端口生成查询命令，可改成业务端口。',
      usage: '默认端口来自当前连接；可改成 80、443、3306 等端口后再执行。',
      labels: [NEED_EDIT, '网络'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '端口',
          label: '端口',
          type: 'input',
          defaultValue: '{{端口}}',
          placeholder: '例如 80、443、3306',
          help: '默认取当前 SSH 连接端口；排查业务服务时请改成实际业务端口。'
        }
      ],
      advancedUsage: [
        '查询端口占用：ss -tunlp | grep :{{端口}}',
        '查看进程详情：ps -fp <PID>'
      ],
      commands: [
        step('ss -tunlp | grep -E "(:{{端口}}\\s|:{{端口}}$)" || lsof -i :{{端口}}')
      ]
    }),
    command({
      id: 'builtin-server-ip-query',
      name: 'IP 与出口查询',
      description: '查看内网 IP、默认路由、DNS 和公网出口 IP。',
      usage: '用于确认服务器网络身份、出口地址和解析配置。',
      labels: [READ_ONLY, '网络'],
      advancedUsage: [
        '只看 IPv4 地址：ip -4 -brief address',
        '只看公网出口：curl -4 ifconfig.me'
      ],
      commands: [
        step('ip -brief address'),
        step('ip route'),
        step('cat /etc/resolv.conf'),
        step('curl -4 -s --max-time 5 ifconfig.me || curl -4 -s --max-time 5 ip.sb || true')
      ]
    }),
    command({
      id: 'builtin-server-network-change-ip',
      name: '修改服务器 IP',
      description: '按网卡、新 IP、网关和 DNS 生成网络修改命令，默认只预演。',
      usage: '高风险操作，可能导致 SSH 断开；执行前请确认有控制台或回滚方式。',
      labels: [NEED_EDIT, '网络', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: '网络配置修改',
        pathParam: '回滚脚本',
        actionParam: '配置方式',
        mutatingValues: ['temporary', 'nmcli'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '网卡',
          label: '网卡',
          type: 'network-interface',
          defaultValue: '',
          placeholder: '例如 eth0、ens33',
          help: '连接 SSH 后会自动识别默认路由使用的活动网卡，也可手动修改。'
        },
        {
          name: '新IP/CIDR',
          label: '新 IP/CIDR',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 192.168.1.20/24',
          help: '必须包含掩码，例如 /24；只填 IP 不够生成可靠配置。'
        },
        {
          name: '网关',
          label: '网关',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 192.168.1.1',
          help: '需要修改默认路由时填写；留空则不改默认网关。'
        },
        {
          name: 'DNS',
          label: 'DNS',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 223.5.5.5,8.8.8.8',
          help: '多个 DNS 用英文逗号分隔；临时模式只提示，不直接改 resolv.conf。'
        },
        {
          name: '配置方式',
          label: '配置方式',
          type: 'select',
          defaultValue: 'preview',
          help: '预演只打印命令；临时生效用 ip 命令；NetworkManager 用 nmcli 写入连接配置。',
          options: [
            { label: '只预演，不修改', value: 'preview' },
            { label: '临时生效（ip 命令）', value: 'temporary' },
            { label: 'NetworkManager（nmcli）', value: 'nmcli' }
          ]
        },
        {
          name: '回滚保护',
          label: '回滚保护',
          type: 'select',
          defaultValue: 'enabled',
          help: '建议保持开启。修改后若未点击“保留新配置”，服务器会自动恢复原地址和路由。',
          options: [
            { label: '开启（推荐）', value: 'enabled' },
            { label: '关闭（不推荐）', value: 'disabled' }
          ]
        },
        {
          name: '自动回滚秒数',
          label: '自动回滚等待',
          type: 'number',
          defaultValue: '120',
          min: 30,
          max: 900,
          help: '建议 120 秒。修改后请在此时间内验证连接并点击“保留新配置”。'
        },
        {
          name: '确认执行',
          label: '确认执行',
          type: 'select',
          defaultValue: 'no',
          help: '保持“否”只会预演；只有改成“是”才会执行修改。',
          options: [
            { label: '否，只预演', value: 'no' },
            { label: '是，执行修改', value: 'yes' }
          ]
        }
      ],
      advancedUsage: [
        '打开表单时会从当前 SSH 会话自动识别活动网卡、现有 CIDR、网关和 DNS。',
        '执行前会在 /tmp/shellpilot-rollback 创建可执行回滚脚本。',
        '默认 120 秒自动回滚；网络确认正常后点击“保留新配置”解除保护。',
        '建议保留当前 SSH 窗口，同时准备云厂商 VNC/控制台，避免 IP 修改后失联。'
      ],
      commands: [
        step(NETWORK_CHANGE_COMMAND)
      ]
    }),
    command({
      id: 'builtin-server-dns-check',
      name: 'DNS 解析检查',
      description: '按当前连接域名或示例域名检查 DNS 解析。',
      usage: '默认域名来自当前连接；如果当前连接是 IP，则改成你的业务域名。',
      labels: [NEED_EDIT, '网络'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '域名',
          label: '域名',
          type: 'input',
          defaultValue: '{{域名}}',
          placeholder: '例如 example.com',
          help: '当前连接是域名时会自动带入；如果是 IP，请改成业务域名。'
        },
        {
          name: '记录类型',
          label: '记录类型',
          type: 'select',
          defaultValue: 'A',
          help: '常见网站解析用 A/AAAA；邮件或验证记录可选 MX/TXT。',
          options: [
            { label: 'A', value: 'A' },
            { label: 'AAAA', value: 'AAAA' },
            { label: 'CNAME', value: 'CNAME' },
            { label: 'MX', value: 'MX' },
            { label: 'TXT', value: 'TXT' }
          ]
        },
        {
          name: 'DNS服务器',
          label: 'DNS 服务器',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 8.8.8.8，可留空',
          help: '留空时使用系统默认 DNS；填写后会指定该 DNS 服务器查询。'
        }
      ],
      advancedUsage: [
        '指定 DNS：dig @8.8.8.8 {{域名}}',
        '查看系统解析：getent hosts {{域名}}'
      ],
      commands: [
        step('DOMAIN="{{域名}}"\nRECORD_TYPE="{{记录类型}}"\nDNS_SERVER="{{DNS服务器}}"\nif [ -z "$DOMAIN" ]; then echo "请填写域名"; exit 1; fi\nif [ -n "$DNS_SERVER" ]; then\n  nslookup -type="$RECORD_TYPE" "$DOMAIN" "$DNS_SERVER" || dig @"$DNS_SERVER" "$DOMAIN" "$RECORD_TYPE"\nelse\n  getent hosts "$DOMAIN" || nslookup -type="$RECORD_TYPE" "$DOMAIN" || dig "$DOMAIN" "$RECORD_TYPE"\nfi')
      ]
    }),
    command({
      id: 'builtin-server-time-query',
      name: '时间与时区',
      description: '查看系统时间、时区、NTP 同步状态和硬件时间。',
      usage: '适合排查证书过期、日志时间错乱、定时任务异常。',
      labels: [READ_ONLY, '时间'],
      advancedUsage: [
        '查看定时任务：systemctl list-timers --all --no-pager',
        '校验时间同步：timedatectl timesync-status 2>/dev/null'
      ],
      commands: [
        step('date -R'),
        step('timedatectl 2>/dev/null || true'),
        step('hwclock -r 2>/dev/null || true')
      ]
    }),
    command({
      id: 'builtin-server-firewall-status',
      name: '防火墙状态',
      description: '查看 firewalld、ufw、iptables/nftables 当前规则。',
      usage: '用于确认端口不通是否被防火墙或安全策略拦截。',
      labels: [READ_ONLY, '防火墙'],
      advancedUsage: [
        '只看 firewalld：firewall-cmd --list-all',
        '只看 iptables：iptables -S'
      ],
      commands: [
        step('systemctl status firewalld --no-pager 2>/dev/null || true'),
        step('firewall-cmd --list-all 2>/dev/null || ufw status verbose 2>/dev/null || true'),
        step('iptables -S 2>/dev/null || nft list ruleset 2>/dev/null || true')
      ]
    }),
    command({
      id: 'builtin-server-firewall-open-port',
      name: '放行防火墙端口',
      description: '按当前连接端口生成 firewalld/ufw 放行命令。',
      usage: '默认端口来自当前连接，执行前请确认不是误放行敏感端口。',
      labels: [NEED_EDIT, '防火墙', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: '防火墙端口放行',
        pathParam: '回滚脚本',
        actionParam: '生效方式',
        mutatingValues: ['permanent', 'runtime'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '端口',
          label: '端口',
          type: 'input',
          defaultValue: '{{端口}}',
          placeholder: '例如 80、443、3306',
          help: '默认取当前 SSH 端口；开放业务服务时请改成实际业务端口。'
        },
        {
          name: '协议',
          label: '协议',
          type: 'select',
          defaultValue: 'tcp',
          help: 'Web、SSH、数据库多数是 tcp；DNS、部分游戏服务可能是 udp。',
          options: [
            { label: 'TCP', value: 'tcp' },
            { label: 'UDP', value: 'udp' }
          ]
        },
        {
          name: '防火墙类型',
          label: '防火墙类型',
          type: 'select',
          defaultValue: 'auto',
          help: '自动模式会优先使用 firewalld，其次 ufw；不确定时保持自动。',
          options: [
            { label: '自动识别', value: 'auto' },
            { label: 'firewalld', value: 'firewalld' },
            { label: 'ufw', value: 'ufw' }
          ]
        },
        {
          name: '生效方式',
          label: '生效方式',
          type: 'select',
          defaultValue: 'permanent',
          help: '永久生效会写入配置并 reload；临时生效重启后可能失效。',
          options: [
            { label: '永久生效', value: 'permanent' },
            { label: '临时生效', value: 'runtime' }
          ]
        }
      ],
      advancedUsage: [
        'firewalld 永久放行：sudo firewall-cmd --add-port={{端口}}/{{协议}} --permanent && sudo firewall-cmd --reload',
        'ufw 放行：sudo ufw allow {{端口}}/{{协议}}',
        'firewalld 回滚：sudo firewall-cmd --remove-port={{端口}}/{{协议}} --permanent && sudo firewall-cmd --reload',
        'ufw 回滚：sudo ufw delete allow {{端口}}/{{协议}}'
      ],
      commands: [
        step(`PORT="{{端口}}"
PROTO="{{协议}}"
FIREWALL_KIND="{{防火墙类型}}"
APPLY_MODE="{{生效方式}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "当前不是 root 且没有 sudo，无法修改防火墙"; exit 1; fi
fi
case "$PORT" in *[!0-9]*|"") echo "端口必须是数字"; exit 1;; esac
echo "准备放行: $PORT/$PROTO，类型=$FIREWALL_KIND，方式=$APPLY_MODE"
echo "回滚参考 firewalld: $RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
echo "回滚参考 ufw: $RUN_AS ufw delete allow $PORT/$PROTO"
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改防火墙。"; exit 0; fi
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-firewall-rollback-$$.sh"
if [ "$FIREWALL_KIND" = "firewalld" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v firewall-cmd >/dev/null 2>&1; }; then
  {
    echo '#!/bin/sh'
    if [ "$APPLY_MODE" = "permanent" ]; then
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload"
    else
      echo "$RUN_AS firewall-cmd --remove-port=$PORT/$PROTO"
    fi
  } > "$TMP_ROLLBACK"
  $RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
  if [ "$APPLY_MODE" = "permanent" ]; then
    $RUN_AS firewall-cmd --add-port=$PORT/$PROTO --permanent && $RUN_AS firewall-cmd --reload
  else
    $RUN_AS firewall-cmd --add-port=$PORT/$PROTO
  fi
  echo "回滚脚本: $ROLLBACK_SCRIPT"; exit $?
fi
if [ "$FIREWALL_KIND" = "ufw" ] || { [ "$FIREWALL_KIND" = "auto" ] && command -v ufw >/dev/null 2>&1; }; then
  printf '%s\n' '#!/bin/sh' "$RUN_AS ufw delete allow $PORT/$PROTO" > "$TMP_ROLLBACK"
  $RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
  $RUN_AS ufw allow $PORT/$PROTO
  echo "回滚脚本: $ROLLBACK_SCRIPT"; exit $?
fi
echo "未检测到 firewalld 或 ufw，请手动确认 iptables/nftables 规则"; exit 1`)
      ]
    }),
    command({
      id: 'builtin-server-service-logs',
      name: '失败服务与日志',
      description: '查看失败的 systemd 服务和最近 warning 以上日志。',
      usage: '适合定位服务启动失败、系统告警和近期异常。',
      labels: [READ_ONLY, '日志'],
      advancedUsage: [
        '查看更多日志：journalctl -p warning -n 300 --no-pager',
        '按服务查看：journalctl -u {{服务名}} -n 100 --no-pager'
      ],
      commands: [
        step('systemctl --failed --no-pager'),
        step('journalctl -p warning -n 120 --no-pager')
      ]
    }),
    command({
      id: 'builtin-server-service-status',
      name: '服务状态查询',
      description: '自动识别当前服务器上的 systemd 服务，可多选查看运行状态和日志。',
      usage: '连接 SSH 后从列表选择服务；未识别到时也可以手动输入完整服务名。',
      labels: [NEED_EDIT, '服务'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '服务名',
          label: '服务名',
          type: 'service-target',
          targetType: 'service',
          sources: ['systemd'],
          multiple: true,
          defaultValue: '',
          placeholder: '自动识别后选择一个或多个服务',
          help: '支持多选；也可以输入完整的 systemd 服务名后按回车。'
        },
        {
          name: '日志行数',
          label: '日志行数',
          type: 'number',
          defaultValue: '100',
          min: 10,
          max: 1000,
          help: '建议 50-200，行数过大可能刷屏。'
        },
        {
          name: '查看日志',
          label: '查看日志',
          type: 'select',
          defaultValue: 'yes',
          help: '选择“是”会同时读取 journalctl 最近日志。',
          options: [
            { label: '是', value: 'yes' },
            { label: '否，只看状态', value: 'no' }
          ]
        }
      ],
      advancedUsage: [
        '需要启动、停止或重启服务时，请使用“服务控制”，修改前会生成回滚脚本。',
        '服务列表来自当前连接的服务器，不会在后台持续扫描。'
      ],
      commands: [
        step(`SERVICES="{{服务名}}"
LOG_LINES="{{日志行数}}"
SHOW_LOG="{{查看日志}}"
if [ -z "$SERVICES" ]; then echo "请选择或填写服务名"; exit 1; fi
OLD_IFS="$IFS"
IFS=','
for SERVICE in $SERVICES; do
  case "$SERVICE" in *[!a-zA-Z0-9_.@-]*|"") echo "服务名称不合法: $SERVICE"; continue;; esac
  echo "===== $SERVICE ====="
  systemctl status "$SERVICE" --no-pager || true
  if [ "$SHOW_LOG" = "yes" ]; then
    journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager || true
  fi
done
IFS="$OLD_IFS"`)
      ]
    }),
    command({
      id: 'builtin-server-log-search',
      name: '日志关键词搜索',
      description: '按路径和关键词搜索日志文件，限制输出避免刷屏。',
      usage: '默认搜索 /var/log 里的 error，可改成 timeout、failed 或业务关键词。',
      labels: [NEED_EDIT, '日志'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '日志路径',
          label: '日志路径',
          type: 'input',
          defaultValue: '{{日志路径}}',
          placeholder: '例如 /var/log 或 /var/log/nginx',
          help: '填写目录或文件路径；目录会递归搜索。'
        },
        {
          name: '关键词',
          label: '关键词',
          type: 'input',
          defaultValue: '{{关键词}}',
          placeholder: '例如 error、timeout、failed',
          help: '支持普通关键词；复杂正则请在命令预览里手动微调。'
        },
        {
          name: '输出行数',
          label: '输出行数',
          type: 'number',
          defaultValue: '200',
          min: 20,
          max: 5000,
          help: '限制输出避免刷屏；需要更多结果可以调大。'
        },
        {
          name: '包含压缩日志',
          label: '包含压缩日志',
          type: 'select',
          defaultValue: 'no',
          help: '选择“是”会额外搜索 .gz 压缩日志；zip 日志建议用 AI 附件分析。',
          options: [
            { label: '否', value: 'no' },
            { label: '是，包含 .gz', value: 'yes' }
          ]
        }
      ],
      advancedUsage: [
        '搜索压缩日志：zgrep -R "{{关键词}}" {{日志路径}}/*.gz 2>/dev/null | head -n 200',
        '只看最近日志：find {{日志路径}} -type f -mtime -2 -name "*.log" -print'
      ],
      commands: [
        step('LOG_PATH="{{日志路径}}"\nKEYWORD="{{关键词}}"\nLIMIT="{{输出行数}}"\nINCLUDE_GZ="{{包含压缩日志}}"\nif [ -z "$LOG_PATH" ] || [ -z "$KEYWORD" ]; then echo "请填写日志路径和关键词"; exit 1; fi\ngrep -RIn --binary-files=without-match "$KEYWORD" "$LOG_PATH" 2>/dev/null | head -n "$LIMIT"\nif [ "$INCLUDE_GZ" = "yes" ]; then\n  find "$LOG_PATH" -type f -name "*.gz" -print0 2>/dev/null | xargs -0 zgrep -In "$KEYWORD" 2>/dev/null | head -n "$LIMIT"\nfi')
      ]
    }),
    command({
      id: 'builtin-server-nginx',
      name: 'Nginx 排查',
      description: '检查 Nginx 配置、服务状态和最近错误日志。',
      usage: '适合排查 502、配置错误、端口监听和反向代理问题。',
      labels: [READ_ONLY, 'Nginx'],
      advancedUsage: [
        '查看站点配置：nginx -T 2>/dev/null | head -n 200',
        '按关键词看错误：tail -n 300 /var/log/nginx/error.log | grep -i "{{关键词}}"'
      ],
      commands: [
        step('nginx -t'),
        step('systemctl status nginx --no-pager'),
        step('tail -n 120 /var/log/nginx/error.log')
      ]
    }),
    command({
      id: 'builtin-server-docker',
      name: 'Docker 排查',
      description: '查看容器、资源占用、镜像和 Docker 服务状态。',
      usage: '适合排查容器未启动、端口映射、资源占用和镜像问题。',
      labels: [READ_ONLY, 'Docker'],
      advancedUsage: [
        '查看容器日志：docker logs <container-id> --tail 200',
        '查看端口映射：docker ps --format "table {{.Names}}\\t{{.Ports}}"'
      ],
      commands: [
        step('docker ps -a'),
        step('docker stats --no-stream'),
        step('docker images'),
        step('systemctl status docker --no-pager 2>/dev/null || true')
      ]
    }),
    command({
      id: 'builtin-server-connectivity-check',
      name: '网络连通性检测',
      description: '按目标地址、端口和检测方式检查服务器网络连通性。',
      usage: '适合排查 DNS 正常但端口不通、路由中断或网络超时问题。',
      labels: [NEED_EDIT, '网络', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        inputParam('目标地址', '目标地址', '8.8.8.8', '可填写 IP 或域名，例如数据库地址、API 域名或公网 DNS。', '例如 8.8.8.8'),
        selectParam('检测方式', '检测方式', 'ping', 'Ping 检查基础连通；TCP 检查端口；路由跟踪定位中断节点。', [
          { label: 'Ping', value: 'ping' },
          { label: 'TCP 端口', value: 'tcp' },
          { label: '路由跟踪', value: 'trace' }
        ]),
        inputParam('目标端口', '目标端口', '443', '仅 TCP 检测使用，例如 22、80、443、3306。', '例如 443'),
        numberParam('检测次数', '检测次数', '4', 'Ping 次数或 TCP 尝试次数，建议 3-10 次。', 1, 20)
      ],
      advancedUsage: [
        'TCP 失败后可结合“端口监听总览”和“防火墙状态”继续定位。',
        '路由跟踪优先使用 tracepath，服务器未安装时自动尝试 traceroute。'
      ],
      commands: [
        step(`TARGET="{{目标地址}}"
MODE="{{检测方式}}"
PORT="{{目标端口}}"
COUNT="{{检测次数}}"
if [ -z "$TARGET" ]; then echo "请填写目标地址"; exit 1; fi
case "$MODE" in
  ping) ping -c "$COUNT" "$TARGET" ;;
  tcp) for i in $(seq 1 "$COUNT"); do if command -v nc >/dev/null 2>&1; then nc -zvw 5 "$TARGET" "$PORT"; else timeout 5 bash -c "</dev/tcp/$TARGET/$PORT"; fi && echo "第 $i 次: $TARGET:$PORT 可连接" || echo "第 $i 次: $TARGET:$PORT 连接失败"; done ;;
  trace) tracepath "$TARGET" 2>/dev/null || traceroute "$TARGET" ;;
  *) echo "未知检测方式"; exit 1 ;;
esac`)
      ]
    }),
    command({
      id: 'builtin-server-http-check',
      name: 'HTTP 接口检测',
      description: '按网址、请求方法、超时和重定向设置检测 HTTP 服务。',
      usage: '用于检查网站状态码、响应耗时、证书握手和重定向结果。',
      labels: [NEED_EDIT, 'HTTP', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        inputParam('请求地址', '请求地址', 'https://example.com', '填写完整 http:// 或 https:// 地址，可包含接口路径。', 'https://example.com/health'),
        selectParam('请求方法', '请求方法', 'HEAD', 'HEAD 不下载响应正文；GET 更接近真实访问。', [
          { label: 'HEAD', value: 'HEAD' },
          { label: 'GET', value: 'GET' }
        ]),
        numberParam('超时秒数', '超时秒数', '10', '连接和请求最大等待时间，建议 5-30 秒。', 1, 120),
        selectParam('跟随重定向', '跟随重定向', 'yes', '开启后会跟随 301/302，显示最终地址和状态码。', [
          { label: '是', value: 'yes' },
          { label: '否', value: 'no' }
        ])
      ],
      advancedUsage: [
        '排查 Host 路由时，可在高级命令中增加 -H "Host: example.com"。',
        '仅查看时间指标时保留 -o /dev/null 和 -w 输出格式。'
      ],
      commands: [
        step(`URL="{{请求地址}}"
METHOD="{{请求方法}}"
TIMEOUT="{{超时秒数}}"
FOLLOW="{{跟随重定向}}"
case "$URL" in http://*|https://*) ;; *) echo "请求地址必须以 http:// 或 https:// 开头"; exit 1;; esac
CURL_ARGS="--max-time $TIMEOUT -sS -o /dev/null -D -"
if [ "$FOLLOW" = "yes" ]; then CURL_ARGS="$CURL_ARGS -L"; fi
if [ "$METHOD" = "HEAD" ]; then CURL_ARGS="$CURL_ARGS -I"; fi
curl $CURL_ARGS -w '\n状态码: %{http_code}\n远端地址: %{remote_ip}\n总耗时: %{time_total}s\n最终地址: %{url_effective}\n' "$URL"`)
      ]
    }),
    command({
      id: 'builtin-server-tls-check',
      name: 'TLS 证书检查',
      description: '按域名和端口读取远端 TLS 证书主题、签发者和有效期。',
      usage: '适合排查证书过期、SNI 错误、证书链异常或 HTTPS 握手失败。',
      labels: [NEED_EDIT, '证书', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        inputParam('证书域名', '证书域名', '{{域名}}', '必须填写证书对应域名，SNI 检查也会使用该值。', '例如 api.example.com'),
        inputParam('TLS端口', 'TLS 端口', '443', 'HTTPS 通常是 443，也可填写邮件或自定义 TLS 端口。', '例如 443'),
        numberParam('连接超时', '连接超时', '10', '建立 TLS 连接的最长等待秒数。', 1, 60)
      ],
      advancedUsage: [
        '查看完整证书链：openssl s_client -showcerts -connect 域名:端口 -servername 域名。',
        '检查剩余有效期：openssl x509 -checkend 604800 可检查未来 7 天是否过期。'
      ],
      commands: [
        step(`DOMAIN="{{证书域名}}"
PORT="{{TLS端口}}"
TIMEOUT="{{连接超时}}"
if [ -z "$DOMAIN" ]; then echo "请填写证书域名"; exit 1; fi
timeout "$TIMEOUT" openssl s_client -connect "$DOMAIN:$PORT" -servername "$DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -serial -dates -fingerprint -sha256`)
      ]
    }),
    command({
      id: 'builtin-server-directory-analysis',
      name: '目录占用分析',
      description: '按目录、深度和数量列出占用空间最大的文件与子目录。',
      usage: '用于快速定位日志暴涨、缓存堆积、备份文件或大目录占满磁盘。',
      labels: [NEED_EDIT, '磁盘', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        inputParam('分析目录', '分析目录', '/var/log', '填写要分析的绝对路径，默认查看日志目录。', '例如 /var/log'),
        numberParam('目录深度', '目录深度', '1', '子目录统计深度，建议 1-3，过大会增加扫描时间。', 1, 8),
        numberParam('显示数量', '显示数量', '20', '显示占用最大的前 N 项。', 5, 200)
      ],
      advancedUsage: [
        '跨挂载点可能很慢；只查当前文件系统可在 find 中增加 -xdev。',
        '大目录扫描期间可按 Ctrl+C 停止，不会修改任何文件。'
      ],
      commands: [
        step(`TARGET_DIR="{{分析目录}}"
DEPTH="{{目录深度}}"
TOP="{{显示数量}}"
if [ ! -d "$TARGET_DIR" ]; then echo "目录不存在: $TARGET_DIR"; exit 1; fi
echo "目录占用排行:"; du -xh --max-depth="$DEPTH" -- "$TARGET_DIR" 2>/dev/null | sort -h | tail -n "$TOP"
echo "大文件排行:"; find "$TARGET_DIR" -type f -printf '%s %p\n' 2>/dev/null | sort -n | tail -n "$TOP" | numfmt --field=1 --to=iec 2>/dev/null || true`)
      ]
    }),
    command({
      id: 'builtin-server-process-detail',
      name: '进程详情查询',
      description: '按 PID 或进程名查看命令行、资源、端口、文件和线程信息。',
      usage: '适合排查进程占用过高、启动参数错误、端口冲突或文件句柄异常。',
      labels: [NEED_EDIT, '进程', READ_ONLY],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        selectParam('查询方式', '查询方式', 'name', '知道 PID 时更精确；不知道时可按进程名搜索。', [
          { label: '按进程名', value: 'name' },
          { label: '按 PID', value: 'pid' }
        ]),
        inputParam('进程关键字', '进程名或 PID', 'nginx', '进程名可填写 nginx、java、mysqld；PID 只填写数字。', '例如 nginx 或 1234'),
        numberParam('输出行数', '输出行数', '100', '限制 lsof 和线程输出行数，避免刷屏。', 20, 1000)
      ],
      advancedUsage: [
        '持续观察某 PID：top -H -p PID。',
        '查看系统调用：strace -p PID，生产环境使用前请评估性能影响。'
      ],
      commands: [
        step(`QUERY_MODE="{{查询方式}}"
QUERY="{{进程关键字}}"
LIMIT="{{输出行数}}"
if [ -z "$QUERY" ]; then echo "请填写进程名或 PID"; exit 1; fi
if [ "$QUERY_MODE" = "pid" ]; then PIDS="$QUERY"; else PIDS="$(pgrep -d ' ' -f -- "$QUERY")"; fi
if [ -z "$PIDS" ]; then echo "未找到匹配进程"; exit 1; fi
for PID in $PIDS; do
  echo "===== PID $PID ====="
  ps -fp "$PID"
  cat "/proc/$PID/status" 2>/dev/null | head -n 40
  ss -tunlp 2>/dev/null | grep "pid=$PID," || true
  lsof -p "$PID" 2>/dev/null | head -n "$LIMIT" || true
done`)
      ]
    }),
    command({
      id: 'builtin-server-service-action',
      name: '服务控制',
      description: '按服务名查询、启动、停止、重启或重载 systemd 服务。',
      usage: '默认只查询状态；修改操作会记录原状态并生成快捷回滚脚本。',
      labels: [NEED_EDIT, '服务', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: 'systemd 服务操作',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['start', 'stop', 'restart', 'reload', 'enable', 'disable'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '服务名称',
          label: '服务名称',
          type: 'service-target',
          targetType: 'service',
          sources: ['systemd'],
          multiple: false,
          defaultValue: '',
          placeholder: '自动识别后选择服务',
          help: '列表来自当前 SSH 服务器；也可以手动输入完整 systemd 服务名。'
        },
        selectParam('操作', '操作', 'status', '默认查询状态；启动、停止、重启、重载和开机自启属于修改操作。', [
          { label: '查询状态', value: 'status' },
          { label: '启动', value: 'start' },
          { label: '停止', value: 'stop' },
          { label: '重启', value: 'restart' },
          { label: '重载配置', value: 'reload' },
          { label: '设置开机自启', value: 'enable' },
          { label: '取消开机自启', value: 'disable' }
        ]),
        numberParam('日志行数', '日志行数', '80', '操作后显示最近日志，建议 50-200 行。', 10, 1000)
      ],
      advancedUsage: [
        '执行前记录服务运行和开机自启状态，回滚时恢复到原状态。',
        '重启产生的短暂中断无法撤销，但回滚会恢复服务原先的运行状态。'
      ],
      commands: [
        step(`SERVICE="{{服务名称}}"
ACTION="{{操作}}"
LOG_LINES="{{日志行数}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
case "$SERVICE" in *[!a-zA-Z0-9_.@-]*|"") echo "服务名称不合法"; exit 1;; esac
if [ "$ACTION" = "status" ]; then systemctl status "$SERVICE" --no-pager; journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager; exit $?; fi
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改服务。"; exit 0; fi
OLD_ACTIVE="$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
OLD_ENABLED="$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-service-rollback-$$.sh"
{
  echo '#!/bin/sh'
  if [ "$OLD_ACTIVE" = "active" ]; then echo "$RUN_AS systemctl start '$SERVICE'"; else echo "$RUN_AS systemctl stop '$SERVICE'"; fi
  if [ "$OLD_ENABLED" = "enabled" ]; then echo "$RUN_AS systemctl enable '$SERVICE'"; else echo "$RUN_AS systemctl disable '$SERVICE'"; fi
} > "$TMP_ROLLBACK"
$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
$RUN_AS systemctl "$ACTION" "$SERVICE"
systemctl status "$SERVICE" --no-pager || true
journalctl -u "$SERVICE" -n "$LOG_LINES" --no-pager || true
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    }),
    command({
      id: 'builtin-server-docker-action',
      name: 'Docker 容器操作',
      description: '按容器名查看日志、配置、资源，或启动、停止和重启容器。',
      usage: '默认只看日志；修改操作会保存容器原运行状态并提供快捷回滚。',
      labels: [NEED_EDIT, 'Docker', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: 'Docker 容器操作',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['start', 'stop', 'restart'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        {
          name: '容器名称',
          label: '容器名称或 ID',
          type: 'service-target',
          targetType: 'container',
          sources: ['docker', 'compose'],
          multiple: false,
          defaultValue: '',
          placeholder: '自动识别后选择容器',
          help: '列表来自当前 SSH 服务器；留空执行时会列出全部容器。'
        },
        selectParam('操作', '操作', 'logs', '日志、配置和资源为只读；启动、停止和重启会修改容器状态。', [
          { label: '查看日志', value: 'logs' },
          { label: '查看配置', value: 'inspect' },
          { label: '查看资源', value: 'stats' },
          { label: '启动', value: 'start' },
          { label: '停止', value: 'stop' },
          { label: '重启', value: 'restart' }
        ]),
        numberParam('日志行数', '日志行数', '100', '查看日志时读取末尾行数。', 10, 5000)
      ],
      advancedUsage: [
        '修改前记录容器是否正在运行，回滚时恢复原运行状态。',
        '容器重启后的内存状态无法恢复；重要业务先确认副本和健康检查。'
      ],
      commands: [
        step(`CONTAINER="{{容器名称}}"
ACTION="{{操作}}"
LOG_LINES="{{日志行数}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
if [ -z "$CONTAINER" ]; then docker ps -a; exit 0; fi
case "$ACTION" in
  logs) docker logs "$CONTAINER" --tail "$LOG_LINES"; exit $? ;;
  inspect) docker inspect "$CONTAINER"; exit $? ;;
  stats) docker stats --no-stream "$CONTAINER"; exit $? ;;
esac
if [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改容器。"; exit 0; fi
OLD_RUNNING="$(docker inspect "$CONTAINER" 2>/dev/null | sed -n 's/.*"Running": \\(true\\|false\\).*/\\1/p' | head -n 1)"
if [ -z "$OLD_RUNNING" ]; then echo "未找到容器: $CONTAINER"; exit 1; fi
mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-docker-rollback-$$.sh"
{
  echo '#!/bin/sh'
  if [ "$OLD_RUNNING" = "true" ]; then echo "docker start '$CONTAINER'"; else echo "docker stop '$CONTAINER'"; fi
} > "$TMP_ROLLBACK"
mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; chmod 700 "$ROLLBACK_SCRIPT"
docker "$ACTION" "$CONTAINER"
docker ps -a --filter "id=$CONTAINER" --filter "name=$CONTAINER"
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    }),
    command({
      id: 'builtin-server-file-permission',
      name: '文件权限与归属',
      description: '按路径预览或修改文件权限、所有者和所属组。',
      usage: '默认只预览；执行修改前记录原权限和归属并生成快捷回滚。',
      labels: [NEED_EDIT, '文件', '高风险'],
      editBeforeRun: true,
      confirmRequired: true,
      mutatesServer: true,
      rollback: {
        title: '文件权限与归属修改',
        pathParam: '回滚脚本',
        actionParam: '操作',
        mutatingValues: ['apply'],
        confirmParam: '确认执行',
        confirmValue: 'yes'
      },
      params: [
        inputParam('目标路径', '目标路径', '/var/www', '填写单个文件或目录的绝对路径，本操作默认不递归。', '例如 /var/www/app'),
        inputParam('权限模式', '权限模式', '755', '填写 3 或 4 位八进制权限，例如 644、755、0750。', '例如 755'),
        inputParam('所有者', '所有者', '', '可留空表示不修改；例如 root、www-data。', '例如 www-data'),
        inputParam('所属组', '所属组', '', '可留空表示不修改；例如 root、www-data。', '例如 www-data'),
        selectParam('操作', '操作', 'preview', '预览会显示 stat 和路径权限；应用才会修改。', [
          { label: '只预览', value: 'preview' },
          { label: '应用修改', value: 'apply' }
        ])
      ],
      advancedUsage: [
        '本功能默认不递归，避免一次改坏整个目录树。',
        '回滚脚本会恢复目标当前的权限、所有者和所属组。'
      ],
      commands: [
        step(`TARGET="{{目标路径}}"
MODE="{{权限模式}}"
OWNER="{{所有者}}"
GROUP="{{所属组}}"
ACTION="{{操作}}"
APPLY_CHANGE="{{确认执行}}"
ROLLBACK_SCRIPT="{{回滚脚本}}"
RUN_AS=""; if [ "$(id -u)" != "0" ]; then RUN_AS="sudo"; fi
if [ ! -e "$TARGET" ]; then echo "路径不存在: $TARGET"; exit 1; fi
echo "当前信息:"; stat -c '路径=%n 权限=%a 所有者=%U 所属组=%G' "$TARGET"; namei -l "$TARGET" 2>/dev/null || true
if [ "$ACTION" != "apply" ] || [ "$APPLY_CHANGE" != "yes" ]; then echo "当前为预览模式，未修改文件。"; exit 0; fi
case "$MODE" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) ;; *) echo "权限模式必须是 3 或 4 位八进制数"; exit 1;; esac
OLD_MODE="$(stat -c %a "$TARGET")"; OLD_OWNER="$(stat -c %U "$TARGET")"; OLD_GROUP="$(stat -c %G "$TARGET")"
$RUN_AS mkdir -p /tmp/shellpilot-rollback
TMP_ROLLBACK="/tmp/shellpilot-file-rollback-$$.sh"
printf '%s\n' '#!/bin/sh' "$RUN_AS chmod '$OLD_MODE' '$TARGET'" "$RUN_AS chown '$OLD_OWNER:$OLD_GROUP' '$TARGET'" > "$TMP_ROLLBACK"
$RUN_AS mv "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"; $RUN_AS chmod 700 "$ROLLBACK_SCRIPT"
$RUN_AS chmod "$MODE" "$TARGET"
if [ -n "$OWNER$GROUP" ]; then $RUN_AS chown "\${OWNER:-$OLD_OWNER}:\${GROUP:-$OLD_GROUP}" "$TARGET"; fi
stat -c '修改后: 路径=%n 权限=%a 所有者=%U 所属组=%G' "$TARGET"
echo "回滚脚本: $ROLLBACK_SCRIPT"`)
      ]
    }),
    command({
      id: 'builtin-server-packet-capture',
      name: '抓包采样',
      description: '先检查 tcpdump，默认抓取少量 TCP 包并保存 pcap 文件。',
      usage: '默认保存到 /tmp，可改过滤条件、数量或保存路径；执行前请确认磁盘空间和抓包范围。',
      labels: [NEED_EDIT, '抓包'],
      editBeforeRun: true,
      confirmRequired: true,
      params: [
        {
          name: '网卡',
          label: '网卡',
          type: 'select',
          defaultValue: 'any',
          help: '不知道网卡名时保持 any；如果已确认网卡，可选择 eth0、ens33、lo 或在命令预览中手动修改。',
          options: [
            { label: 'any（所有网卡）', value: 'any' },
            { label: 'eth0', value: 'eth0' },
            { label: 'ens33 / ens 系网卡', value: 'ens33' },
            { label: 'lo（本机回环）', value: 'lo' }
          ]
        },
        {
          name: '过滤类型',
          label: '过滤类型',
          type: 'select',
          defaultValue: 'tcp',
          help: '初学者建议先按端口或 IP 缩小范围；不确定时使用全部 TCP。',
          options: [
            { label: '全部 TCP', value: 'tcp' },
            { label: '按端口', value: 'port' },
            { label: '按 IP', value: 'ip' },
            { label: 'IP + 端口', value: 'ip-port' },
            { label: '自定义过滤', value: 'custom' }
          ]
        },
        {
          name: '过滤端口',
          label: '端口',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 80、443、3306',
          help: '选择“按端口”或“IP + 端口”时填写；留空则回退为 tcp。'
        },
        {
          name: '过滤IP',
          label: 'IP',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 8.8.8.8 或客户端 IP',
          help: '选择“按 IP”或“IP + 端口”时填写；可填访问来源、目标服务或外部地址。'
        },
        {
          name: '自定义过滤',
          label: '自定义过滤',
          type: 'input',
          defaultValue: '',
          placeholder: '例如 tcp and dst port 443',
          help: '选择“自定义过滤”时生效，支持 tcpdump 过滤表达式。'
        },
        {
          name: '数量',
          label: '抓包数量',
          type: 'number',
          defaultValue: '50',
          min: 1,
          max: 10000,
          help: '建议 50-200，数量越大文件越大，生产环境不要长时间抓包。'
        },
        {
          name: '抓包文件',
          label: '保存路径',
          type: 'input',
          defaultValue: '{{抓包文件}}',
          placeholder: '/tmp/shellpilot-capture.pcap',
          help: '默认保存到 /tmp；执行完成后可在 SFTP 中下载 pcap 文件分析。'
        }
      ],
      advancedUsage: [
        '保存位置：{{抓包文件}}，可执行完后用 SFTP 下载分析。',
        '默认过滤：tcp，只采样 {{数量}} 个 TCP 包；不建议默认过滤当前服务器公网 IP。',
        '过滤端口：port 80、port 443、tcp port {{端口}}。',
        '过滤 IP：host {{目标IP}}、src host {{目标IP}}、dst host {{目标IP}}。',
        '组合过滤：host {{目标IP}} and port 443。',
        '未安装工具：Debian/Ubuntu 用 apt install -y tcpdump；CentOS/RHEL 用 yum install -y tcpdump。',
        '只在终端打印：删除 -w "{{抓包文件}}" 这一段即可。'
      ],
      commands: [
        step('if ! command -v tcpdump >/dev/null 2>&1; then\n  echo "未安装 tcpdump，请先安装：Debian/Ubuntu: apt install -y tcpdump；CentOS/RHEL: yum install -y tcpdump"\nelse\n  CAP_FILE="{{抓包文件}}"\n  RUN_AS=""\n  if [ "$(id -u)" != "0" ]; then\n    if command -v sudo >/dev/null 2>&1; then RUN_AS="sudo"; else echo "当前不是 root 且没有 sudo，无法抓包"; exit 1; fi\n  fi\n  $RUN_AS tcpdump -nn -i {{网卡}} {{过滤条件}} -c {{数量}} -w "$CAP_FILE" && echo "抓包文件: $CAP_FILE"\nfi')
      ]
    })
  ]
}
