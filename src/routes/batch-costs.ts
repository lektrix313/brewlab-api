import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { batchCosts, inventoryItems, batches } from '../db/schema';
import { clerkAuth } from '../middleware/auth';

const router = new Hono<{ Bindings: Env }>();

// Get batch cost
router.get('/:batchId', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const batchId = c.req.param('batchId');

  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId)).all();
  if (!batch) return c.json({ error: 'Batch not found' }, 404);
  if (batch.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  const [cost] = await db
    .select()
    .from(batchCosts)
    .where(eq(batchCosts.batchId, batchId))
    .all();

  return c.json({ data: cost ?? null });
});

// Calculate / recalculate batch cost from inventory
router.post('/:batchId/calculate', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const batchId = c.req.param('batchId');

  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId)).all();
  if (!batch) return c.json({ error: 'Batch not found' }, 404);
  if (batch.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  const inventory = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, auth.userId))
    .all();

  const snapshot = batch.recipeSnapshot as Record<string, any>;
  const fermentables: Array<Record<string, any>> = snapshot.fermentables ?? [];
  const hops: Array<Record<string, any>> = snapshot.hops ?? [];
  const cultures: Array<Record<string, any>> = snapshot.cultures ?? [];

  const breakdown: Array<{
    ingredientName: string;
    amount: number;
    unit: string;
    costPerUnit: number;
    lineTotal: number;
  }> = [];

  let totalCost = 0;

  function findInventoryItem(ingredientId?: string, customName?: string, type?: string) {
    if (ingredientId) {
      return inventory.find(
        (i) => i.ingredientId === ingredientId && i.ingredientType === type
      );
    }
    if (customName) {
      return inventory.find(
        (i) => i.customName?.toLowerCase() === customName.toLowerCase() && i.ingredientType === type
      );
    }
    return undefined;
  }

  function addLine(name: string, amount: number, unit: string, type: string, ingredientId?: string) {
    const inv = findInventoryItem(ingredientId, name, type);
    const costPerUnit = inv?.costPerUnit ?? 0;
    const lineTotal = costPerUnit * amount;
    breakdown.push({ ingredientName: name, amount, unit, costPerUnit, lineTotal });
    totalCost += lineTotal;
  }

  for (const f of fermentables) {
    const name = f.fermentable?.name ?? f.customName ?? 'Unknown grain';
    const amountKg = f.amount_kg ?? f.amountKg ?? 0;
    addLine(name, amountKg, 'kg', 'fermentable', f.fermentable_id ?? f.fermentableId);
  }

  for (const h of hops) {
    const name = h.hop?.name ?? h.customName ?? 'Unknown hop';
    const amountG = h.amount_g ?? h.amountG ?? 0;
    addLine(name, amountG, 'g', 'hop', h.hop_id ?? h.hopId);
  }

  for (const y of cultures) {
    const name = y.culture?.name ?? y.customName ?? 'Unknown yeast';
    const amount = y.amount_g_or_ml ?? y.amountGOrMl ?? 0;
    addLine(name, amount, 'g/ml', 'culture', y.culture_id ?? y.cultureId);
  }

  const costId = `cost-${crypto.randomUUID()}`;

  await db.insert(batchCosts).values({
    id: costId,
    batchId,
    userId: auth.userId,
    totalCost,
    currency: 'GBP',
    costBreakdownJson: breakdown,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: batchCosts.id,
    set: {
      totalCost,
      costBreakdownJson: breakdown,
      updatedAt: new Date(),
    },
  });

  // Upsert by batchId instead — D1 doesn't support onConflictDoUpdate with composite keys well,
  // so we delete existing and insert new.
  const existingCosts = await db
    .select()
    .from(batchCosts)
    .where(eq(batchCosts.batchId, batchId))
    .all();

  for (const ec of existingCosts) {
    await db.delete(batchCosts).where(eq(batchCosts.id, ec.id));
  }

  await db.insert(batchCosts).values({
    id: costId,
    batchId,
    userId: auth.userId,
    totalCost,
    currency: 'GBP',
    costBreakdownJson: breakdown,
    updatedAt: new Date(),
  });

  return c.json({
    data: {
      id: costId,
      batchId,
      totalCost,
      currency: 'GBP',
      costBreakdownJson: breakdown,
    },
  });
});

export default router;
