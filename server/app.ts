import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError } from './http.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store');
  // The session cookie is SameSite=Strict; as a second guard, changes must come from this site's own pages.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.get('origin');
    const host = req.get('x-forwarded-host') || req.get('host');
    let originHost = '';
    try { originHost = origin ? new URL(origin).host : ''; } catch { /* "null" or malformed origin */ }
    if (origin && host && originHost !== host) throw new HttpError(403, 'Cross-site request refused.');
  }
  next();
});

app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', () => { throw new HttpError(404, 'Unknown API endpoint.'); });

// Turns errors into JSON. Unexpected errors are logged on the server and not shown to the user in detail.
// Express recognises an error handler by its four parameters, so _next must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') { res.status(413).json({ error: 'This project is too large to save (limit 4 MB).' }); return; }
  if (e?.type === 'entity.parse.failed') { res.status(400).json({ error: 'The request was not valid JSON.' }); return; }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

export default app;
