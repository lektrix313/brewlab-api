import { Hono } from 'hono';
import { eq, gte, and } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { recipes, batches, measurements, notes, photos, inventoryItems, shoppingListItems, syncTombstones } from '../db/schema';
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

  const [userRecipes, userBatches, userMeasurements, userNotes, userPhotos, userInventory, userShoppingList, userTombstones] = await Promise.all([
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
      .where(and(eq(shoppingListItems.userId, userId), gte(shoppingListItems.updatedAt, since)))
      .all(),
    db
      .select()
      .from(syncTombstones)
      .where(and(eq(syncTombstones.userId, userId), gte(syncTombstones.deletedAt, since)))
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
      deletedRecipeIds: userTombstones.filter((item) => item.entityType === 'recipe').map((item) => item.entityId),
      deletedBatchIds: userTombstones.filter((item) => item.entityType === 'batch').map((item) => item.entityId),
      deletedInventoryIds: userTombstones.filter((item) => item.entityType === 'inventory').map((item) => item.entityId),
      deletedShoppingListIds: userTombstones.filter((item) => item.entityType === 'shoppingList').map((item) => item.entityId),
      syncedAt: new Date().toISOString(),
    },
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
  deletedRecipeIds: z.array(z.string()).default([]),
  deletedBatchIds: z.array(z.string()).default([]),
  deletedInventoryIds: z.array(z.string()).default([]),
  deletedShoppingListIds: z.array(z.string()).default([]),
});

syncRouter.post('/push', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = pushSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const {
    recipes: recipeOps,
    batches: batchOps,
    measurements: measurementOps,
    inventory: inventoryOps,
    shoppingList: shoppingListOps,
    deletedRecipeIds,
    deletedBatchIds,
    deletedInventoryIds,
    deletedShoppingListIds,
  } = parse.data;

  if (recipeOps.length > 0) {
    for (const r of recipeOps) {
      const existing = await db.select().from(recipes).where(eq(recipes.id, r.id)).get();
      if (existing && existing.userId !== auth.userId) {
        return c.json({ error: 'Forbidden recipe id', id: r.id }, 403);
      }

      const safeRecipe = { ...r, userId: auth.userId, updatedAt: new Date() };
      if (existing) {
        await db.update(recipes).set(safeRecipe as any).where(and(eq(recipes.id, r.id), eq(recipes.userId, auth.userId)));
      } else {
        await db.insert(recipes).values(safeRecipe as any);
      }
    }
  }

  if (batchOps.length > 0) {
    for (const b of batchOps) {
      const existing = await db.select().from(batches).where(eq(batches.id, b.id)).get();
      if (existing && existing.userId !== auth.userId) {
        return c.json({ error: 'Forbidden batch id', id: b.id }, 403);
      }

      const safeBatch = { ...b, userId: auth.userId, updatedAt: new Date() };
      if (existing) {
        await db.update(batches).set(safeBatch as any).where(and(eq(batches.id, b.id), eq(batches.userId, auth.userId)));
      } else {
        await db.insert(batches).values(safeBatch as any);
      }
    }
  }

  if (measurementOps.length > 0) {
    for (const m of measurementOps) {
      const batch = await db.select().from(batches).where(eq(batches.id, m.batchId)).get();
      if (!batch || batch.userId !== auth.userId) {
        return c.json({ error: 'Forbidden measurement batch', id: m.id, batchId: m.batchId }, 403);
      }

      const existingRows = await db
        .select({ measurement: measurements, batch: batches })
        .from(measurements)
        .innerJoin(batches, eq(measurements.batchId, batches.id))
        .where(eq(measurements.id, m.id))
        .all();
      const existing = existingRows[0];
      if (existing && existing.batch.userId !== auth.userId) {
        return c.json({ error: 'Forbidden measurement id', id: m.id }, 403);
      }

      if (existing) {
        await db.update(measurements).set(m as any).where(eq(measurements.id, m.id));
      } else {
        await db.insert(measurements).values(m as any);
      }
    }
  }

  if (inventoryOps.length > 0) {
    for (const item of inventoryOps) {
      const existing = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id)).get();
      if (existing && existing.userId !== auth.userId) {
        return c.json({ error: 'Forbidden inventory id', id: item.id }, 403);
      }

      const safeItem = { ...item, userId: auth.userId, updatedAt: new Date() };
      if (existing) {
        await db.update(inventoryItems).set(safeItem as any).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.userId, auth.userId)));
      } else {
        await db.insert(inventoryItems).values(safeItem as any);
      }
    }
  }

  if (shoppingListOps.length > 0) {
    for (const item of shoppingListOps) {
      const existing = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, item.id)).get();
      if (existing && existing.userId !== auth.userId) {
        return c.json({ error: 'Forbidden shopping list id', id: item.id }, 403);
      }

      const safeItem = { ...item, userId: auth.userId, updatedAt: new Date() };
      if (existing) {
        await db.update(shoppingListItems).set(safeItem as any).where(and(eq(shoppingListItems.id, item.id), eq(shoppingListItems.userId, auth.userId)));
      } else {
        await db.insert(shoppingListItems).values(safeItem as any);
      }
    }
  }

  async function deleteWithTombstone(
    entityType: 'recipe' | 'batch' | 'inventory' | 'shoppingList',
    ids: string[],
    table: typeof recipes | typeof batches | typeof inventoryItems | typeof shoppingListItems,
  ) {
    for (const id of ids) {
      const existing = await db.select().from(table as any).where(eq((table as any).id, id)).get() as { userId?: string } | undefined;
      if (!existing) continue;
      if (existing.userId !== auth.userId) {
        throw new Error(`Forbidden ${entityType} id`);
      }
      await db.delete(table as any).where(and(eq((table as any).id, id), eq((table as any).userId, auth.userId)));
      await db.insert(syncTombstones).values({
        id: `${auth.userId}:${entityType}:${id}`,
        userId: auth.userId,
        entityType,
        entityId: id,
        deletedAt: new Date(),
      }).onConflictDoUpdate({
        target: syncTombstones.id,
        set: { deletedAt: new Date() },
      });
    }
  }

  try {
    await deleteWithTombstone('recipe', deletedRecipeIds, recipes);
    await deleteWithTombstone('batch', deletedBatchIds, batches);
    await deleteWithTombstone('inventory', deletedInventoryIds, inventoryItems);
    await deleteWithTombstone('shoppingList', deletedShoppingListIds, shoppingListItems);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Forbidden delete id' }, 403);
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
      deletedRecipes: deletedRecipeIds.length,
      deletedBatches: deletedBatchIds.length,
      deletedInventory: deletedInventoryIds.length,
      deletedShoppingList: deletedShoppingListIds.length,
    },
  });
});

export default syncRouter;
