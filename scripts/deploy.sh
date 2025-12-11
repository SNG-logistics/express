#!/bin/bash

# SNG Logistics - Deployment Script

echo "Deploying SNG Logistics..."

# 1. Pull latest changes (if using git)
# git pull origin main

# 2. Install Dependencies
echo "Installing dependencies..."
npm install

# 3. Build/Prepare (if needed)
# npm run build

# 4. Restart Application
echo "Restarting application..."
pm2 restart sng-logistics || pm2 start src/app.js --name sng-logistics

echo "Deployment Complete!"
