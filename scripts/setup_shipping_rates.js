import 'dotenv/config';
import mysql from 'mysql2/promise';

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'sng_logistics',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

async function setupShippingRates() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(dbConfig);

        console.log('Creating table: shipping_rates...');
        await connection.query('DROP TABLE IF EXISTS shipping_rates');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS shipping_rates (
                id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                max_weight DECIMAL(10,2) NOT NULL,
                max_dimension INT NOT NULL DEFAULT 0 COMMENT 'Sum of W+L+H in cm',
                price DECIMAL(10,2) NOT NULL,
                active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        console.log('SUCCESS: Table shipping_rates created.');

    } catch (error) {
        console.error('ERROR:', error);
    } finally {
        if (connection) await connection.end();
    }
}

setupShippingRates();
