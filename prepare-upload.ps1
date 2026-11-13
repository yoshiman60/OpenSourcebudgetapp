# Copies ONLY the files the app needs into a separate "budgetapp-upload" folder.
# Upload that folder to your host, never the whole budgetapp folder,
# so notes, test files or backups can't end up online by accident.
#
# Run from the budgetapp folder:  powershell -ExecutionPolicy Bypass -File .\prepare-upload.ps1

$appFiles = @(
  'index.html', 'style.css', 'manifest.json', 'sw.js', '_headers',
  'app.js', 'lock.js', 'savings.js', 'forecast.js', 'tips.js', 'bank.js', 'backups.js',
  'icon-192.png', 'icon-512.png'
)

$source = $PSScriptRoot
$target = Join-Path (Split-Path $source -Parent) 'budgetapp-upload'

# Start clean so old files never linger
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null

foreach ($file in $appFiles) {
  Copy-Item (Join-Path $source $file) $target
}

# Safety check: nothing that looks like your data should be in there
$risky = Get-ChildItem $target -Recurse | Where-Object { $_.Extension -in '.json', '.csv', '.pdf', '.md' -and $_.Name -ne 'manifest.json' }
if ($risky) {
  Write-Warning "Unexpected files in the upload folder: $($risky.Name -join ', ')"
} else {
  Write-Host "Ready to upload: $target ($($appFiles.Count) files)"
}
