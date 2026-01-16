# SSL Certificates

This directory contains SSL certificates for local development.

## Setup

### Windows (PowerShell as Administrator)

```powershell
# Install mkcert (using Chocolatey)
choco install mkcert

# Or using Scoop
scoop bucket add extras
scoop install mkcert

# Generate certificates (run from project root)
.\scripts\setup-ssl.ps1 -InstallCA
```

### macOS

```bash
# Install mkcert
brew install mkcert

# Generate certificates (run from project root)
./scripts/setup-ssl.sh --install-ca
```

### Linux (Debian/Ubuntu)

```bash
# Install mkcert
sudo apt install mkcert

# Generate certificates (run from project root)
./scripts/setup-ssl.sh --install-ca
```

## Usage

After generating certificates, start the development environment with SSL:

```bash
docker-compose -f docker-compose.ssl.yml up --build
```

Access the application at: **https://localhost:3000**

## Why SSL for Development?

1. **Telegram Mini Apps require HTTPS** - The Telegram Mini App SDK only works properly over HTTPS
2. **Web Crypto API** - Some cryptographic operations require a secure context
3. **WebSocket Security** - Using `wss://` instead of `ws://` for WebSocket connections
4. **Realistic Testing** - Development environment matches production more closely

## Files

After running the setup script, this directory will contain:

- `cert.pem` - SSL certificate (auto-generated, git-ignored)
- `key.pem` - Private key (auto-generated, git-ignored)

## Troubleshooting

### Certificate Not Trusted

Run the setup script with the CA installation flag:
- Windows: `.\scripts\setup-ssl.ps1 -InstallCA` (as Administrator)
- Unix: `./scripts/setup-ssl.sh --install-ca`

### mkcert Not Found

Install mkcert first:
- Download from: https://github.com/FiloSottile/mkcert/releases
- Or use a package manager (chocolatey, scoop, brew, apt)

### Port Already in Use

Stop any services using ports 3000 or 3080:
- Use `netstat -ano | findstr :3000` (Windows)
- Use `lsof -i :3000` (Unix/macOS)
