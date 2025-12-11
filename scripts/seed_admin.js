import pool from '../src/config/db.js';
import bcrypt from 'bcrypt';

async function seedAdmin() {
    try {
        const username = 'admin';
        const password = 'password123';
        const role = 'admin';
        const status = 'active';

        console.log(`Checking for user: ${username}...`);

        // Check if user exists
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        if (existing.length > 0) {
            // Update existing admin
            await pool.query('UPDATE users SET password_hash = ?, status = ?, role = ? WHERE username = ?', [hash, status, role, username]);
            console.log('Admin user updated successfully.');
        } else {
            // Create new admin
            await pool.query('INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)', [username, hash, role, status]);
            console.log('Admin user created successfully.');
        }
        console.log('-----------------------------------');
        console.log(`Login with -> Username: ${username} | Password: ${password}`);
        console.log('-----------------------------------');
    } catch (err) {
        console.error('Error seeding admin:', err);
    } finally {
        process.exit();
    }
}

seedAdmin();
