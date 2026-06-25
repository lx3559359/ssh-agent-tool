# Milestone 2 诊断闭环实现状态

日期：2026-06-25

## 已实现

- YAML loader：加载诊断 skill 与命令策略 YAML，并对结构、必填字段和非法 YAML 给出错误。
- policy evaluator：按 `risk_rules.yaml` 只允许白名单只读命令，阻断变更类命令族。
- plan renderer：渲染用户审批前可读的诊断计划，包含检查项、精确命令、原因和超时。
- FakeExecutor：提供离线 fake 模式，支持 product 测试和 CLI 预览。
- Agent API executor：通过 WinkTerm Agent API 执行真实 SSH 命令，保留超时和执行失败语义。
- session orchestrator：串联计划、执行、结果计数、摘要和报告写入。
- Markdown report renderer：生成中文 Markdown 诊断报告。
- 中文 `ssh-ai diagnose` CLI：支持 `--fake`、`--yes`、`--json`、`--reports-dir` 等参数，用户可见文本中文优先。

## 验证

工作目录：

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
```

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

结果：

```text
...................................                                      [100%]
35 passed in 0.22s
```

命令：

```powershell
.\.venv\Scripts\python.exe -m product.cli.ssh_ai diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product/test-reports
```

结果关键内容：

```text
诊断计划：prod-1
配置：linux-basic-health
检查：
- uptime
  命令：uptime
  原因：查看系统运行时长和负载情况
  超时：10s
- disk
  命令：df -hT
  原因：查看磁盘空间压力和文件系统类型
  超时：10s
- memory
  命令：free -h
  原因：查看内存和交换分区压力
  超时：10s
- top_cpu
  命令：ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16
  原因：查看 CPU 占用最高的进程且不暴露完整启动参数
  超时：10s
- journal_errors
  命令：journalctl -p err -n 80 --no-pager
  原因：查看最近的系统错误日志
  超时：10s
- failed_services
  命令：systemctl --failed --no-pager
  原因：查看失败的 systemd 服务单元
  超时：10s
- listening_ports
  命令：ss -tulpn | head -n 80
  原因：查看受限数量的 TCP 和 UDP 监听服务
  超时：10s
{"status": "completed", "exit_code": 0, "host": "prod-1", "profile": "linux-basic-health", "report_path": "product\\test-reports\\diagnosis-7c35e88cb2da4ffcb145df802c908fef.md", "summary": "7 项检查完成，0 项失败，0 项超时", "counts": {"completed": 7, "skipped": 0, "failed": 0, "timed_out": 0}, "error": null}
```

确认项：

- JSON `status` 为 `completed`。
- JSON `counts.completed` 为 `7`。
- 报告文件已生成：`product/test-reports/diagnosis-7c35e88cb2da4ffcb145df802c908fef.md`。
- 验证完成后已清理 `product/test-reports` 临时目录。

说明：本地 PowerShell 启动时输出了 profile 执行策略 warning，但两个验证命令退出码均为 0，不影响产品验证结论。

## 预览

Windows PowerShell fake 模式预览命令：

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m product.cli.ssh_ai diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product/preview-reports
```

注意：

- 需要设置 `PYTHONPATH`，让 Python 能从 `apps/winkterm` 载入 `product` 包。
- 需要设置 `PYTHONIOENCODING=utf-8`，确保 Windows 控制台和 JSON/中文输出按 UTF-8 处理。
- 这仍是 Python CLI 预览，不是 Windows `.exe` 交付物。

## 剩余工作

- 真实 SSH smoke。
- host/title 到 connection-id 自动解析。
- Windows exe 打包。
- UI approval surface。
- Docker virtualization 后重跑 Docker 相关验证。
