import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, '../public/diagnosis.txt');

function runCommand(cmd) {
    try {
        return execSync(cmd).toString().trim();
    } catch (e) {
        return 'Not found / Error';
    }
}

const report = [
    '--- SYSTEM DIAGNOSIS ---',
    `Time: ${new Date().toISOString()}`,
    `User: ${runCommand('whoami')}`,
    `OS Release: ${runCommand('cat /etc/os-release | grep PRETTY_NAME')}`,
    '------------------------',
    '--- BROWSER CHECK ---',
    `Chromium (which chromium): ${runCommand('which chromium')}`,
    `Chromium Browser (which chromium-browser): ${runCommand('which chromium-browser')}`,
    `Google Chrome (which google-chrome): ${runCommand('which google-chrome')}`,
    `Google Chrome Stable (which google-chrome-stable): ${runCommand('which google-chrome-stable')}`,
    '------------------------',
    '--- LIBRARY CHECK ---',
    `libnss3.so: ${runCommand('ldconfig -p | grep libnss3')}`,
    `libatk: ${runCommand('ldconfig -p | grep libatk')}`,
    '------------------------'
].join('\n');

fs.writeFileSync(outputPath, report);
console.log('Diagnosis written to public/diagnosis.txt');
console.log(report);
