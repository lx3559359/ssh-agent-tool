import { defineReadOnlyRunbook, readOnlyStep } from './helpers.js'

export const compatibilityRunbooks = Object.freeze([
  defineReadOnlyRunbook({
    id: 'runbook.compatibility.domestic-linux',
    title: '国产 Linux 兼容性与基础环境报告',
    description: '识别麒麟、统信、openEuler、Anolis、Alibaba Cloud Linux、OpenCloudOS 等系统和基础能力。',
    category: '兼容性',
    steps: [
      readOnlyStep(
        'distribution',
        '识别发行版与内核',
        'test -r /etc/os-release && cat /etc/os-release || true; uname -a; uname -m; getconf LONG_BIT 2>/dev/null || true'
      ),
      readOnlyStep(
        'init',
        '识别初始化与服务系统',
        'ps -p 1 -o pid,comm,args; command -v systemctl >/dev/null 2>&1 && systemctl --version | head -n 3 || true; command -v service >/dev/null 2>&1 && service --status-all 2>&1 | head -n 30 || true'
      ),
      readOnlyStep(
        'packages',
        '识别软件包管理器',
        'for tool in apt apt-get dnf yum zypper rpm dpkg; do if command -v "$tool" >/dev/null 2>&1; then printf "## %s\\n" "$tool"; "$tool" --version 2>&1 | head -n 3; fi; done'
      ),
      readOnlyStep(
        'runtime',
        '检查常用运行环境',
        'for tool in bash python3 python node java docker podman nginx; do if command -v "$tool" >/dev/null 2>&1; then printf "%s=%s\\n" "$tool" "$(command -v "$tool")"; "$tool" --version 2>&1 | head -n 2; else printf "%s=未安装\\n" "$tool"; fi; done'
      ),
      readOnlyStep(
        'locale-security',
        '检查语言、时间与安全模块',
        'locale 2>/dev/null || true; timedatectl 2>/dev/null || date; getenforce 2>/dev/null || true; aa-status 2>/dev/null | head -n 40 || true'
      )
    ]
  })
])
