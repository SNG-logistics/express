import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
(async()=>{
  const db = await mysql.createConnection({host:'127.0.0.1',user:'root',password:'Rh4kbuko',database:'sng_logistics'});
  const [cols] = await db.query('SHOW COLUMNS FROM orders');
  console.log('Cols:', cols.map(c=>c.Field).join(', '));
  const [tbls] = await db.query('SHOW TABLES LIKE "delivery_events"');
  console.log('delivery_events:', tbls.length ? 'EXISTS' : 'NOT EXISTS');
  await db.end();
})();
