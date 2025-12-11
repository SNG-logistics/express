import fs from 'fs';
import path from 'path';

const xamppPath = 'C:/xampp/mysql/bin/my.ini';

try {
    if (fs.existsSync(xamppPath)) {
        const data = fs.readFileSync(xamppPath, 'utf8');
        const portMatch = data.match(/^port\s*=\s*(\d+)/m);
        if (portMatch) {
            console.log('XAMPP MySQL Port:', portMatch[1]);
        } else {
            console.log('XAMPP my.ini found but could not parse port.');
        }
    } else {
        console.log('XAMPP my.ini not found.');
    }
} catch (err) {
    console.error('Error reading XAMPP config:', err.message);
}
