import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { inventoryItems } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const router = new Hono<{ Bindings: Env }>();

// List my inventory
router.get('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, auth.userId))
    .orderBy(desc(inventoryItems.createdAt))
    .all();

  return c.json({ data: rows });
});

// Create inventory item
const createSchema = z.object({
  ingredientType: z.enum(['fermentable', 'hop', 'culture', 'misc']),
  ingredientId: z.string().optional(),
  customName: z.string().min(1).optional(),
  amount: z.number().positive(),
  unit: z.string().min(1),
  costPerUnit: z.number().nonnegative().optional(),
  costCurrency: z.string().default('GBP'),
  supplier: z.string().optional(),
  purchaseDate: z.string().optional(),
});

router.post('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = createSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;
  const id = `inv-${crypto.randomUUID()}`;

  await db.insert(inventoryItems).values({
    id,
    userId: auth.userId,
    ...body,
    updatedAt: new Date(),
  });

  const [created] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).all();
  return c.json({ data: created }, 201);
});

// Update inventory item
const updateSchema = createSchema.partial();

router.put('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const parse = updateSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const [existing] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).all();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db
    .update(inventoryItems)
    .set({ ...parse.data, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));

  const [updated] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).all();
  return c.json({ data: updated });
});

// Delete inventory item
router.delete('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).all();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
  return c.json({ success: true });
});

export default router;
