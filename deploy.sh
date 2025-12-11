#!/bin/bash
# SNG Logistics Deployment Script
# Tested on Ubuntu 20.04 / 22.04 LTS
# Usage: sudo ./deploy.sh

set -e

GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}>>> Starting SNG Logistics Auto-Setup...${NC}"

# 1. Update System
echo -e "${GREEN}>>> [1/6] Updating system packages...${NC}"
sudo apt update -y

# 2. Install Node.js 20
echo -e "${GREEN}>>> [2/6] Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential

# 3. Install PM2
echo -e "${GREEN}>>> [3/6] Installing PM2 and Tools...${NC}"
sudo npm install -g pm2

# 4. Install Nginx
echo -e "${GREEN}>>> [4/6] Installing Nginx Web Server...${NC}"
sudo apt install -y nginx

# 5. Configure Nginx Proxy
echo -e "${GREEN}>>> [5/6] Configuring Nginx Proxy (Port 80 -> 3000)...${NC}"
cat > /etc/nginx/sites-available/sng-logistics <<EOF
server {
    listen 80;
    server_name _; 

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site and remove default
sudo ln -sf /etc/nginx/sites-available/sng-logistics /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
# Test and restart
sudo nginx -t
sudo systemctl restart nginx

# 6. Install MySQL
echo -e "${GREEN}>>> [6/6] Installing MySQL Server...${NC}"
sudo apt install -y mysql-server

# Create a helper SQL file for the user to run easily
cat > setup_db.sql <<EOF
CREATE DATABASE IF NOT EXISTS sng_logistics CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Note: You should change this password!
CREATE USER IF NOT EXISTS 'sng_user'@'localhost' IDENTIFIED BY 'Admin1234!';
GRANT ALL PRIVILEGES ON sng_logistics.* TO 'sng_user'@'localhost';
FLUSH PRIVILEGES;
EOF

# 7. Git Clone (Optional but recommended)
echo -e "${GREEN}>>> [7/7] Checking Project Files...${NC}"
PROJECT_DIR="/var/www/sng-logistics"
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

if [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "Cloning from GitHub..."
    if [ -z "$(ls -A $PROJECT_DIR)" ]; then
       git clone https://github.com/SNG-logistics/express.git $PROJECT_DIR
    else
       echo "Directory not empty, skipping clone. Please upload files manually or clear directory."
    fi
else
    echo "Project already exists, pulling latest..."
    cd $PROJECT_DIR && git pull origin master
fi

echo -e "${GREEN}>>> Installation Complete! ${NC}"
echo "----------------------------------------------------------------"
echo "Next Steps:"
echo "1. Create the database user:"
echo "   sudo mysql -u root < setup_db.sql"
echo ""
echo "2. Import your data (copy sng_logistics.sql to this server first):"
echo "   mysql -u sng_user -p sng_logistics < sng_logistics.sql"
echo ""
echo "3. Go to project directory:"
echo "   cd /var/www/sng-logistics"
echo "4. Create .env file with DB_USER=sng_user and DB_PASS=Admin1234!"
echo "5. Run: npm install"
echo "6. Run: pm2 start ecosystem.config.cjs"
echo "----------------------------------------------------------------"
