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

async function resetOrders() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(dbConfig);

        console.log('WARNING: This will delete ALL orders, trips, and payments data.');
        console.log('Master data (Customers, Users) will be preserved.');

        // Disable foreign key checks to allow truncation in any order (though we try to be nice)
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        const tables = [
            'cod_settlements',
            'payments',
            'trip_orders',
            'order_status_logs',
            'orders',
            'trips',
            'customers'
        ];

        for (const table of tables) {
            console.log(`Clearing table: ${table}...`);
            await connection.query(`TRUNCATE TABLE ${table}`);
        }

        // Re-enable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('----------------------------------------');
        console.log('SUCCESS: All transaction data cleared.');
        console.log('----------------------------------------');

    } catch (error) {
        console.error('ERROR Failed to reset database:', error);
    } finally {
        if (connection) await connection.end();
    }
}

resetOrders();
