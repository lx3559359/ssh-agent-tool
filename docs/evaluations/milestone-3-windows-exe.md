# Milestone 3 Windows EXE 打包评估记录

日期：2026-06-25

## 已实现项

- CLI 运行时支持源码模式和 PyInstaller bundled 模式的数据文件定位。
- 默认报告目录切换为用户数据目录，Windows 下默认为 `%LOCALAPPDATA%\SSHAgentTool\reports`。
- CLI 启动时尝试将 stdout/stderr 配置为 UTF-8。
- 新增 PyInstaller entry script、spec 文件和 PowerShell build script。
- `skills/` 和 `policy/` 数据文件随 `ssh-ai.exe` 打包。
- 已生成 Windows 预览可执行文件。
- `ssh-ai.exe` 已改为单文件打包，并支持无参数双击进入中文预览向导。

## 构建信息

- PyInstaller 版本：6.21.0
- EXE 路径：`apps/winkterm/product/dist/ssh-ai.exe`
- EXE 大小：8,160,667 bytes

## 测试结果

命令：

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

结果：

```text
46 passed in 0.27s
```

## EXE Smoke 结果

### 项目内 smoke

命令：

```powershell
Set-Location apps/winkterm
.\product\dist\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product/package-smoke-reports
```

结果：

```text
returncode=0
status=completed
completed=7
report_path=product\package-smoke-reports\diagnosis-bbd606a831e7437d8f0e0975333fc869.md
report_exists=True
```

### 项目外 smoke

命令：

```powershell
Set-Location $env:TEMP
& "<worktree>\apps\winkterm\product\dist\ssh-ai.exe" diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir "$env:TEMP\ssh-ai-package-smoke-reports"
```

结果：

```text
returncode=0
status=completed
completed=7
report_path=C:\Users\LUOJIX~1\AppData\Local\Temp\ssh-ai-package-smoke-reports\diagnosis-3e968d45491141c48f469f822535ddae.md
report_exists=True
```

## 清理状态

- 已删除 `apps/winkterm/product/package-smoke-reports`。
- 已删除 `%TEMP%\ssh-ai-package-smoke-reports`。
- `product/dist` 和 `product/build` 保留为本地构建产物，不提交到 git。

## 剩余工作

- 用真实 Linux 测试主机跑 Agent API smoke。
- 实现 host/title 到 WinkTerm connection-id 的自动解析。
- 将 `ssh-ai.exe` 集成到最终桌面应用菜单或安装包。
- 评估是否需要代码签名。
