import bcrypt from 'bcrypt';

async function generateSQL() {
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);

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
