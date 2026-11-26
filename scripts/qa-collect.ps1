# Runs the verification commands and stores REAL logs + a results table under docs/qa/.
# Usage (PowerShell, from anywhere):  .\scripts\qa-collect.ps1            # lint, typecheck, unit/API tests, build, audit
#                                      .\scripts\qa-collect.ps1 -E2E       # also Playwright (needs `npm run dev:api` and `npm run dev:web` already running)
#                                      .\scripts\qa-collect.ps1 -SkipInstall
param([switch]$SkipInstall, [switch]$E2E)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$qa = Join-Path $root 'docs/qa'; $logs = Join-Path $qa 'evidence/logs'
New-Item -ItemType Directory -Force -Path $logs, (Join-Path $qa 'evidence/screenshots') | Out-Null
$script:rows = @()

function Step([string]$name, [string]$cmd, [string]$dir) {
  if (-not $dir) { $dir = $root }
  Write-Host "==> $name : $cmd"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $dir
  $out = cmd /c "$cmd 2>&1"
  $code = $LASTEXITCODE
  Pop-Location
  $sw.Stop()
  $out | Out-File -FilePath (Join-Path $logs "$name.log") -Encoding utf8
  $hits = $out | Select-String -Pattern 'Test Files|Tests\s|found \d+ vulnerabilit|error TS|passed|failed|skipped|problems'
  $summary = (($hits | Select-Object -Last 4 | ForEach-Object { $_.Line.Trim() }) -join ' / ')
  $script:rows += [pscustomobject]@{ Name = $name; Command = $cmd; Exit = $code; Seconds = [int]$sw.Elapsed.TotalSeconds; Summary = $summary; Log = "evidence/logs/$name.log" }
}
function NotRun([string]$name, [string]$cmd, [string]$why) {
  $script:rows += [pscustomobject]@{ Name = $name; Command = $cmd; Exit = 'NOT RUN'; Seconds = 0; Summary = $why; Log = '-' }
}

if (-not $SkipInstall) { Step 'npm-ci' 'npm ci' }
Step 'lint' 'npm run lint'
Step 'typecheck' 'npm run typecheck'
Step 'unit-api-tests' 'npm test'
Step 'build' 'npm run build'
Step 'audit-prod' 'npm run audit:prod'

if ($E2E) {
  $up = $false
  try { $null = Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 5; $up = $true } catch {}
  if ($up) {
    $e2eDir = Join-Path $root 'e2e'
    Step 'e2e-install' 'npm install' $e2eDir
    Step 'e2e-browser' 'npx playwright install chromium' $e2eDir
    Step 'e2e-playwright' 'npx playwright test' $e2eDir
  } else {
    NotRun 'e2e-playwright' 'npx playwright test' 'web app not reachable on http://localhost:3000 (start npm run dev:api and npm run dev:web first)'
  }
} else {
  NotRun 'e2e-playwright' 'npx playwright test' 'run with -E2E'
}

$node = (cmd /c 'node -v 2>&1'); $os = [Environment]::OSVersion.VersionString
$md = @("# Test results (generated)", "", "Generated: $(Get-Date -Format s) | Node $node | $os", "",
  "| Step | Command | Exit | Seconds | Summary (from the log) | Log |", "|---|---|---|---|---|---|")
foreach ($r in $script:rows) { $md += "| $($r.Name) | ``$($r.Command)`` | $($r.Exit) | $($r.Seconds) | $($r.Summary) | $($r.Log) |" }
$md += ""; $md += "Exit 0 = command succeeded. Read the log files for the exact counts; nothing here is edited by hand."
$md += "Playwright HTML report (if the e2e step ran): evidence/playwright-report/index.html (open with: npx playwright show-report evidence/playwright-report)."
$md -join "`n" | Out-File -FilePath (Join-Path $qa 'TEST_RESULTS.md') -Encoding utf8
Write-Host "Done. See docs/qa/TEST_RESULTS.md"
