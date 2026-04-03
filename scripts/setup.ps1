Write-Host "[JARVIS] Setup starting..." -ForegroundColor Cyan

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
}

Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\pip install -r backend\requirements.txt

Write-Host "Installing Node dependencies..." -ForegroundColor Yellow
npm install

Write-Host "[JARVIS] Setup complete." -ForegroundColor Green
