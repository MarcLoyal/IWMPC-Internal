import express from 'express';
import cookieParser from 'cookie-parser';
import { AppError } from './lib/errors';
import { requireUser } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import { accountsRouter, connectionsRouter } from './routes/accounts';
import { authRouter } from './routes/auth';
import { paymentsRouter } from './routes/payments';
import { reportsRouter } from './routes/reports';
import { areasRouter, settingsRouter } from './routes/settings';
import { usersRouter } from './routes/users';
import { waterRouter } from './routes/water';
import { productsRouter } from './routes/products';
import { salesRouter } from './routes/sales';
import { signaturesRouter } from './routes/signatures';
import { invoicesRouter } from './routes/invoices';
import { auditRouter } from './routes/audit';
import { loansRouter } from './routes/loans';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);

// Everything below needs a logged-in user. Role rules are set on each route.
app.use('/api', requireUser);
app.use('/api/accounts', accountsRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/areas', areasRouter);
app.use('/api/users', usersRouter);
app.use('/api/water', waterRouter);
app.use('/api/products', productsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/signatures', signaturesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/loans', loansRouter);

app.use('/api', (_req, _res, next) => next(new AppError(404, 'This page was not found.')));
app.use(errorHandler);
