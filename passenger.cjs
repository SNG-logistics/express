// passenger.cjs — Phusion Passenger CJS entry point
//
// Passenger's node-loader.js uses require() to load the startup file.
// Since our app uses "type": "module" + top-level await, require() fails with:
//   ERR_REQUIRE_ASYNC_MODULE
//
// Fix: This CommonJS wrapper uses dynamic import() which correctly handles
// ESM modules with top-level await.
//
// Plesk Startup File: passenger.cjs  (NOT src/app.js)

import('./src/app.js').catch((err) => {
  console.error('[PASSENGER] Fatal startup error:', err);
  process.exit(1);
});
