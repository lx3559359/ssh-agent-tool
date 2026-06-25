# ssh-ai Windows 打包说明

## 目标

将 `product.cli.ssh_ai` 打包为 Windows 控制台程序 `ssh-ai.exe`，用于预览中文 SSH Agent 诊断 CLI。

## 前置条件

在 `apps/winkterm` 下准备 Python 虚拟环境，并安装 PyInstaller：

```powershell
Set-Location apps/winkterm
.\.venv\Scripts\python.exe -m pip install PyInstaller
```

## 构建命令

```powershell
Set-Location apps/winkterm
.\product\packaging\build-ssh-ai.ps1 -Clean
```

如果 PowerShell 执行策略拦截脚本，可以使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\product\packaging\build-ssh-ai.ps1 -Clean
```

## 输出位置

构建完成后，可执行文件位于：

```text
apps/winkterm/product/dist/ssh-ai.exe
```

`product/dist` 和 `product/build` 是本地构建产物，不提交到 git。

## Fake 模式预览

```powershell
Set-Location apps/winkterm
$env:PYTHONIOENCODING = "utf-8"
.\product\dist\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product\preview-reports
```

- 这是单文件 exe 预览版，不需要目标机器安装 Python。
- 直接双击 `ssh-ai.exe` 会进入中文预览向导，并在结束时停留窗口等待回车。
- `--fake` 不连接真实服务器，只用于验证 CLI、JSON 输出和 Markdown 报告生成。

## 真实模式

真实诊断需要传入 WinkTerm Agent API 的 token 和 connection id：

```powershell
.\product\dist\ssh-ai.exe diagnose prod-1 --profile linux-basic --token <token> --connection-id <connection-id>
```

如果不指定 `--reports-dir`，默认报告目录为：

```text
%LOCALAPPDATA%\SSHAgentTool\reports
```
