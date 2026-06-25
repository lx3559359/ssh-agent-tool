# Windows Prerequisites

Date: 2026-06-25

## Required Versions

| Tool | Minimum | Purpose |
|---|---:|---|
| Git | 2.40 | clone and branch management |
| Node.js | 20 | WinkTerm frontend and npm CLI |
| npm | bundled with Node.js 20 | WinkTerm frontend dependencies |
| Python | 3.12 | WinkTerm FastAPI backend |
| Docker Desktop | current stable | WinkTerm Docker Compose validation |
| Docker Compose | v2 | Compose validation |
| Visual Studio Build Tools | current stable | native Node/Python packages if required |

## Install Commands

Prefer official installers when `winget` is unavailable. Run PowerShell as a normal user unless an installer asks for elevation.

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Docker.DockerDesktop -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"
```

Restart PowerShell after installation so PATH updates are visible.

## Verification Commands

```powershell
git --version
node --version
npm --version
python --version
docker --version
docker compose version
```

## Measured Results

### Initial State Before Install

Commands were run from PowerShell on 2026-06-25.

| Command | Status | Output |
|---|---|---|
| `git --version` | PRESENT | `git version 2.54.0.windows.1` |
| `node --version` | MISSING | PowerShell reported `node` was not recognized. |
| `npm --version` | MISSING | PowerShell reported `npm` was not recognized. |
| `python --version` | MISSING | No output; exit code `9009`. |
| `docker --version` | MISSING | PowerShell reported `docker` was not recognized. |
| `docker compose version` | MISSING | PowerShell reported `docker` was not recognized. |
| `winget --version` | PRESENT | `v1.28.240` |

### Install Attempts

| Command | Status | Output Summary |
|---|---|---|
| `winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements` | PASS | Downloaded Node.js LTS `24.18.0`; winget reported successful installation. |
| `winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements` | PASS | Downloaded Python `3.12.10`; winget reported successful installation. |
| `winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements` | PASS | Downloaded Docker Desktop `4.78.0`; winget reported successful installation. |

Git was already present, so Git installation was skipped. Visual Studio Build Tools were not installed because no native package build required them during Task 1.

### PATH Refresh

The current shell PATH was refreshed from Machine/User environment values:

```powershell
$machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$env:Path = @($machinePath, $userPath) -join ';'
```

### Post-Install Verification

| Command | Status | Output |
|---|---|---|
| `git --version` | PASS | `git version 2.54.0.windows.1` |
| `node --version` | PASS | `v24.18.0` |
| `npm --version` | BLOCKED | PowerShell resolves `npm` to `C:\Program Files\nodejs\npm.ps1`; script execution policy blocks it. |
| `npm.cmd --version` | PASS | `11.16.0` |
| `cmd /c npm --version` | PASS | `11.16.0` |
| `python --version` | PASS | `Python 3.12.10` |
| `docker --version` | PASS | `Docker version 29.5.3, build d1c06ef` |
| `docker compose version` | PASS | `Docker Compose version v5.1.4` |
| `winget --version` | PASS | `v1.28.240` |

## Blockers

No installer was blocked by UAC, interactive confirmation, or winget failure.

Task 2 has one local PowerShell concern: literal `npm install` may fail for the same reason `npm --version` failed, because `npm.ps1` is blocked by the current script execution policy. `npm.cmd` works and reports version `11.16.0`; alternatively, PowerShell execution policy can be adjusted outside this repository before running literal `npm` commands.
