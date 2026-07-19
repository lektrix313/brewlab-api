import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { shoppingListItems } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const router = new Hono<{ Bindings: Env }>();

// List my shopping list
router.get('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.userId, auth.userId))
    .orderBy(desc(shoppingListItems.createdAt))
    .all();

  return c.json({ data: rows });
});

// Create shopping list item
const createSchema = z.object({
  ingredientType: z.enum(['fermentable', 'hop', 'culture', 'misc']),
  ingredientId: z.string().optional(),
  customName: z.string().min(1).optional(),
  amountNeeded: z.number().positive(),
  unit: z.string().min(1),
  purchased: z.boolean().default(false),
  linkedInventoryItemId: z.string().optional(),
});

router.post('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = createSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;
  const id = `shop-${crypto.randomUUID()}`;

  await db.insert(shoppingListItems).values({
    id,
    userId: auth.userId,
    ...body,
  });

  const [created] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
  return c.json({ data: created }, 201);
});

// Update shopping list item
const updateSchema = createSchema.partial();

router.put('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const parse = updateSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const [existing] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db
    .update(shoppingListItems)
    .set({ ...parse.data, updatedAt: new Date() })
    .where(eq(shoppingListItems.id, id));

  const [updated] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
  return c.json({ data: updated });
});

// Delete shopping list item
router.delete('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(shoppingListItems).where(eq(shoppingListItems.id, id));
  return c.json({ success: true });
});

// Clear all purchased items
router.post('/clear-purchased', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  await db
    .delete(shoppingListItems)
    .where(and(
      eq(shoppingListItems.userId, auth.userId),
      eq(shoppingListItems.purchased, true)
    ));

  return c.json({ success: true });
});

export default router;
