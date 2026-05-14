import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client';
import type { Env } from '../db/client';
import { recipes } from '../db/schema';
import { clerkAuth, optionalAuth } from '../middleware/auth';

const recipeRouter = new Hono<{ Bindings: Env }>();

// List my recipes
recipeRouter.get('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(recipes)
    .where(eq(recipes.userId, auth.userId))
    .orderBy(desc(recipes.createdAt))
    .all();

  return c.json({ data: rows });
});

// Get public recipes
recipeRouter.get('/public', async (c) => {
  const db = createDb(c.env.DB);

  const rows = await db
    .select()
    .from(recipes)
    .where(eq(recipes.isPublic, true))
    .orderBy(desc(recipes.createdAt))
    .limit(50)
    .all();

  return c.json({ data: rows });
});

// Get single recipe
recipeRouter.get('/:id', optionalAuth, async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param('id');
  const auth = c.get('auth');

  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).all();

  if (!row) return c.json({ error: 'Recipe not found' }, 404);
  if (!row.isPublic && row.userId !== auth?.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json({ data: row });
});

// Create recipe
const createRecipeSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  styleId: z.string().optional(),
  styleName: z.string().optional(),
  type: z.enum(['all grain', 'extract', 'partial mash', 'other']).default('all grain'),
  batchSizeL: z.number().positive(),
  efficiencyPct: z.number().int().min(1).max(100).default(75),
  fermentables: z.array(z.any()).default([]),
  hops: z.array(z.any()).default([]),
  cultures: z.array(z.any()).default([]),
  process: z.record(z.any()).optional(),
  waterProfile: z.record(z.any()).optional(),
  estimatedOg: z.number().positive(),
  estimatedFg: z.number().positive(),
  estimatedAbvPct: z.number().positive(),
  estimatedIbu: z.number().int().nonnegative(),
  estimatedSrm: z.number().nonnegative(),
  estimatedEbc: z.number().nonnegative().optional(),
  isPublic: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

recipeRouter.post('/', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');

  const parse = createRecipeSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;
  const id = `recipe-${crypto.randomUUID()}`;

  await db.insert(recipes).values({
    id,
    userId: auth.userId,
    ...body,
    updatedAt: new Date(),
  });

  const [created] = await db.select().from(recipes).where(eq(recipes.id, id)).all();
  return c.json({ data: created }, 201);
});

// Update recipe
const updateRecipeSchema = createRecipeSchema.partial();

recipeRouter.put('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const parse = updateRecipeSchema.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'Invalid input', details: parse.error.flatten() }, 400);
  }

  const body = parse.data;

  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id)).all();
  if (!existing) return c.json({ error: 'Recipe not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db
    .update(recipes)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(recipes.id, id));

  const [updated] = await db.select().from(recipes).where(eq(recipes.id, id)).all();
  return c.json({ data: updated });
});

// Delete recipe
recipeRouter.delete('/:id', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id)).all();
  if (!existing) return c.json({ error: 'Recipe not found' }, 404);
  if (existing.userId !== auth.userId) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(recipes).where(eq(recipes.id, id));
  return c.json({ success: true });
});

// Fork a recipe
recipeRouter.post('/:id/fork', clerkAuth, async (c) => {
  const db = createDb(c.env.DB);
  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id)).all();
  if (!existing) return c.json({ error: 'Recipe not found' }, 404);
  if (!existing.isPublic && existing.userId !== auth.userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const newId = `recipe-${crypto.randomUUID()}`;
  const forked = {
    ...existing,
    id: newId,
    userId: auth.userId,
    name: `${existing.name} (fork)`,
    isPublic: false,
    forkedFromId: existing.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Remove the primary key constraint from the spread by destructuring
  const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, forkedFromId, ...rest } = existing;

  await db.insert(recipes).values({
    id: newId,
    userId: auth.userId,
    name: `${existing.name} (fork)`,
    description: rest.description,
    styleId: rest.styleId,
    styleName: rest.styleName,
    type: rest.type,
    batchSizeL: rest.batchSizeL,
    efficiencyPct: rest.efficiencyPct,
    fermentables: rest.fermentables,
    hops: rest.hops,
    cultures: rest.cultures,
    process: rest.process,
    waterProfile: rest.waterProfile,
    estimatedOg: rest.estimatedOg,
    estimatedFg: rest.estimatedFg,
    estimatedAbvPct: rest.estimatedAbvPct,
    estimatedIbu: rest.estimatedIbu,
    estimatedSrm: rest.estimatedSrm,
    estimatedEbc: rest.estimatedEbc,
    isPublic: false,
    isTemplate: false,
    templateId: rest.templateId,
    tags: rest.tags,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [created] = await db.select().from(recipes).where(eq(recipes.id, newId)).all();
  return c.json({ data: created }, 201);
});

export default recipeRouter;
