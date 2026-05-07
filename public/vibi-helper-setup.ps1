# viBI Helper - Setup
#
# Was passiert:
# 1. Pruefen, ob Node.js >= 20 vorhanden ist
# 2. Repo nach $env:USERPROFILE\.vibi-helper klonen (oder pullen)
# 3. helper/ bauen und auf Port 7321 starten
#
# Aufruf:
#   - Per Browser-Download: Rechtsklick auf die Datei -> "Mit PowerShell ausfuehren"
#   - Oder im Terminal: powershell -ExecutionPolicy Bypass -File .\vibi-helper-setup.ps1

$ErrorActionPreference = "Stop"

$REPO   = "https://github.com/christof999/vibi.git"
$ROOT   = Join-Path $env:USERPROFILE ".vibi-helper"
$PORT   = 7321

Write-Host ""
Write-Host "viBI Helper Setup" -ForegroundColor Yellow
Write-Host "-----------------"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js wurde nicht gefunden." -ForegroundColor Red
    Write-Host "Bitte installiere Node.js >= 20 von https://nodejs.org/ und starte dieses Skript erneut."
    Read-Host "Enter zum Beenden"
    exit 1
}

$nodeVersion = (& node -v).TrimStart("v")
Write-Host ("Node.js gefunden: v{0}" -f $nodeVersion)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git wurde nicht gefunden." -ForegroundColor Red
    Write-Host "Bitte installiere Git von https://git-scm.com/ und starte dieses Skript erneut."
    Read-Host "Enter zum Beenden"
    exit 1
}

if (-not (Test-Path $ROOT)) {
    Write-Host ("Klone Repo nach {0} ..." -f $ROOT)
    git clone $REPO $ROOT
} else {
    Write-Host ("Aktualisiere bestehendes Repo unter {0} ..." -f $ROOT)
    Push-Location $ROOT
    try { git pull --ff-only } catch { Write-Host "git pull fehlgeschlagen, fahre fort." -ForegroundColor Yellow }
    Pop-Location
}

$helperDir = Join-Path $ROOT "helper"
Push-Location $helperDir
try {
    Write-Host "Installiere Abhaengigkeiten ..."
    npm install --no-audit --no-fund

    Write-Host "Baue Helper ..."
    npm run build

    Write-Host ""
    Write-Host ("Starte Helper auf http://localhost:{0}" -f $PORT) -ForegroundColor Green
    Write-Host "Du kannst dieses Fenster offen lassen, solange du mit viBI arbeitest."
    Write-Host "Beenden mit Strg+C."
    Write-Host ""

    $env:PORT = $PORT
    & node "dist/index.js"
} finally {
    Pop-Location
}
