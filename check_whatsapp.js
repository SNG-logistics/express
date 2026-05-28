/**
 * ตรวจสอบสถานะ WhatsApp Baileys
 * รัน: node check_whatsapp.js
 */
import { getStatus, getLogs, getLastError, getQr } from './src/services/whatsappService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// รอให้ Baileys เริ่มต้น
await new Promise(r => setTimeout(r, 5000));

const status = getStatus();
const logs   = getLogs();
const error  = getLastError();
const qr     = getQr();

console.log('\n══════════════════════════════════════');
console.log('   WhatsApp Baileys Status Check');
console.log('══════════════════════════════════════');
console.log(`📡 Status     : ${status}`);
console.log(`❌ Last Error  : ${error || 'none'}`);
console.log(`📷 QR Ready   : ${qr ? 'YES — scan at /whatsapp' : 'no'}`);

// Check auth folder
const authPath = path.join(__dirname, 'auth_info_baileys');
const hasAuth  = fs.existsSync(authPath);
const authFiles = hasAuth ? fs.readdirSync(authPath) : [];
console.log(`🗂  Auth folder : ${hasAuth ? `EXISTS (${authFiles.length} files)` : 'NOT FOUND — needs QR scan'}`);

// Check DISABLE flag
const flagPath = path.join(__dirname, 'DISABLE_WHATSAPP');
const disabled = fs.existsSync(flagPath);
console.log(`🚫 Disabled flag: ${disabled ? 'YES — service is disabled!' : 'no'}`);

console.log('\n📋 Recent Logs:');
logs.slice(0, 10).forEach(l => console.log(' ', l));

console.log('\n══════════════════════════════════════');

// Summary
if (status === 'CONNECTED') {
  console.log('✅ WhatsApp CONNECTED — ส่งข้อความได้ปกติ');
} else if (status === 'QR_READY') {
  console.log('⚠️  QR_READY — ต้องสแกน QR ที่ /whatsapp');
} else if (status === 'DISABLED_MANUALLY') {
  console.log('🔴 DISABLED — WhatsApp ปิดอยู่ ลบไฟล์ DISABLE_WHATSAPP เพื่อเปิด');
} else if (status === 'CONNECTING') {
  console.log('🔄 CONNECTING — กำลังเชื่อมต่อ...');
} else {
  console.log('❌ DISCONNECTED — ไม่ได้เชื่อมต่อ');
}

process.exit(0);
