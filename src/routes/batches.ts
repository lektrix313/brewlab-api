import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { batches } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const batchRouter = new Hono<{ Bindings: Env }>();

// List my batches
batchRouter.get('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(batches)
    .where(eq(batches.userId, auth.userId))
    .orderBy(desc(batches.createdAt))
    .all();

  return c.json({ data: rows });
});

// Get single batch
batchRouter.get('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [row] = await db.select().from(batches).where(eq(batches.id, id)).all();

  if (!row) return c.json({ error: 'Batch not found' }, 404);
  if (row.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  return c.json({ data: row });
});

// Create batch
const createBatchSchema = z.object({
  recipeId: z.string().optional(),
  name: z.string().min(1).max(200),
  status: z.string().default('planned'),
  recipeSnapshot: z.record(z.any()),
  startedAt: z.string().datetime().optional(),
  estimatedReadyAt: z.string().datetime().optional(),
  predictedCurve: z.array(z.record(z.any())).optional(),
  waterChemistry: z.record(z.any()).optional(),
  isPublic: z.boolean().default(false),
});

batchRouter.post('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = createBatchSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;
  const id = `batch-${crypto.randomUUID()}`;

  await db.insert(batches).values({
    id,
    userId: auth.userId,
    recipeId: body.recipeId ?? null,
    name: body.name,
    status: body.status,
    recipeSnapshot: body.recipeSnapshot,
    startedAt: body.startedAt ? new Date(body.startedAt) : null,
    estimatedReadyAt: body.estimatedReadyAt ? new Date(body.estimatedReadyAt) : null,
    predictedCurve: body.predictedCurve ?? null,
    waterChemistry: body.waterChemistry ?? null,
    isPublic: body.isPublic,
    updatedAt: new Date(),
  });

  const [created] = await db.select().from(batches).where(eq(batches.id, id)).all();
  return c.json({ data: created }, 201);
});

// Update batch status / metadata
const updateBatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  estimatedReadyAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  packagedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  batchSerial: z.string().max(40).optional(),
  communityPostId: z.string().max(100).optional(),
  predictedCurve: z.array(z.record(z.any())).optional(),
  isPublic: z.boolean().optional(),
}).partial();

batchRouter.put('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const parse = updateBatchSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;

  const [existing] = await db.select().from(batches).where(eq(batches.id, id)).all();
  if (!existing) return c.json({ error: 'Batch not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  const updateData: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.startedAt !== undefined) updateData.startedAt = body.startedAt ? new Date(body.startedAt) : null;
  if (body.estimatedReadyAt !== undefined) updateData.estimatedReadyAt = body.estimatedReadyAt ? new Date(body.estimatedReadyAt) : null;
  if (body.completedAt !== undefined) updateData.completedAt = body.completedAt ? new Date(body.completedAt) : null;
  if (body.packagedAt !== undefined) updateData.packagedAt = body.packagedAt ? new Date(body.packagedAt) : null;
  if (body.finishedAt !== undefined) updateData.finishedAt = body.finishedAt ? new Date(body.finishedAt) : null;
  if (body.batchSerial !== undefined) updateData.batchSerial = body.batchSerial;
  if (body.communityPostId !== undefined) updateData.communityPostId = body.communityPostId;

  await db.update(batches).set(updateData).where(eq(batches.id, id));

  const [updated] = await db.select().from(batches).where(eq(batches.id, id)).all();
  return c.json({ data: updated });
});

// Delete batch
batchRouter.delete('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db.select().from(batches).where(eq(batches.id, id)).all();
  if (!existing) return c.json({ error: 'Batch not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(batches).where(eq(batches.id, id));
  return c.json({ success: true });
});

export default batchRouter;
