import mysql from 'mysql2/promise';
const c = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'Rh4kbuko',database:'sng_logistics'});
const [cols] = await c.query('DESCRIBE users');
console.table(cols.map(r => ({ Field: r.Field, Type: r.Type, Null: r.Null })));
await c.end();
