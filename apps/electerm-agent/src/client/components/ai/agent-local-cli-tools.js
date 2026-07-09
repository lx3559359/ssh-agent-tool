export const allowedLocalCliTools = [
  'ssh-keygen',
  'ssh',
  'scp',
  'ping',
  'traceroute',
  'tracert',
  'nslookup',
  'curl',
  'ipconfig',
  'where',
  'kubectl',
  'docker',
  'git',
  'codex'
]

export function buildAgentLocalCliPrompt () {
  return `本机 CLI 工具：
- 可以在用户确认后调用 run_local_cli 执行受控本机 CLI。
- 允许的工具：${allowedLocalCliTools.join(', ')}。
- 只在确实需要本机能力时使用，例如生成 SSH key、测试网络连通性、查看 kubectl/docker/git 状态或辅助 scp 传输。
- Codex CLI：可以先用 get_codex_cli_status 检查是否安装并可执行；如果用户已在官方 Codex CLI 登录，AIGShell 只通过 codex 命令复用官方登录态，不读取或保存账号凭据。
- 不要尝试执行未列入白名单的工具。
- 命令执行前必须等待用户确认；涉及删除、覆盖、重启、停止服务、修改集群或修改仓库历史等风险操作时，必须先解释影响并让用户二次确认。`
}

export function buildLocalCliContextPrompt () {
  return `请结合需要，使用可控本机 CLI 能力辅助排查。

可用工具：${allowedLocalCliTools.join(', ')}

Codex CLI 接入：
- 可先检查 Codex CLI 状态，再决定是否建议用户使用。
- AIGShell 不读取 Codex 账号凭据，只通过官方 CLI 登录态调用 codex。
- 如需执行 codex 命令，必须先说明目的并等待用户确认。

使用规则：
1. 先说明为什么需要调用本机 CLI。
2. 生成具体命令前先给出预期目的。
3. 真正执行必须经过用户确认。
4. 危险操作不要直接执行，先给出风险说明和替代方案。`
}
