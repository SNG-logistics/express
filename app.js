import app from './src/app.js';

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server started via root app.js on port ${port}`);
});
