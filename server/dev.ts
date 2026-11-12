// Runs the API locally on port 3001. Vite (npm run dev) forwards /api requests here.
try { process.loadEnvFile('.env'); } catch { /* no .env file: use the environment as it is */ }

const { default: app } = await import('./app.js');
const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => console.log('Neo Project API listening on http://localhost:' + port));
