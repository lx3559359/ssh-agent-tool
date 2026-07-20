import { READ_ONLY, NEED_EDIT, step, defineCommand, inputParam, numberParam, selectParam } from './shared/definition.js'

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

export function getNetworkCommands () {
  return [
    defineCommand({
      id: 'builtin-server-network-errors',
      name: '网络错误与链路状态',
      description: '查看网卡收发错误、丢包、运行状态以及可用的物理链路信息。',
      usage: '用于排查网卡异常、链路断开、双工或速率不匹配导致的网络问题。',
      labels: [READ_ONLY, '网络'],
      advancedUsage: [
        '最多检查前 20 个网卡，链路统计和每个网卡的 ethtool 字段均有输出上限。',
        '未安装 ip 时仍会继续读取 /sys/class/net 中可访问的网卡状态。'
      ],
      commands: [
        step(String.raw`(
  run_bounded_link_stats () {
    {
      ip -s link 2>/dev/null
      printf '\\036SHELLPILOT_NETWORK_STATUS=%s\\n' "$?"
    } | awk '
      BEGIN {
        limit = 100
        marker = sprintf("%c", 30) "SHELLPILOT_NETWORK_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && emitted < limit) {
            print prefix
            emitted++
          }
          command_status = substr($0, marker_position + length(marker))
          status_seen = 1
          next
        }
        if (emitted < limit) {
          print
          emitted++
          next
        }
        truncated = 1
        exit
      }
      END {
        if (truncated || (status_seen && command_status == 0)) {
          exit 0
        }
        exit 1
      }
    '
  }

  printf '===== 网卡错误与丢包统计 =====\\n'
  if command -v ip >/dev/null 2>&1; then
    run_bounded_link_stats || printf '无法读取 ip 链路统计。\\n'
  else
    printf '未安装 ip，跳过链路统计。\\n'
  fi

  printf '===== 网卡运行与物理链路状态 =====\\n'
  interface_count=0
  for interface_path in /sys/class/net/*; do
    [ -d "$interface_path" ] || continue
    interface_count=$((interface_count + 1))
    [ "$interface_count" -le 20 ] || break
    interface_name="$(basename "$interface_path")"
    interface_state="未知"
    if [ -r "$interface_path/operstate" ]; then
      IFS= read -r interface_state < "$interface_path/operstate" || interface_state="未知"
      [ -n "$interface_state" ] || interface_state="未知"
    fi
    printf '%s operstate=%s\\n' "$interface_name" "$interface_state"
    if command -v ethtool >/dev/null 2>&1; then
      ethtool "$interface_name" 2>/dev/null | awk '
        /^[[:space:]]*(Speed|Duplex|Link detected):/ {
          print
          matched++
          if (matched >= 3) exit
        }
      ' || true
    fi
  done
)
true`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-tcp-states',
      name: 'TCP 连接状态汇总',
      description: '汇总 TCP 连接状态并显示套接字总体统计，兼容 ss 与 netstat。',
      usage: '用于排查连接堆积、握手异常、TIME-WAIT 过多和连接资源压力。',
      labels: [READ_ONLY, '网络'],
      advancedUsage: [
        '优先使用 ss；仅在 ss 不可用或执行失败时回退到 netstat。',
        '状态聚合最多读取 10000 行并最多输出 32 种状态。'
      ],
      commands: [
        step(String.raw`(
  run_ss_summary () {
    {
      ss -s 2>/dev/null
      printf '\\036SHELLPILOT_TCP_STATUS=%s\\n' "$?"
    } | awk '
      BEGIN {
        limit = 40
        marker = sprintf("%c", 30) "SHELLPILOT_TCP_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && emitted < limit) {
            print prefix
            emitted++
          }
          command_status = substr($0, marker_position + length(marker))
          status_seen = 1
          next
        }
        if (emitted < limit) {
          print
          emitted++
          next
        }
        truncated = 1
        exit
      }
      END {
        if (truncated || (status_seen && command_status == 0)) {
          exit 0
        }
        exit 1
      }
    '
  }

  aggregate_tcp_states () {
    source_kind="$1"
    shift
    {
      "$@" 2>/dev/null
      printf '\\036SHELLPILOT_TCP_STATUS=%s\\n' "$?"
    } | awk -v source_kind="$source_kind" '
      BEGIN {
        input_limit = 10000
        output_limit = 32
        marker = sprintf("%c", 30) "SHELLPILOT_TCP_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          command_status = substr($0, marker_position + length(marker))
          status_seen = 1
          if (length(prefix) == 0) next
          $0 = prefix
        }
        if (line_count >= input_limit) {
          truncated = 1
          exit
        }
        line_count++
        state = ""
        if (source_kind == "ss") {
          if ($1 != "State" && $1 != "") state = $1
        } else if ($1 ~ /^tcp/) {
          state = $NF
        }
        if (state != "") states[state]++
      }
      END {
        if (!(truncated || (status_seen && command_status == 0))) exit 1
        print "TCP 状态汇总:"
        emitted = 0
        for (state in states) {
          if (emitted >= output_limit) {
            print "其余状态已省略"
            break
          }
          printf "%s %d\\n", state, states[state]
          emitted++
        }
        exit 0
      }
    '
  }

  if command -v ss >/dev/null 2>&1 &&
    run_ss_summary &&
    aggregate_tcp_states ss ss -tan
  then
    true
  elif command -v netstat >/dev/null 2>&1 &&
    aggregate_tcp_states netstat netstat -ant
  then
    true
  else
    printf '未检测到可用的 ss 或 netstat，无法统计 TCP 状态。\\n'
  fi
)
true`)
      ]
    }),
    defineCommand({
      id: 'builtin-server-route-mtu',
      name: '路由策略与 MTU',
      description: '查看全部路由表、策略路由规则以及网卡 MTU 和链路详细信息。',
      usage: '用于排查多路由表选择错误、策略路由冲突和 MTU 不匹配问题。',
      labels: [READ_ONLY, '网络'],
      advancedUsage: [
        '三个区段分别限制为 80、40 和 80 行，避免大型路由表刷屏。'
      ],
      commands: [
        step(String.raw`(
  run_bounded_ip_section () {
    limit="$1"
    shift
    {
      "$@" 2>/dev/null
      printf '\\036SHELLPILOT_ROUTE_STATUS=%s\\n' "$?"
    } | awk -v limit="$limit" '
      BEGIN {
        marker = sprintf("%c", 30) "SHELLPILOT_ROUTE_STATUS="
      }
      {
        marker_position = index($0, marker)
        if (marker_position > 0) {
          prefix = substr($0, 1, marker_position - 1)
          if (length(prefix) > 0 && emitted < limit) {
            print prefix
            emitted++
          }
          command_status = substr($0, marker_position + length(marker))
          status_seen = 1
          next
        }
        if (emitted < limit) {
          print
          emitted++
          next
        }
        truncated = 1
        exit
      }
      END {
        if (truncated || (status_seen && command_status == 0)) {
          exit 0
        }
        exit 1
      }
    '
  }

  if ! command -v ip >/dev/null 2>&1; then
    printf '未安装 ip，无法读取路由策略与 MTU。\\n'
  else
    printf '===== 全部路由表 =====\\n'
    run_bounded_ip_section 80 ip route show table all || printf '无法读取全部路由表。\\n'
    printf '===== 策略路由规则 =====\\n'
    run_bounded_ip_section 40 ip rule || printf '无法读取策略路由规则。\\n'
    printf '===== 网卡 MTU 与链路详情 =====\\n'
    run_bounded_ip_section 80 ip -details link || printf '无法读取网卡链路详情。\\n'
  fi
)
true`)
      ]
    }),
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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
    defineCommand({
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

const fixedNetworkDiagnosticCommands = getNetworkCommands()

export const NETWORK_ERRORS_DIAGNOSTIC_COMMAND = fixedNetworkDiagnosticCommands
  .find(command => command.id === 'builtin-server-network-errors').commands[0].command
export const TCP_STATES_DIAGNOSTIC_COMMAND = fixedNetworkDiagnosticCommands
  .find(command => command.id === 'builtin-server-tcp-states').commands[0].command
export const ROUTE_MTU_DIAGNOSTIC_COMMAND = fixedNetworkDiagnosticCommands
  .find(command => command.id === 'builtin-server-route-mtu').commands[0].command
