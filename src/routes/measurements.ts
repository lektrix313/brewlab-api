import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { measurements, batches } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const measurementRouter = new Hono<{ Bindings: Env }>();

// List measurements for a batch
measurementRouter.get('/batch/:batchId', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const batchId = c.req.param('batchId');

  // Verify batch ownership
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId)).all();
  if (!batch) return c.json({ error: 'Batch not found' }, 404);
  if (batch.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  const rows = await db
    .select()
    .from(measurements)
    .where(eq(measurements.batchId, batchId))
    .orderBy(desc(measurements.recordedAt))
    .all();

  return c.json({ data: rows });
});

// Add measurement
const createMeasurementSchema = z.object({
  type: z.enum(['gravity', 'temperature', 'ph', 'volume']),
  value: z.number(),
  unit: z.string().optional(),
  note: z.string().max(500).optional(),
  recordedAt: z.string().datetime().optional(),
});

measurementRouter.post('/batch/:batchId', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const batchId = c.req.param('batchId');

  // Verify batch ownership
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId)).all();
  if (!batch) return c.json({ error: 'Batch not found' }, 404);
  if (batch.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  const parse = createMeasurementSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;
  const id = `meas-${crypto.randomUUID()}`;

  await db.insert(measurements).values({
    id,
    batchId,
    type: body.type,
    value: body.value,
    unit: body.unit ?? null,
    note: body.note ?? null,
    recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
  });

  const [created] = await db.select().from(measurements).where(eq(measurements.id, id)).all();
  return c.json({ data: created }, 201);
});

// Delete measurement
measurementRouter.delete('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [meas] = await db.select().from(measurements).where(eq(measurements.id, id)).all();
  if (!meas) return c.json({ error: 'Measurement not found' }, 404);

  const [batch] = await db.select().from(batches).where(eq(batches.id, meas.batchId)).all();
  if (!batch || batch.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(measurements).where(eq(measurements.id, id));
  return c.json({ success: true });
});

export default measurementRouter;
