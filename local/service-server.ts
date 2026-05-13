import express from 'express';
import { dispatch } from '../src/handlers/service/service.handler.js';
import { PixiCredError, toHttpStatus } from '../src/lib/errors.js';
import type { ServiceAction } from '../src/types/index.js';

const app = express();
app.use(express.json());

app.post('/', async (req, res) => {
  try {
    const result = await dispatch(req.body as ServiceAction);
    res.json({ data: result });
  } catch (err) {
    if (err instanceof PixiCredError) {
      res.status(toHttpStatus(err.code)).json({ error: { code: err.code, message: err.message } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
    }
  }
});

const PORT = parseInt(process.env['SERVICE_PORT'] ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`Service server listening on port ${PORT}`);
});
