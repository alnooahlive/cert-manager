import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import certRoutes from './routes/certificates';
import routerRoutes from './routes/routers';
import customerRoutes from './routes/customers';
import settingsRoutes from './routes/settings';
import agentRoutes from './routes/agent';
import cfRoutes from './routes/cloudflare';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);

// simple request log
app.use((req, _res, next) => {
  if (process.env.LOG_LEVEL === 'debug') console.log(`${req.method} ${req.path}`);
  next();
});

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/certificates', certRoutes);
app.use('/api/routers', routerRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/cloudflare', cfRoutes);
app.use('/agent/v1', agentRoutes);

// static frontend
app.use(express.static(path.join(process.cwd(), 'public')));
app.get('/login', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'login.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));
app.get('/', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));

// centralized error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('unhandled error:', err?.message || err);
  res.status(err?.status || 500).json({ error: err?.message || 'internal error' });
});

export default app;
