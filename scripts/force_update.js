import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('🚀 Force updating production server from GitHub...');

try {
  // 1. Force Git Pull
  console.log('1️⃣ Fetching latest code...');
  execSync('git fetch origin main', { stdio: 'inherit', cwd: rootDir });
  
  console.log('2️⃣ Forcing hard reset to match GitHub exactly (deleting local changes)...');
  execSync('git reset --hard origin/main', { stdio: 'inherit', cwd: rootDir });
  
  // 2. Run Migrations
  console.log('3️⃣ Running database migrations...');
  execSync('npm run migrate-db', { stdio: 'inherit', cwd: rootDir });
  
  // 3. Clean and Restart
  console.log('4️⃣ Cleaning temp files and restarting...');
  execSync('npm run clean', { stdio: 'inherit', cwd: rootDir });

  console.log('✅ Force update successful! You can now test order creation.');
} catch (err) {
  console.error('❌ Update failed:', err.message);
  process.exit(1);
}
