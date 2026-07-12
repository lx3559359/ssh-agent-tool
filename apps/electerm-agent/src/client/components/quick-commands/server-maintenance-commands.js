const COMMON_DELAY = 100

function step (command, delay = COMMON_DELAY) {
  return {
    command,
    delay
  }
}

export function getServerMaintenanceQuickCommands () {
  return [
    {
      id: 'builtin-server-overview',
      name: '系统概览',
      labels: ['内置', '服务器维护'],
      inputOnly: false,
      commands: [
        step('uptime'),
        step('hostnamectl 2>/dev/null || uname -a'),
        step('who -u')
      ]
    },
    {
      id: 'builtin-server-disk',
      name: '磁盘排查',
      labels: ['内置', '服务器维护', '磁盘'],
      inputOnly: false,
      commands: [
        step('df -hT'),
        step('du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -n 20')
      ]
    },
    {
      id: 'builtin-server-memory',
      name: '内存排查',
      labels: ['内置', '服务器维护', '内存'],
      inputOnly: false,
      commands: [
        step('free -h'),
        step('ps aux --sort=-%mem | head -n 15')
      ]
    },
    {
      id: 'builtin-server-network-listen',
      name: '网络监听',
      labels: ['内置', '服务器维护', '网络'],
      inputOnly: false,
      commands: [
        step('ss -tunlp'),
        step('ip route'),
        step('ip addr show')
      ]
    },
    {
      id: 'builtin-server-service-logs',
      name: '服务日志',
      labels: ['内置', '服务器维护', '日志'],
      inputOnly: false,
      commands: [
        step('systemctl --failed --no-pager'),
        step('journalctl -p warning -n 120 --no-pager')
      ]
    },
    {
      id: 'builtin-server-nginx',
      name: 'Nginx 排查',
      labels: ['内置', '服务器维护', 'Nginx'],
      inputOnly: false,
      commands: [
        step('nginx -t'),
        step('systemctl status nginx --no-pager'),
        step('tail -n 120 /var/log/nginx/error.log')
      ]
    },
    {
      id: 'builtin-server-docker',
      name: 'Docker 排查',
      labels: ['内置', '服务器维护', 'Docker'],
      inputOnly: false,
      commands: [
        step('docker ps -a'),
        step('docker stats --no-stream'),
        step('docker images')
      ]
    },
    {
      id: 'builtin-server-packet-capture',
      name: '抓包采样',
      labels: ['内置', '服务器维护', '抓包'],
      inputOnly: true,
      confirmRequired: true,
      commands: [
        step('tcpdump -nn -i any -c 100'),
        step('tcpdump -nn -i any port 80 -c 100'),
        step('tcpdump -nn -i any port 443 -c 100')
      ]
    }
  ]
}
