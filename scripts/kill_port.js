import { exec } from 'child_process';

console.log('Cleaning up port 3000...');

// Try fuser first (standard on Linux)
exec('fuser -k 3000/tcp', (err) => {
    if (err) {
        // If fuser fails or not found, try lsof strategy
        console.log('fuser result:', err.code);
        exec('lsof -t -i:3000 | xargs kill -9', () => {
            console.log('Port cleanup attempt complete.');
        });
    } else {
        console.log('Port 3000 cleared via fuser.');
    }
});
