# setup.ps1 — Google Flow Browser MCP — Setup Automático para Windows
# Uso: .\scripts\setup.ps1
# Faz tudo: cria config, verifica Chrome, atualiza Claude Code settings.json

param(
    [string]$Email = "",
    [string]$Profile = "Default",
    [int]$CdpPort = 9222
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Google Flow Browser MCP — Setup Windows     ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Write-Host "[ 1/5 ] Verificando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "        ✓ Node.js $nodeVersion encontrado" -ForegroundColor Green
} catch {
    Write-Host "        ✗ Node.js não encontrado. Instale em https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ── 2. Dependências npm ───────────────────────────────────────────────────────
Write-Host "[ 2/5 ] Instalando dependências npm..." -ForegroundColor Yellow
Set-Location $Root
npm install --silent 2>&1 | Out-Null
Write-Host "        ✓ Dependências instaladas" -ForegroundColor Green

# ── 3. Chrome ─────────────────────────────────────────────────────────────────
Write-Host "[ 3/5 ] Localizando Chrome..." -ForegroundColor Yellow
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $null
foreach ($p in $chromePaths) {
    if (Test-Path $p) { $chromePath = $p; break }
}
if (-not $chromePath) {
    Write-Host "        ✗ Chrome não encontrado. Instale o Google Chrome." -ForegroundColor Red
    exit 1
}
Write-Host "        ✓ Chrome encontrado em: $chromePath" -ForegroundColor Green

# ── 4. Criar/atualizar flow.config.json ──────────────────────────────────────
Write-Host "[ 4/5 ] Configurando flow.config.json..." -ForegroundColor Yellow

# Pedir email se não foi passado como parâmetro
if ($Email -eq "") {
    $Email = Read-Host "        → Qual é o seu email Google (deixe vazio para preencher depois)"
}

$UserDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data Flow"
$ConfigPath = Join-Path $Root "config\flow.config.json"

$config = @{
    flowHome            = "."
    flowUrl             = "https://labs.google/fx/tools/flow"
    expectedAccount     = $Email
    chromeProfile       = $Profile
    chromeUserDataDir   = $UserDataDir
    chromePath          = $chromePath
    sessionFile         = "config/flow.session.json"
    cdpPort             = $CdpPort
    jobTimeoutMs        = 300000
    actionDelayMs       = 800
    generationPollIntervalMs = 5000
    maxPollAttempts     = 120
    downloadWaitMs      = 30000
    browserMode         = "direct-cdp"
    headless            = $false
    locale              = "en"
    imageModels = @{
        "Nano Banana Pro" = "nano-banana-pro"
        "Nano Banana 2"   = "nano-banana-2"
        "Imagen 4"        = "imagen-4"
    }
    videoModels = @{
        "Omni Flash"       = "omni-flash"
        "Veo 3.1 - Lite"   = "veo-3.1-lite"
        "Veo 3.1 - Fast"   = "veo-3.1-fast"
        "Veo 3.1 - Quality"= "veo-3.1-quality"
    }
    ratios      = @("16:9","4:3","1:1","3:4","9:16")
    videoRatios = @("9:16","16:9")
    durations   = @("4s","6s","8s","10s")
    quantities  = @(1,2,3,4)
    discoveredPages = @("main","project","characters","scenes","tools","trash")
}

$configJson = $config | ConvertTo-Json -Depth 5
$configJson | Set-Content -Path $ConfigPath -Encoding UTF8
Write-Host "        ✓ flow.config.json criado em: $ConfigPath" -ForegroundColor Green

# ── 5. Atualizar Claude Code settings.json ───────────────────────────────────
Write-Host "[ 5/5 ] Atualizando Claude Code settings.json..." -ForegroundColor Yellow

$settingsPaths = @(
    "$env:APPDATA\Claude\claude_desktop_config.json",
    "$env:USERPROFILE\.claude\settings.json",
    "$env:USERPROFILE\.config\claude\settings.json"
)

$indexPath = Join-Path $Root "src\index.js"
$mcpEntry = @{
    command = "node"
    args    = @($indexPath)
    env     = @{}
}

$settingsFound = $false
foreach ($settingsPath in $settingsPaths) {
    if (Test-Path $settingsPath) {
        $settingsFound = $true
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
        if (-not $settings.mcpServers) {
            $settings | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
        }
        $settings.mcpServers | Add-Member -NotePropertyName "google-flow-browser" -NotePropertyValue $mcpEntry -Force
        $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath -Encoding UTF8
        Write-Host "        ✓ settings.json atualizado: $settingsPath" -ForegroundColor Green
        break
    }
}

if (-not $settingsFound) {
    Write-Host "        ℹ  settings.json não encontrado automaticamente." -ForegroundColor Yellow
    Write-Host "           Adicione manualmente ao seu Claude settings.json:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host '           "mcpServers": {' -ForegroundColor Gray
    Write-Host '             "google-flow-browser": {' -ForegroundColor Gray
    Write-Host "               `"command`": `"node`"," -ForegroundColor Gray
    Write-Host "               `"args`": [`"$indexPath`"]" -ForegroundColor Gray
    Write-Host '             }' -ForegroundColor Gray
    Write-Host '           }' -ForegroundColor Gray
}

# ── Resumo ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ Setup concluído!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Próximos passos:" -ForegroundColor White
Write-Host "  1. Execute: .\scripts\start-browser.ps1    (inicia o Chrome)" -ForegroundColor White
Write-Host "  2. Reinicie o Claude Code" -ForegroundColor White
Write-Host "  3. No Claude, chame: flow_connect" -ForegroundColor White
Write-Host ""
if ($Email -eq "") {
    Write-Host "  ⚠  Lembre de preencher 'expectedAccount' no flow.config.json" -ForegroundColor Yellow
    Write-Host ""
}
