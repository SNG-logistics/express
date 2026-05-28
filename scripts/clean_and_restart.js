import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

console.log('🧹 Cleaning up temporary and leftover files...');

// 1. Delete specific test files
const filesToDelete = [
  'scratch_test.mjs',
  'scratch_test_render.mjs',
  'post_debug.log'
];

filesToDelete.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`✅ Deleted: ${file}`);
  }
});

// 2. Delete any tmp_*.mjs files
const allFiles = fs.readdirSync(rootDir);
allFiles.forEach(file => {
  if (file.startsWith('tmp_') && file.endsWith('.mjs')) {
    fs.unlinkSync(path.join(rootDir, file));
    console.log(`✅ Deleted temp file: ${file}`);
  }
});

// 3. Trigger Passenger (Plesk) Restart
const tmpDir = path.join(rootDir, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

const restartTxt = path.join(tmpDir, 'restart.txt');
fs.writeFileSync(restartTxt, String(Date.now()));
console.log('🔄 Triggered Plesk/Passenger restart via tmp/restart.txt');

console.log('✨ Cleanup complete!');
