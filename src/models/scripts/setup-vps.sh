#!/bin/bash

# SNG Logistics - VPS Setup Script
# This script configures a fresh Ubuntu 20.04/22.04 server for the application.

set -e # Exit on error

echo "========================================="
echo "   SNG Logistics - Server Setup "
echo "========================================="

# 1. Update System
echo "[1/7] Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git unzip build-essential libgbm-dev wget

# 2. Install Node.js 20
echo "[2/7] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "Node.js is already installed."
fi

# 3. Install Google Chrome (for WhatsApp)
echo "[3/7] Installing Google Chrome (for WhatsApp)..."
if ! command -v google-chrome &> /dev/null; then
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
    sudo apt-get update
    sudo apt-get install -y google-chrome-stable
else
    echo "Google Chrome is already installed."
fi

# 4. Install MySQL Server
echo "[4/7] Installing MySQL Server..."
sudo apt-get install -y mysql-server
# Note: Users will need to set up the database user manually or we can try to script it
# We will skip auto-securing for now to avoid interactive prompts breaking the script but ensure service is running
sudo systemctl start mysql
sudo systemctl enable mysql

# 5. Install PM2
echo "[5/7] Installing PM2 Process Manager..."
sudo npm install -g pm2

# 6. Install Nginx & Certbot
echo "[6/7] Installing Nginx & Certbot..."
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 7. Setup Complete
echo "========================================="
echo "   SYSTEM DEPENDENCIES INSTALLED"
echo "========================================="
echo ""
echo "Next Steps:"
echo "1. Create your database and user in MySQL."
echo "2. Create a .env file in the project directory."
echo "3. Update Nginx configuration."
echo "4. Run 'npm install' and start the app."
echo ""
