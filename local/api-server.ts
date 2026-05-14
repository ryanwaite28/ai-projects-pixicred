import express, { type Request, type Response, type NextFunction } from 'express';
import { dispatch } from '../src/handlers/service/service.handler.js';
import { createSqsClient } from '../src/clients/sqs.client.js';
import { PixiCredError, toHttpStatus } from '../src/lib/errors.js';
import { validateBearerToken } from '../src/lib/jwt.js';
import type { ServiceAction } from '../src/types/index.js';

const app = express();
app.use(express.json());

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (_req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

const sqsClient = createSqsClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(res: Response, statusCode: number, data: unknown): void {
  res.status(statusCode).json({ data });
}

function sendErr(res: Response, error: PixiCredError): void {
  res.status(toHttpStatus(error.code)).json({ error: { code: error.code, message: error.message } });
}

function sendUnexpected(res: Response): void {
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
}

async function invoke<T>(action: ServiceAction, res: Response): Promise<T | null> {
  try {
    return (await dispatch(action)) as T;
  } catch (e) {
    if (e instanceof PixiCredError) { sendErr(res, e); return null; }
    sendUnexpected(res);
    return null;
  }
}

// ── JWT middleware ─────────────────────────────────────────────────────────

function requireJwt(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env['JWT_SECRET'] ?? '';
  try {
    const rawAuth = req.headers['authorization'];
    const authHeader: string | undefined = typeof rawAuth === 'string' ? rawAuth : undefined;
    const rawParam = req.params['accountId'];
    const accountIdStr = typeof rawParam === 'string' ? rawParam : (rawParam?.[0] ?? '');
    validateBearerToken(authHeader, accountIdStr, secret);
    next();
  } catch (e) {
    if (e instanceof PixiCredError) sendErr(res, e);
    else sendUnexpected(res);
  }
}

// ── Public routes ──────────────────────────────────────────────────────────

app.post('/applications', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await invoke({ action: 'submitApplication', payload: body as never }, res);
  if (result !== null) send(res, 201, result);
});

app.get('/applications/:applicationId', async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'getApplication', payload: { applicationId: req.params['applicationId'] as string } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.post('/auth/register', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { email, accountId, password } = body;
  if (!email || !accountId || !password) {
    sendErr(res, new PixiCredError('VALIDATION_ERROR', 'email, accountId, and password are required'));
    return;
  }
  if (typeof password === 'string' && password.length < 8) {
    sendErr(res, new PixiCredError('VALIDATION_ERROR', 'password must be at least 8 characters'));
    return;
  }
  const result = await invoke(
    { action: 'registerPortalAccount', payload: { email: email as string, accountId: accountId as string, password: password as string } },
    res,
  );
  if (result !== null) send(res, 201, result);
});

app.post('/auth/login', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { email, password } = body;
  if (!email || !password) {
    sendErr(res, new PixiCredError('VALIDATION_ERROR', 'email and password are required'));
    return;
  }
  const result = await invoke(
    { action: 'loginPortalAccount', payload: { email: email as string, password: password as string } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

// ── Account-scoped routes (JWT required) ──────────────────────────────────

app.get('/accounts/:accountId', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'getAccount', payload: { accountId: req.params['accountId'] as string } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.delete('/accounts/:accountId', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'closeAccount', payload: { accountId: req.params['accountId'] as string, reason: 'USER_REQUESTED' } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.post('/accounts/:accountId/transactions', requireJwt, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await invoke(
    { action: 'postCharge', payload: { accountId: req.params['accountId'] as string, ...body } as never },
    res,
  );
  if (result !== null) send(res, 201, result);
});

app.get('/accounts/:accountId/transactions', requireJwt, async (req: Request, res: Response) => {
  const { cursor, limit } = req.query;
  const result = await invoke(
    {
      action: 'getTransactions',
      payload: {
        accountId: req.params['accountId'] as string,
        ...(cursor ? { cursor: cursor as string } : {}),
        ...(limit ? { limit: parseInt(limit as string, 10) } : {}),
      },
    },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.post('/accounts/:accountId/payments', requireJwt, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await invoke(
    { action: 'postPayment', payload: { accountId: req.params['accountId'] as string, ...body } as never },
    res,
  );
  if (result !== null) send(res, 201, result);
});

app.get('/accounts/:accountId/statements', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'getStatements', payload: { accountId: req.params['accountId'] as string } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.get('/accounts/:accountId/statements/:statementId', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    {
      action: 'getStatement',
      payload: {
        accountId: req.params['accountId'] as string,
        statementId: req.params['statementId'] as string,
      },
    },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.post('/accounts/:accountId/statements', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'generateStatement', payload: { accountId: req.params['accountId'] as string } },
    res,
  );
  if (result !== null) send(res, 201, result);
});

app.get('/accounts/:accountId/notifications', requireJwt, async (req: Request, res: Response) => {
  const result = await invoke(
    { action: 'getNotificationPreferences', payload: { accountId: req.params['accountId'] as string } },
    res,
  );
  if (result !== null) send(res, 200, result);
});

app.patch('/accounts/:accountId/notifications', requireJwt, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await invoke(
    {
      action: 'updateNotificationPreferences',
      payload: { accountId: req.params['accountId'] as string, ...body } as never,
    },
    res,
  );
  if (result !== null) send(res, 200, result);
});

// ── Admin routes ──────────────────────────────────────────────────────────

app.post('/admin/billing-lifecycle', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  let lookaheadDays = 7;
  if (body['lookaheadDays'] !== undefined) {
    const raw = body['lookaheadDays'];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'lookaheadDays must be a positive integer' } });
      return;
    }
    lookaheadDays = raw;
  }
  const queueUrl = process.env['BILLING_LIFECYCLE_QUEUE_URL'] ?? '';
  await sqsClient.sendMessage(queueUrl, { lookaheadDays });
  res.status(202).json({ data: { queued: true, lookaheadDays } });
});

// ── 404 fallback ──────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

export { app };

// Auto-start when run directly (not imported by tests)
if (process.env['API_SERVER_NO_LISTEN'] !== 'true') {
  const PORT = parseInt(process.env['API_PORT'] ?? '3000', 10);
  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
  });
}
