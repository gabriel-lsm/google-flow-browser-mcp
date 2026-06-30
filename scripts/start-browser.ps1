# start-browser.ps1 — Inicia o Chrome com CDP para o Google Flow MCP
# Uso: .\scripts\start-browser.ps1
# Se o Chrome já estiver rodando com CDP na porta 9222, não faz nada.

$Root       = Split-Path $PSScriptRoot -Parent
$ConfigPath = Join-Path $Root "config\flow.config.json"

# ── Ler config ────────────────────────────────────────────────────────────────
if (Test-Path $ConfigPath) {
    $cfg         = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $ChromePath  = $cfg.chromePath
    $UserDataDir = $cfg.chromeUserDataDir
    $Profile     = if ($cfg.chromeProfile) { $cfg.chromeProfile } else { "Default" }
    $CdpPort     = if ($cfg.cdpPort)       { $cfg.cdpPort       } else { 9222 }
} else {
    Write-Host "flow.config.json não encontrado. Execute .\scripts\setup.ps1 primeiro." -ForegroundColor Red
    exit 1
}

# ── Fallback de caminho do Chrome ─────────────────────────────────────────────
if (-not $ChromePath -or -not (Test-Path $ChromePath)) {
    $candidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $ChromePath = $c; break }
    }
}

if (-not (Test-Path $ChromePath)) {
    Write-Host "Chrome não encontrado. Instale o Google Chrome." -ForegroundColor Red
    exit 1
}

# ── Verificar se CDP já está ativo ────────────────────────────────────────────
$cdpUrl = "http://127.0.0.1:$CdpPort/json/version"
try {
    $response = Invoke-RestMethod -Uri $cdpUrl -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✓ Chrome com CDP já está rodando na porta $CdpPort" -ForegroundColor Green
    Write-Host "  Browser: $($response.Browser)" -ForegroundColor Gray
    Write-Host "  Pode chamar flow_connect no Claude Code." -ForegroundColor Gray
    exit 0
} catch {
    # CDP não está ativo, continua para iniciar o Chrome
}

# ── Garantir que a pasta de perfil existe ─────────────────────────────────────
if (-not (Test-Path $UserDataDir)) {
    New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
    Write-Host "  Pasta de perfil criada: $UserDataDir" -ForegroundColor Gray
}

# ── Iniciar Chrome ────────────────────────────────────────────────────────────
Write-Host "Iniciando Chrome com CDP na porta $CdpPort..." -ForegroundColor Yellow
Write-Host "  Perfil : $Profile" -ForegroundColor Gray
Write-Host "  DataDir: $UserDataDir" -ForegroundColor Gray

$chromeArgs = @(
    "--user-data-dir=`"$UserDataDir`""
    "--profile-directory=`"$Profile`""
    "--remote-debugging-port=$CdpPort"
    "--remote-debugging-address=127.0.0.1"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-blink-features=AutomationControlled"
)

Start-Process -FilePath $ChromePath -ArgumentList $chromeArgs

# ── Aguardar CDP ficar disponível (até 15s) ───────────────────────────────────
Write-Host "Aguardando Chrome inicializar..." -ForegroundColor Yellow
$attempts = 0
$ready    = $false
while ($attempts -lt 15) {
    Start-Sleep -Seconds 1
    $attempts++
    try {
        $r = Invoke-RestMethod -Uri $cdpUrl -TimeoutSec 1 -ErrorAction Stop
        $ready = $true
        break
    } catch { }
}

if ($ready) {
    Write-Host ""
    Write-Host "✅ Chrome pronto!" -ForegroundColor Green
    Write-Host "   CDP ativo em: http://127.0.0.1:$CdpPort" -ForegroundColor Gray
    Write-Host "   Agora chame flow_connect no Claude Code." -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "⚠  Chrome iniciou mas CDP não respondeu em 15s." -ForegroundColor Yellow
    Write-Host "   Tente abrir manualmente: $ChromePath" -ForegroundColor Gray
    Write-Host "   E verifique se a porta $CdpPort está disponível." -ForegroundColor Gray
}
