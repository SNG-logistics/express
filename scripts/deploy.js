import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('🚀 Starting Plesk deploy command...');

try {
  // 1. Git Pull (if .git exists)
  const hasGit = fs.existsSync(path.join(rootDir, '.git'));
  if (hasGit) {
    console.log('1️⃣ Fetching latest code and resetting local changes...');
    execSync('git fetch origin main', { stdio: 'inherit', cwd: rootDir });
    execSync('git reset --hard origin/main', { stdio: 'inherit', cwd: rootDir });
  } else {
    console.log('1️⃣ Skipping Git operations: .git directory not found (assuming Plesk managed file updates).');
  }

  // 2. Install dependencies
  console.log('2️⃣ Installing npm dependencies...');
  execSync('npm install --omit=dev', { stdio: 'inherit', cwd: rootDir });

  // 3. Run Migrations
  console.log('3️⃣ Running database migrations...');
  execSync('npm run migrate-db', { stdio: 'inherit', cwd: rootDir });
  execSync('npm run migrate-crm', { stdio: 'inherit', cwd: rootDir });

  // 4. Clean and Restart
  console.log('4️⃣ Cleaning temp files and restarting Passenger...');
  execSync('npm run clean', { stdio: 'inherit', cwd: rootDir });

  console.log('✅ Deployment successful!');
} catch (err) {
  console.error('❌ Deployment failed:', err.message);
  process.exit(1);
}
