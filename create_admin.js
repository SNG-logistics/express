import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import pool from './src/config/db.js';

dotenv.config();

async function run() {
    const password = process.argv[2] || process.env.ADMIN_PASSWORD;
    if (!password || password.length < 8) {
        console.error('Usage: node create_admin.js <password>');
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);
    console.log('Hash created');
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (rows.length > 0) {
            await pool.query('UPDATE users SET password_hash = ?, status = "active" WHERE username = ?', [hash, 'admin']);
            console.log('Admin password updated');
        } else {
            await pool.query('INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)', ['admin', hash, 'Administrator', 'admin', 'active']);
            console.log('Admin user created');
        }
    } catch (err) {
        console.error('Error:', err);
    }
    process.exit();
}
run();
