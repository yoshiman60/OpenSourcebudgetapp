# Quick checks to run before every commit:
#   powershell -ExecutionPolicy Bypass -File .\check.ps1
# It stops with a red message if something is wrong.

$ok = $true
Set-Location $PSScriptRoot

# 1. Every JavaScript file must have valid syntax
foreach ($file in Get-ChildItem *.js) {
  node --check $file.FullName
  if (-not $?) { Write-Host "Syntax error in $($file.Name)" -ForegroundColor Red; $ok = $false }
}

# 2. Every script the page loads must exist, and every app file must be loaded
$html = Get-Content index.html -Raw
$loaded = [regex]::Matches($html, '<script src="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
foreach ($src in $loaded) {
  if (-not (Test-Path $src)) { Write-Host "index.html loads $src but it doesn't exist" -ForegroundColor Red; $ok = $false }
}
foreach ($file in Get-ChildItem *.js -Exclude sw.js) {
  if ($loaded -notcontains $file.Name) { Write-Host "$($file.Name) isn't loaded by index.html" -ForegroundColor Red; $ok = $false }
}

# 3. The offline cache (sw.js) must list every app file
$sw = Get-Content sw.js -Raw
foreach ($file in @('index.html', 'style.css') + $loaded) {
  if ($sw -notmatch [regex]::Escape("'$file'")) { Write-Host "sw.js doesn't cache $file" -ForegroundColor Red; $ok = $false }
}

# 4. No duplicate ids in index.html
$ids = [regex]::Matches($html, '\sid="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$dupes = $ids | Group-Object | Where-Object Count -gt 1
foreach ($d in $dupes) { Write-Host "Duplicate id in index.html: $($d.Name)" -ForegroundColor Red; $ok = $false }

# 5. No personal data files in the folder git would pick up
$risky = Get-ChildItem -Recurse -File | Where-Object {
  $_.Extension -in '.csv', '.pdf', '.ofx', '.qfx' -or ($_.Extension -eq '.json' -and $_.Name -ne 'manifest.json')
} | Where-Object { $_.FullName -notmatch '\\\.git\\' }
foreach ($r in $risky) { Write-Host "Data file in the app folder (ignored by git, but move it out): $($r.Name)" -ForegroundColor Yellow }

if ($ok) {
  Write-Host "All checks passed. Also open the app and check the browser console before pushing." -ForegroundColor Green
} else {
  Write-Host "Fix the problems above before committing." -ForegroundColor Red
  exit 1
}
