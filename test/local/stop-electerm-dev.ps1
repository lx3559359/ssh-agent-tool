param(
  [switch]$KeepVite,

  [int]$VitePort = 5570
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$appPath = Join-Path $repoRoot 'apps\electerm-agent'
$logDir = Join-Path $repoRoot '.artifacts\local-dev'

$stopped = New-Object System.Collections.Generic.List[object]

function Stop-MatchingProcesses {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Predicate,
    [Parameter(Mandatory = $true)][string]$Reason
  )

  Get-CimInstance Win32_Process |
    Where-Object $Predicate |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $script:stopped.Add([pscustomobject]@{
          processId = $_.ProcessId
          name = $_.Name
          reason = $Reason
          commandLine = $_.CommandLine
        })
      }
      catch {
        $script:stopped.Add([pscustomobject]@{
          processId = $_.ProcessId
          name = $_.Name
          reason = "$Reason stop failed: $($_.Exception.Message)"
          commandLine = $_.CommandLine
        })
      }
    }
}

Stop-MatchingProcesses -Reason 'Electerm dev Electron' -Predicate {
  $_.Name -eq 'electron.exe' -and $_.ExecutablePath -like "$appPath*"
}

Stop-MatchingProcesses -Reason 'Electerm dev launcher' -Predicate {
  $_.Name -like 'powershell*.exe' -and
  $_.CommandLine -and
  ($_.CommandLine -like "*$logDir\electron.log*" -or (-not $KeepVite -and $_.CommandLine -like "*$logDir\vite.log*"))
}

if (-not $KeepVite) {
  Get-NetTCPConnection -LocalPort $VitePort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
      if ($process) {
        try {
          Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
          $stopped.Add([pscustomobject]@{
            processId = $process.ProcessId
            name = $process.Name
            reason = "Vite port $VitePort owner"
            commandLine = $process.CommandLine
          })
        }
        catch {
          $stopped.Add([pscustomobject]@{
            processId = $process.ProcessId
            name = $process.Name
            reason = "Vite port $VitePort owner stop failed: $($_.Exception.Message)"
            commandLine = $process.CommandLine
          })
        }
      }
    }

  Stop-MatchingProcesses -Reason 'Electerm Vite dev server' -Predicate {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -and
    $_.CommandLine -like '*dev-server.js*' -and
    $_.CommandLine -like "*$appPath*"
  }
}

[pscustomobject]@{
  status = 'stopped'
  repoRoot = $repoRoot
  appPath = $appPath
  keepVite = [bool]$KeepVite
  stopped = $stopped
} | ConvertTo-Json -Depth 5
