$CHROME = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$USER_DATA_DIR = "$env:LOCALAPPDATA\Google\Chrome\User Data Flow"
$PROFILE = "Default"
$CDP_PORT = 9222

if (-Not (Test-Path $CHROME)) {
    Write-Host "Chrome not found at $CHROME. Please update the script with the correct path." -ForegroundColor Red
    exit 1
}

Write-Host "Launching Chrome with profile $PROFILE on CDP port $CDP_PORT"
Start-Process -FilePath $CHROME -ArgumentList "--user-data-dir=`"$USER_DATA_DIR`"", "--profile-directory=`"$PROFILE`"", "--remote-debugging-port=$CDP_PORT", "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-features=ChromeWhatsNewUI", "--disable-background-networking", "--disable-component-update", "--disable-sync-preferences"

Write-Host "Chrome launched. Waiting for CDP..."
Start-Sleep -Seconds 3
Write-Host "Done! You can now start the MCP." -ForegroundColor Green
