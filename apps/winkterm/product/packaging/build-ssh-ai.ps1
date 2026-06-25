param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$ProductRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WinkTermRoot = Resolve-Path (Join-Path $ProductRoot "..")
$Python = Join-Path $WinkTermRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found: $Python. Create .venv under apps/winkterm and install dependencies first."
}

$env:PYTHONPATH = $WinkTermRoot.Path
$env:PYTHONIOENCODING = "utf-8"

Set-Location $WinkTermRoot

if ($Clean) {
    Remove-Item -Recurse -Force -LiteralPath "product\build" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath "product\dist" -ErrorAction SilentlyContinue
}

& $Python -m PyInstaller --noconfirm --clean "product\packaging\ssh-ai.spec" --distpath "product\dist" --workpath "product\build"
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller packaging failed with exit code: $LASTEXITCODE"
}

Write-Host "ssh-ai.exe generated: $(Join-Path $WinkTermRoot 'product\dist\ssh-ai\ssh-ai.exe')"
