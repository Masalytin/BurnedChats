# Setup SSL certificates for local development using mkcert
# This script must be run as Administrator for the first time (to install root CA)

param(
    [switch]$InstallCA,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$CERTS_DIR = Join-Path $PSScriptRoot "..\certs"
$DOMAIN = "localhost"
$ADDITIONAL_DOMAINS = "127.0.0.1", "::1", "burnedchats.local"

function Show-Help {
    Write-Host @"
SSL Certificate Setup Script for BurnedChats (Windows)

Usage:
    .\setup-ssl.ps1              Generate certificates (requires mkcert installed)
    .\setup-ssl.ps1 -InstallCA   Install root CA and generate certificates (run as Admin)
    .\setup-ssl.ps1 -Help        Show this help message

Prerequisites:
    1. Install mkcert:
       - Using Chocolatey: choco install mkcert
       - Using Scoop: scoop bucket add extras && scoop install mkcert
       - Or download from: https://github.com/FiloSottile/mkcert/releases

    2. Run with -InstallCA flag once (as Administrator) to trust certificates

After setup:
    - Certificates will be in ./certs directory
    - Run 'docker-compose -f docker-compose.ssl.yml up' to start with HTTPS
    - Access app at https://localhost:3000
"@
}

function Check-MkcertInstalled {
    try {
        $null = Get-Command mkcert -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Install-RootCA {
    Write-Host "Installing mkcert root CA..." -ForegroundColor Cyan
    Write-Host "This requires Administrator privileges." -ForegroundColor Yellow
    
    mkcert -install
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Root CA installed successfully!" -ForegroundColor Green
    } else {
        Write-Host "Failed to install root CA. Please run as Administrator." -ForegroundColor Red
        exit 1
    }
}

function Generate-Certificates {
    Write-Host "Generating SSL certificates..." -ForegroundColor Cyan
    
    # Create certs directory
    if (-not (Test-Path $CERTS_DIR)) {
        New-Item -ItemType Directory -Path $CERTS_DIR -Force | Out-Null
        Write-Host "Created directory: $CERTS_DIR" -ForegroundColor Gray
    }
    
    # Generate certificates
    Push-Location $CERTS_DIR
    try {
        $allDomains = @($DOMAIN) + $ADDITIONAL_DOMAINS
        mkcert -cert-file cert.pem -key-file key.pem $allDomains
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "Certificates generated successfully!" -ForegroundColor Green
            Write-Host "  - Certificate: $CERTS_DIR\cert.pem" -ForegroundColor Gray
            Write-Host "  - Private key: $CERTS_DIR\key.pem" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Domains covered:" -ForegroundColor Cyan
            foreach ($d in $allDomains) {
                Write-Host "  - $d" -ForegroundColor Gray
            }
        } else {
            Write-Host "Failed to generate certificates." -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
}

function Create-GitIgnore {
    $gitignorePath = Join-Path $CERTS_DIR ".gitignore"
    if (-not (Test-Path $gitignorePath)) {
        Set-Content -Path $gitignorePath -Value @"
# Ignore all certificate files
*.pem
*.crt
*.key
"@
        Write-Host "Created .gitignore in certs directory" -ForegroundColor Gray
    }
}

# Main
if ($Help) {
    Show-Help
    exit 0
}

Write-Host ""
Write-Host "=== BurnedChats SSL Setup ===" -ForegroundColor Magenta
Write-Host ""

if (-not (Check-MkcertInstalled)) {
    Write-Host "Error: mkcert is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install mkcert first:" -ForegroundColor Yellow
    Write-Host "  - Using Chocolatey: choco install mkcert" -ForegroundColor Gray
    Write-Host "  - Using Scoop: scoop bucket add extras && scoop install mkcert" -ForegroundColor Gray
    Write-Host "  - Manual: https://github.com/FiloSottile/mkcert/releases" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host "mkcert found: $(Get-Command mkcert | Select-Object -ExpandProperty Source)" -ForegroundColor Gray

if ($InstallCA) {
    Install-RootCA
}

Generate-Certificates
Create-GitIgnore

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Magenta
Write-Host "1. Start with SSL: docker-compose -f docker-compose.ssl.yml up --build" -ForegroundColor Cyan
Write-Host "2. Open: https://localhost:3000" -ForegroundColor Cyan
Write-Host ""
