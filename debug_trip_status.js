
import pool from './src/config/db.js';

async function testUpdate() {
    const tripId = 4;
    console.log(`Testing update for Trip ${tripId} to ON_ROUTE...`);

    try {
        const [result] = await pool.query("UPDATE trips SET status = ? WHERE id = ?", ['ON_ROUTE', tripId]);
        console.log("Update Result:", result);
    } catch (err) {
        console.error("Update Failed:", err);
    } finally {
        process.exit();
    }
}

testUpdate();
