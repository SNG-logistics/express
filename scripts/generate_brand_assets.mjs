import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const sourceLogo = path.join(rootDir, 'public', 'images', 'snglogo.png');
const faviconDir = path.join(rootDir, 'public', 'favicon');
const imagesDir = path.join(rootDir, 'public', 'images');

function createIcoFromPng(pngBuffer, width = 32, height = 32) {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Image type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // Number of images

  const icoDirectory = Buffer.alloc(16);
  icoDirectory.writeUInt8(width >= 256 ? 0 : width, 0);
  icoDirectory.writeUInt8(height >= 256 ? 0 : height, 1);
  icoDirectory.writeUInt8(0, 2); // Palette colors
  icoDirectory.writeUInt8(0, 3); // Reserved
  icoDirectory.writeUInt16LE(1, 4); // Color planes
  icoDirectory.writeUInt16LE(32, 6); // Bits per pixel
  icoDirectory.writeUInt32LE(pngBuffer.length, 8); // Image data length
  icoDirectory.writeUInt32LE(22, 12); // Offset to image data

  return Buffer.concat([icoHeader, icoDirectory, pngBuffer]);
}

async function main() {
  console.log('Generating brand assets from:', sourceLogo);

  // Ensure directories exist
  await fs.mkdir(faviconDir, { recursive: true });
  await fs.mkdir(imagesDir, { recursive: true });

  const logoBuffer = await fs.readFile(sourceLogo);

  // 1. favicon-32x32.png
  const png32 = await sharp(logoBuffer)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(faviconDir, 'favicon-32x32.png'), png32);
  console.log('Created: favicon-32x32.png');

  // 2. favicon.ico
  const icoBuffer = createIcoFromPng(png32, 32, 32);
  await fs.writeFile(path.join(faviconDir, 'favicon.ico'), icoBuffer);
  console.log('Created: favicon.ico');

  // 3. apple-touch-icon-180x180.png
  const png180 = await sharp(logoBuffer)
    .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(faviconDir, 'apple-touch-icon-180x180.png'), png180);
  console.log('Created: apple-touch-icon-180x180.png');

  // 4. android-chrome-192x192.png
  const png192 = await sharp(logoBuffer)
    .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(faviconDir, 'android-chrome-192x192.png'), png192);
  console.log('Created: android-chrome-192x192.png');

  // 5. android-chrome-512x512.png
  const png512 = await sharp(logoBuffer)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(faviconDir, 'android-chrome-512x512.png'), png512);
  console.log('Created: android-chrome-512x512.png');

  // 6. sng-logo-nav.png (Optimized navbar logo: height 80px)
  const navLogo = await sharp(logoBuffer)
    .resize({ height: 80, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(imagesDir, 'sng-logo-nav.png'), navLogo);
  console.log('Created: sng-logo-nav.png');

  console.log('All brand assets successfully generated!');
}

main().catch((err) => {
  console.error('Error generating brand assets:', err);
  process.exit(1);
});
