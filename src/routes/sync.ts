import { Hono } from 'hono';
import { eq, gte, and } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { recipes, batches, measurements, notes, photos, inventoryItems, shoppingListItems } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const syncRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /sync?since=ISO8601
 *
 * Returns all user's data that has been created or updated since the given timestamp.
 * If no `since` param, returns everything.
 *
 * This is the primary sync endpoint for the mobile app.
 */
syncRouter.get('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(0);

  const userId = auth.userId;

  const [userRecipes, userBatches, userMeasurements, userNotes, userPhotos, userInventory, userShoppingList] = await Promise.all([
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.userId, userId), gte(recipes.updatedAt, since)))
      .all(),
    db
      .select()
      .from(batches)
      .where(and(eq(batches.userId, userId), gte(batches.updatedAt, since)))
      .all(),
    db
      .select()
      .from(measurements)
      .innerJoin(batches, eq(measurements.batchId, batches.id))
      .where(and(eq(batches.userId, userId), gte(measurements.createdAt, since)))
      .all()
      .then((rows) => rows.map((r) => r.measurements)),
    db
      .select()
      .from(notes)
      .innerJoin(batches, eq(notes.batchId, batches.id))
      .where(and(eq(batches.userId, userId), gte(notes.createdAt, since)))
      .all()
      .then((rows) => rows.map((r) => r.notes)),
    db
      .select()
      .from(photos)
      .innerJoin(batches, eq(photos.batchId, batches.id))
      .where(and(eq(batches.userId, userId), gte(photos.createdAt, since)))
      .all()
      .then((rows) => rows.map((r) => r.photos)),
    db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.userId, userId), gte(inventoryItems.updatedAt, since)))
      .all(),
    db
      .select()
      .from(shoppingListItems)
      .where(and(eq(shoppingListItems.userId, userId), gte(shoppingListItems.createdAt, since)))
      .all(),
  ]);

  return c.json({
    data: {
      recipes: userRecipes,
      batches: userBatches,
      measurements: userMeasurements,
      notes: userNotes,
      photos: userPhotos,
      inventory: userInventory,
      shoppingList: userShoppingList,
    },
    syncedAt: new Date().toISOString(),
  });
});

/**
 * POST /sync/push
 *
 * Push local changes from the mobile app to the server.
 * Expects an array of operations.
 */
const pushSchema = z.object({
  recipes: z.array(z.record(z.any())).default([]),
  batches: z.array(z.record(z.any())).default([]),
  measurements: z.array(z.record(z.any())).default([]),
  inventory: z.array(z.record(z.any())).default([]),
  shoppingList: z.array(z.record(z.any())).default([]),
});

syncRouter.post('/push', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = pushSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const { recipes: recipeOps, batches: batchOps, measurements: measurementOps, inventory: inventoryOps, shoppingList: shoppingListOps } = parse.data;

  if (recipeOps.length > 0) {
    for (const r of recipeOps) {
      await db.insert(recipes).values({ ...r, userId: auth.userId } as any).onConflictDoUpdate({
        target: recipes.id,
        set: { ...r, updatedAt: new Date() },
      });
    }
  }

  if (batchOps.length > 0) {
    for (const b of batchOps) {
      await db.insert(batches).values({ ...b, userId: auth.userId } as any).onConflictDoUpdate({
        target: batches.id,
        set: { ...b, updatedAt: new Date() },
      });
    }
  }

  if (measurementOps.length > 0) {
    for (const m of measurementOps) {
      await db.insert(measurements).values(m as any).onConflictDoUpdate({
        target: measurements.id,
        set: m,
      });
    }
  }

  if (inventoryOps.length > 0) {
    for (const item of inventoryOps) {
      await db.insert(inventoryItems).values({ ...item, userId: auth.userId } as any).onConflictDoUpdate({
        target: inventoryItems.id,
        set: { ...item, updatedAt: new Date() },
      });
    }
  }

  if (shoppingListOps.length > 0) {
    for (const item of shoppingListOps) {
      await db.insert(shoppingListItems).values({ ...item, userId: auth.userId } as any).onConflictDoUpdate({
        target: shoppingListItems.id,
        set: item,
      });
    }
  }

  return c.json({
    success: true,
    syncedAt: new Date().toISOString(),
    counts: {
      recipes: recipeOps.length,
      batches: batchOps.length,
      measurements: measurementOps.length,
      inventory: inventoryOps.length,
      shoppingList: shoppingListOps.length,
    },
  });
});

export default syncRouter;
