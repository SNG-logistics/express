import bcrypt from 'bcrypt';

async function generateSQL() {
    const password = process.argv[2];
    if (!password || password.length < 8) {
        console.error('Usage: node scripts/create_admin_sql.js <password>');
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);

    console.log(`
-- Copy and run this SQL in phpMyAdmin:
INSERT INTO users (username, password_hash, role, name, phone, status)
VALUES (
    'admin',
    '${hash}',
    'admin',
    'Administrator',
    '000-000-0000',
    'active'
);
    `);
}

generateSQL();
