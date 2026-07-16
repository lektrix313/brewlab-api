import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './db/client';

import recipeRouter from './routes/recipes';
import batchRouter from './routes/batches';
import measurementRouter from './routes/measurements';
import syncRouter from './routes/sync';
import inventoryRouter from './routes/inventory';
import shoppingListRouter from './routes/shopping-list';
import batchCostRouter from './routes/batch-costs';
import communityRouter from './routes/community';
import socialRouter from './routes/social';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use(logger());
app.use(cors({
  origin: [
    'http://localhost:8081',     // Expo dev client
    'http://localhost:19006',    // Expo web
    'https://tun.brewlab.app',   // Production
    'https://tun-app.pages.dev', // Cloudflare Pages
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check
app.get('/', (c) => c.json({
  name: 'TUN BrewLab API',
  version: '0.1.0',
  status: 'ok',
  env: c.env.CLERK_PUBLISHABLE_KEY ? 'configured' : 'unconfigured',
}));

// API routes
app.route('/recipes', recipeRouter);
app.route('/batches', batchRouter);
app.route('/measurements', measurementRouter);
app.route('/sync', syncRouter);
app.route('/inventory', inventoryRouter);
app.route('/shopping-list', shoppingListRouter);
app.route('/batch-costs', batchCostRouter);
app.route('/community', communityRouter);
app.route('/community', socialRouter);

// Error handling
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  console.error(JSON.stringify({
    event: 'unhandled_error',
    requestId,
    method: c.req.method,
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }));
  return c.json({ error: 'Internal server error', requestId }, 500);
});

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
