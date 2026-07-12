#!/bin/bash
# ===========================================
# BurnedChats Production Deployment Script
# ===========================================
# 
# Usage:
#   ./scripts/deploy.sh setup    # First time setup (get SSL certs)
#   ./scripts/deploy.sh start    # Start all services
#   ./scripts/deploy.sh stop     # Stop all services
#   ./scripts/deploy.sh restart  # Restart all services
#   ./scripts/deploy.sh update   # Pull changes and restart
#   ./scripts/deploy.sh logs     # View logs
#   ./scripts/deploy.sh renew    # Renew SSL certificates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
ENV_FILE="$PROJECT_DIR/.env.prod"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env.prod file not found!"
        log_info "Copy .env.example to .env.prod and fill in the values:"
        echo "  cp .env.example .env.prod"
        exit 1
    fi
}

setup_ssl() {
    log_info "Setting up SSL certificates with Let's Encrypt..."
    
    check_env_file
    source "$ENV_FILE"
    
    if [ -z "$DOMAIN" ]; then
        log_error "DOMAIN not set in .env.prod"
        exit 1
    fi
    
    # Create certbot directories
    mkdir -p "$PROJECT_DIR/certbot/www"
    mkdir -p "$PROJECT_DIR/certbot/conf"
    
    # Start temporary nginx for ACME challenge
    log_info "Starting temporary nginx for certificate validation..."
    docker compose -f "$COMPOSE_FILE" --profile certbot up -d nginx-certbot
    
    sleep 5
    
    # Get certificate
    log_info "Requesting SSL certificate for $DOMAIN..."
    read -p "Enter your email for Let's Encrypt notifications: " EMAIL
    
    docker compose -f "$COMPOSE_FILE" --profile certbot run --rm certbot certonly \
        --webroot \
        -w /var/www/certbot \
        -d "$DOMAIN" \
        -d "www.$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email
    
    # Stop temporary nginx
    docker compose -f "$COMPOSE_FILE" --profile certbot down
    
    log_info "SSL certificates obtained successfully!"
    log_info "Now run: ./scripts/deploy.sh start"
}

start_services() {
    log_info "Starting all services..."
    check_env_file
    
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
    
    log_info "Services started! Checking status..."
    sleep 10
    docker compose -f "$COMPOSE_FILE" ps
}

stop_services() {
    log_info "Stopping all services..."
    docker compose -f "$COMPOSE_FILE" down
    log_info "Services stopped."
}

restart_services() {
    log_info "Restarting all services..."
    stop_services
    start_services
}

cleanup_disk() {
    local cleanup_script="$SCRIPT_DIR/prod-disk-cleanup.sh"
    if [ ! -x "$cleanup_script" ]; then
        log_warn "Disk cleanup script not found or not executable: $cleanup_script"
        return 0
    fi
    log_info "Running post-deploy disk cleanup..."
    "$cleanup_script"
}

update_and_restart() {
    log_info "Pulling latest changes..."
    cd "$PROJECT_DIR"
    git pull origin master
    
    log_info "Rebuilding and restarting services..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
    
    cleanup_disk
    
    log_info "Update complete!"
}

show_logs() {
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100
}

renew_ssl() {
    log_info "Renewing SSL certificates..."
    docker compose -f "$COMPOSE_FILE" --profile certbot run --rm certbot renew
    docker compose -f "$COMPOSE_FILE" exec nginx nginx -s reload
    log_info "Certificate renewal complete!"
}

setup_webhook() {
    log_info "Setting up Telegram webhook..."
    
    check_env_file
    source "$ENV_FILE"
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        log_error "TELEGRAM_BOT_TOKEN not set in .env.prod"
        exit 1
    fi
    
    if [ -z "$TELEGRAM_WEBHOOK_SECRET" ]; then
        log_error "TELEGRAM_WEBHOOK_SECRET not set in .env.prod"
        exit 1
    fi
    
    if [ -z "$DOMAIN" ]; then
        log_error "DOMAIN not set in .env.prod"
        exit 1
    fi
    
    WEBHOOK_URL="https://${DOMAIN}/api/telegram/webhook"
    
    log_info "Setting webhook to: $WEBHOOK_URL"
    
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"${WEBHOOK_URL}\", \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\"}")
    
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        log_info "Webhook set successfully!"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    else
        log_error "Failed to set webhook:"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
        exit 1
    fi
}

check_webhook() {
    log_info "Checking Telegram webhook status..."
    
    check_env_file
    source "$ENV_FILE"
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        log_error "TELEGRAM_BOT_TOKEN not set in .env.prod"
        exit 1
    fi
    
    RESPONSE=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
    
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
}

delete_webhook() {
    log_info "Deleting Telegram webhook..."
    
    check_env_file
    source "$ENV_FILE"
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        log_error "TELEGRAM_BOT_TOKEN not set in .env.prod"
        exit 1
    fi
    
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook")
    
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        log_info "Webhook deleted successfully!"
    else
        log_error "Failed to delete webhook:"
        echo "$RESPONSE"
    fi
}

# Main
case "$1" in
    setup)
        setup_ssl
        ;;
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    update)
        update_and_restart
        ;;
    logs)
        show_logs
        ;;
    renew)
        renew_ssl
        ;;
    webhook)
        setup_webhook
        ;;
    webhook-info)
        check_webhook
        ;;
    webhook-delete)
        delete_webhook
        ;;
    cleanup)
        cleanup_disk
        ;;
    *)
        echo "Usage: $0 {setup|start|stop|restart|update|logs|renew|cleanup|webhook|webhook-info|webhook-delete}"
        echo ""
        echo "Commands:"
        echo "  setup          - First time setup (obtain SSL certificates)"
        echo "  start          - Start all services"
        echo "  stop           - Stop all services"
        echo "  restart        - Restart all services"
        echo "  update         - Pull git changes, restart, and run disk cleanup"
        echo "  cleanup        - Prune Docker build cache, journal, and /tmp artifacts"
        echo "  logs           - View container logs"
        echo "  renew          - Renew SSL certificates"
        echo "  webhook        - Set Telegram webhook"
        echo "  webhook-info   - Check current webhook status"
        echo "  webhook-delete - Remove webhook (switch to polling)"
        exit 1
        ;;
esac
