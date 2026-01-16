# Install git hooks for BurnedChats project (Windows PowerShell)
# Run this script after cloning the repository

$ErrorActionPreference = "Stop"

Write-Host "Installing git hooks..." -ForegroundColor Yellow

# Get the root directory of the repository
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# Git hooks directory
$GitHooksDir = Join-Path $RepoRoot ".git\hooks"
$SourceHooksDir = Join-Path $RepoRoot "scripts\git-hooks"

# Check if we're in a git repository
if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    Write-Host "Error: Not a git repository" -ForegroundColor Red
    Write-Host "Please run this script from within the BurnedChats repository"
    exit 1
}

# Create hooks directory if it doesn't exist
if (-not (Test-Path $GitHooksDir)) {
    New-Item -ItemType Directory -Path $GitHooksDir -Force | Out-Null
}

# Install hooks
$Hooks = @("pre-commit", "commit-msg")

foreach ($hook in $Hooks) {
    $Source = Join-Path $SourceHooksDir $hook
    $Target = Join-Path $GitHooksDir $hook

    if (Test-Path $Source) {
        # Copy hook
        Copy-Item -Path $Source -Destination $Target -Force
        Write-Host "✓ Installed $hook hook" -ForegroundColor Green
    } else {
        Write-Host "⚠ Hook not found: $Source" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "Git hooks installed successfully!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Hooks will run automatically on:"
Write-Host "  - pre-commit: Code quality checks"
Write-Host "  - commit-msg: Commit message validation"
Write-Host ""
Write-Host "To skip hooks temporarily, use: git commit --no-verify"


