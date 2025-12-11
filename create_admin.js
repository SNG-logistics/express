import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import pool from './src/config/db.js';

dotenv.config();

async function run() {
    const hash = await bcrypt.hash('password', 10);
    console.log('Hash created');
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', ['antigravity']);
        if (rows.length > 0) {
            await pool.query('UPDATE users SET password_hash = ?, status = "active" WHERE username = ?', [hash, 'antigravity']);
            console.log('User password updated');
        } else {
            await pool.query('INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)', ['antigravity', hash, 'Antigravity User', 'admin', 'active']);
            console.log('User created');
        }
    } catch (err) {
        console.error('Error:', err);
    }
    process.exit();
}
run();
