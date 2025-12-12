import pool from '../src/config/db.js';

async function listUsers() {
    try {
        const [rows] = await pool.query('SELECT id, username, role, status FROM users');
        console.log('--- Users in Database ---');
        if (rows.length === 0) {
            console.log('No users found.');
        } else {
            console.table(rows);
        }
    } catch (err) {
        console.error('Error querying users:', err);
    } finally {
        process.exit();
    }
}

listUsers();
