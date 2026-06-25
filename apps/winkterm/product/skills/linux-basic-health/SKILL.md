---
name: linux-basic-health
description: 使用只读 SSH 命令诊断常见 Linux 服务器健康问题。
risk: safe-readonly
version: 0.1.0
---

# Linux 基础健康诊断

当用户需要排查 Linux 服务器变慢、不健康、磁盘占满、负载过高、服务失败或行为异常时，使用这个 skill。

只能执行 `checks.yaml` 中列出的检查命令。总结命令输出时必须保留证据。不要执行修复命令。如果看起来需要修复，只能提出需要用户明确批准的修复计划。

每项检查都使用 `checks.yaml` 中配置的超时时间。如果命令超时或不可用，记录该结果并继续执行剩余检查。`journalctl` 和 `systemctl` 依赖 systemd；在非 systemd 主机上，应将它们视为不可用，而不是让整个 skill 失败。
