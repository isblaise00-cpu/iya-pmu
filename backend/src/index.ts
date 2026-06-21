import 'dotenv/config';
import { env } from './lib/env';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { logger } from './lib/logger';
import { authenticate } from './middleware/auth';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import pronosticsRouter from './routes/pronostics';
import resultsRouter from './routes/results';
import subscribersRouter from './routes/subscribers';
import plansRouter from './routes/plans';
import smsRouter from './routes/sms';
import dashboardRouter from './routes/dashboard';
import settingsRouter from './routes/settings';
import sportsRouter from './routes/sports';

const app = express();

app.use(helmet());
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:5173'], credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public auth routes
app.use('/api/auth', authRouter);

// Protected routes
app.use('/api/users', usersRouter);
app.use('/api/pronostics', authenticate, pronosticsRouter);
app.use('/api/results', authenticate, resultsRouter);
app.use('/api/subscribers', authenticate, subscribersRouter);
app.use('/api/plans', authenticate, plansRouter);
app.use('/api/sms', authenticate, smsRouter);
app.use('/api/dashboard', authenticate, dashboardRouter);
app.use('/api/settings', authenticate, settingsRouter);
app.use('/api/sports', authenticate, sportsRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.PORT, () => {
  logger.info(`Backend API running on http://0.0.0.0:${env.PORT}`);
});

export default app;
