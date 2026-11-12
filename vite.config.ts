import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (npm run dev:api); /api requests are forwarded to it.
const api = { '/api': { target: 'http://localhost:' + (process.env.API_PORT || 3001) } };

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5175, strictPort: true, proxy: api },
  preview: { proxy: api }
});
