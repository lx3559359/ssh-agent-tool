[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [ValidateNotNullOrEmpty()]
  [string[]]$Paths
)

$securityModulePath = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModulePath -Force -ErrorAction Stop

$results = foreach ($targetPath in $Paths) {
  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "Authenticode target does not exist: $targetPath"
  }

  $resolvedPath = (Resolve-Path -LiteralPath $targetPath).Path
  $signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
  [PSCustomObject]@{
    Path = $resolvedPath
    Status = [string]$signature.Status
    Signer = if ($signature.SignerCertificate) {
      $signature.SignerCertificate.Subject
    } else {
      ''
    }
  }
}

$results | Format-Table -AutoSize | Out-String | Write-Host
$invalid = @($results | Where-Object { $_.Status -ne 'Valid' })
if ($invalid.Count -gt 0) {
  throw "Authenticode verification failed for $($invalid.Count) file(s)."
}
