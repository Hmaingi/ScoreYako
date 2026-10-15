import { createApp } from './app.js';
const app = createApp();
const PORT = Number(process.env.PORT || 4000);
const server = app.listen(PORT, () => console.log(`Scoreyako backend listening on http://localhost:${PORT}`));
server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Another process may be running.`);
        process.exit(1);
    }
    console.error('Unexpected server error:', err);
    process.exit(1);
});
export { app };
