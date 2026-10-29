Set-Location -LiteralPath $PSScriptRoot
$projectPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $projectPython)) {
    Write-Host 'Please follow README.md to create the Python environment first.'
    exit 1
}
Write-Host 'CareVoice is starting. Open http://127.0.0.1:5000 in Chrome.'
& $projectPython app.py
