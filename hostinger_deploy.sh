#!/bin/bash
# hostinger_deploy.sh
# SNG Logistics Express — Hostinger VPS Deploy Script (อัปเดต)
# ใช้สำหรับ: ครั้งแรก + ทุกครั้งที่ deploy code ใหม่
#
# วิธีใช้:
#   bash hostinger_deploy.sh          ← deploy ปกติ (zero-downtime)
#   bash hostinger_deploy.sh --full   ← ติดตั้งทั้งหมดรวม nginx (ครั้งแรก)

set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

FULL_SETUP=false
[[ "$1" == "--full" ]] && FULL_SETUP=true

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   SNG Logistics Express — Hostinger Deploy       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Check .env ────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${RED}❌ ERROR: .env not found!${NC}"
  echo "   cp .env.production.example .env"
  echo "   nano .env   ← แก้ DB_HOST, DB_USER, DB_PASS, DB_NAME, SESSION_SECRET"
  exit 1
fi
echo -e "${GREEN}✓ .env found${NC}"

# ── Full setup: Node.js 20 + PM2 + Nginx + Certbot ───────────────────────────
if $FULL_SETUP; then
  echo ""
  echo -e "${YELLOW}[FULL SETUP] Installing system dependencies...${NC}"

  # Node.js 20
  if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"
  else
    echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
  fi

  # PM2
  if ! command -v pm2 &>/dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✓ PM2 installed${NC}"
  fi

  # Nginx
  if ! command -v nginx &>/dev/null; then
    sudo apt install -y nginx certbot python3-certbot-nginx
    echo -e "${GREEN}✓ Nginx installed${NC}"
  fi

  # Nginx config
  DOMAIN=$(grep '^APP_URL=' .env | cut -d= -f2 | sed 's|https\?://||' | sed 's|/.*||')
  PORT=$(grep '^PORT=' .env | cut -d= -f2 | tr -d '\r' || echo 3000)
  PORT=${PORT:-3000}
  
  if [ -z "$DOMAIN" ]; then
    DOMAIN="your-domain.com"
  fi

  echo -e "${YELLOW}Configuring Nginx for domain: $DOMAIN (subdomains: www.$DOMAIN, member.$DOMAIN) on port $PORT...${NC}"
  cat > /tmp/sng-nginx.conf << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN member.$DOMAIN;

    # Max upload size
    client_max_body_size 20M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Static files served directly (bypass Node.js for speed)
    location /css/ {
        alias $APP_DIR/public/css/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    location /js/ {
        alias $APP_DIR/public/js/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    location /images/ {
        alias $APP_DIR/public/images/;
        expires 30d;
    }
    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
    }

    # Node.js app (all other requests)
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;

        # Socket.io support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # Facebook/LINE webhook — no timeout limit
    location /webhooks/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}
NGINXEOF
  sudo cp /tmp/sng-nginx.conf /etc/nginx/sites-available/sng-logistics
  sudo ln -sf /etc/nginx/sites-available/sng-logistics /etc/nginx/sites-enabled/sng-logistics
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
  echo -e "${GREEN}✓ Nginx configured${NC}"

  # SSL (Certbot)
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "your-domain.com" ]; then
    echo -e "${YELLOW}Setting up SSL for $DOMAIN, www.$DOMAIN, member.$DOMAIN...${NC}"
    sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" -d "member.$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN" || true
    echo -e "${GREEN}✓ SSL configured${NC}"
  fi
fi

# ── Create directories ────────────────────────────────────────────────────────
mkdir -p logs public/uploads
echo -e "${GREEN}✓ Directories ready${NC}"

# ── Install npm dependencies ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}📦 Installing npm dependencies...${NC}"
npm ci --omit=dev
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── Database migrations ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}🗄️  Running database migrations...${NC}"

npm run migrate-db || echo -e "${RED}⚠️  migrate-db failed — please check database configuration${NC}"
npm run migrate-crm || echo -e "${RED}⚠️  migrate-crm failed — please check database configuration${NC}"

# ── PM2 start / reload ────────────────────────────────────────────────────────
echo ""
if pm2 list | grep -q "sng-logistics"; then
  echo -e "${YELLOW}🔄 Reloading app (zero-downtime)...${NC}"
  pm2 reload ecosystem.config.cjs --env production
else
  echo -e "${YELLOW}🚀 Starting app with PM2...${NC}"
  pm2 start ecosystem.config.cjs --env production
  pm2 startup systemd -u $(whoami) --hp $HOME 2>/dev/null || true
fi

pm2 save
echo -e "${GREEN}✓ PM2 running${NC}"

# ── Health check ──────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}🏥 Health check...${NC}"
CHECK_PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '\r"' || echo 3000)
CHECK_PORT=${CHECK_PORT:-3000}

HTTP_CODE="000"
for i in {1..5}; do
  sleep 2
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${CHECK_PORT}/ 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" || "$HTTP_CODE" == "404" ]]; then
    break
  fi
done

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "302" || "$HTTP_CODE" == "404" ]]; then
  echo -e "${GREEN}✓ App responding (HTTP $HTTP_CODE on port $CHECK_PORT)${NC}"
else
  echo -e "${RED}⚠️  App not responding (HTTP $HTTP_CODE on port $CHECK_PORT) — check logs:${NC}"
  echo "   pm2 logs sng-logistics --lines 20"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
APP_URL=$(grep '^APP_URL=' .env 2>/dev/null | cut -d= -f2 | tr -d '\r"' || echo "http://localhost:$CHECK_PORT")
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ Deploy Complete!                             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  App URL:    $APP_URL"
echo "  CRM URL:    $APP_URL/crm"
echo "  Webhook FB: $APP_URL/webhooks/facebook"
echo "  Webhook LINE: $APP_URL/webhooks/line"
echo ""
echo "  Commands:"
echo "  pm2 status               ← check status"
echo "  pm2 logs sng-logistics   ← view logs"
echo "  pm2 monit                ← realtime monitor"
echo ""
