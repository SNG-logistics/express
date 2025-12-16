import app from './src/app.js';
import { exec } from 'child_process';

const port = process.env.PORT || 3000;

const startServer = () => {
    app.listen(port, () => {
        console.log(`Server started via root app.js on port ${port}`);
    });
};

// Self-healing: Kill zombie processes on port before starting
console.log(`Attempting to clear port ${port}...`);
exec(`fuser -k ${port}/tcp`, (err) => {
    // If fuser fails or doesn't exist, we try starting anyway.
    // If it succeeds, the port is clear.
    startServer();
});
