#!/bin/bash
# Setup SSL certificates for local development using mkcert
# This script must be run with appropriate privileges for the first time (to install root CA)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../certs"
DOMAIN="localhost"
ADDITIONAL_DOMAINS="127.0.0.1 ::1 burnedchats.local"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

show_help() {
    cat << EOF
SSL Certificate Setup Script for BurnedChats (Unix/macOS/Linux)

Usage:
    ./setup-ssl.sh              Generate certificates (requires mkcert installed)
    ./setup-ssl.sh --install-ca Install root CA and generate certificates
    ./setup-ssl.sh --help       Show this help message

Prerequisites:
    1. Install mkcert:
       - macOS: brew install mkcert
       - Linux (Debian/Ubuntu): sudo apt install mkcert
       - Linux (Arch): sudo pacman -S mkcert
       - Or build from source: https://github.com/FiloSottile/mkcert

    2. Run with --install-ca flag once to trust certificates

After setup:
    - Certificates will be in ./certs directory
    - Run 'docker-compose -f docker-compose.ssl.yml up' to start with HTTPS
    - Access app at https://localhost:3000
EOF
}

check_mkcert() {
    if ! command -v mkcert &> /dev/null; then
        return 1
    fi
    return 0
}

install_root_ca() {
    echo -e "${CYAN}Installing mkcert root CA...${NC}"
    echo -e "${YELLOW}This may require sudo password.${NC}"
    
    mkcert -install
    
    echo -e "${GREEN}Root CA installed successfully!${NC}"
}

generate_certificates() {
    echo -e "${CYAN}Generating SSL certificates...${NC}"
    
    # Create certs directory
    mkdir -p "$CERTS_DIR"
    echo -e "${GRAY}Created directory: $CERTS_DIR${NC}"
    
    # Generate certificates
    cd "$CERTS_DIR"
    mkcert -cert-file cert.pem -key-file key.pem $DOMAIN $ADDITIONAL_DOMAINS
    
    echo ""
    echo -e "${GREEN}Certificates generated successfully!${NC}"
    echo -e "${GRAY}  - Certificate: $CERTS_DIR/cert.pem${NC}"
    echo -e "${GRAY}  - Private key: $CERTS_DIR/key.pem${NC}"
    echo ""
    echo -e "${CYAN}Domains covered:${NC}"
    for domain in $DOMAIN $ADDITIONAL_DOMAINS; do
        echo -e "${GRAY}  - $domain${NC}"
    done
}

create_gitignore() {
    local gitignore_path="$CERTS_DIR/.gitignore"
    if [ ! -f "$gitignore_path" ]; then
        cat > "$gitignore_path" << 'EOF'
# Ignore all certificate files
*.pem
*.crt
*.key
EOF
        echo -e "${GRAY}Created .gitignore in certs directory${NC}"
    fi
}

# Parse arguments
INSTALL_CA=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --install-ca|-i)
            INSTALL_CA=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Main
echo ""
echo -e "${MAGENTA}=== BurnedChats SSL Setup ===${NC}"
echo ""

if ! check_mkcert; then
    echo -e "${RED}Error: mkcert is not installed!${NC}"
    echo ""
    echo -e "${YELLOW}Install mkcert first:${NC}"
    echo -e "${GRAY}  - macOS: brew install mkcert${NC}"
    echo -e "${GRAY}  - Linux (Debian/Ubuntu): sudo apt install mkcert${NC}"
    echo -e "${GRAY}  - Linux (Arch): sudo pacman -S mkcert${NC}"
    echo -e "${GRAY}  - Manual: https://github.com/FiloSottile/mkcert${NC}"
    echo ""
    exit 1
fi

echo -e "${GRAY}mkcert found: $(which mkcert)${NC}"

if [ "$INSTALL_CA" = true ]; then
    install_root_ca
fi

generate_certificates
create_gitignore

echo ""
echo -e "${MAGENTA}=== Next Steps ===${NC}"
echo -e "${CYAN}1. Start with SSL: docker-compose -f docker-compose.ssl.yml up --build${NC}"
echo -e "${CYAN}2. Open: https://localhost:3000${NC}"
echo ""
