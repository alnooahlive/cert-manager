import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import certRoutes from './routes/certificates';
import routerRoutes from './routes/routers';
import agentRoutes from './routes/agent';
import cfRoutes from './routes/cloudflare';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/certificates', certRoutes);
app.use('/api/routers', routerRoutes);
app.use('/api/cloudflare', cfRoutes);
app.use('/agent/v1', agentRoutes);

// static frontend
app.use(express.static(path.join(process.cwd(), 'public')));
app.get('/login', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'login.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));
app.get('/', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));

export default app;
