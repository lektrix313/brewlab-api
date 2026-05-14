import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  styleId: text('style_id'),
  styleName: text('style_name'),
  type: text('type').notNull().default('all grain'),
  batchSizeL: real('batch_size_l').notNull(),
  efficiencyPct: integer('efficiency_pct').notNull().default(75),

  // Complex data stored as JSON
  fermentables: text('fermentables', { mode: 'json' }).notNull(),
  hops: text('hops', { mode: 'json' }).notNull(),
  cultures: text('cultures', { mode: 'json' }).notNull(),
  process: text('process', { mode: 'json' }),
  waterProfile: text('water_profile', { mode: 'json' }),

  // Calculated stats
  estimatedOg: real('estimated_og').notNull(),
  estimatedFg: real('estimated_fg').notNull(),
  estimatedAbvPct: real('estimated_abv_pct').notNull(),
  estimatedIbu: integer('estimated_ibu').notNull(),
  estimatedSrm: real('estimated_srm').notNull(),
  estimatedEbc: real('estimated_ebc'),

  // Meta
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
  templateId: text('template_id'),
  forkedFromId: text('forked_from_id'),
  tags: text('tags', { mode: 'json' }).$defaultFn(() => []),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recipeId: text('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('planned'),

  // Full recipe snapshot at brew time
  recipeSnapshot: text('recipe_snapshot', { mode: 'json' }).notNull(),

  // Fermentation
  startedAt: integer('started_at', { mode: 'timestamp' }),
  estimatedReadyAt: integer('estimated_ready_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  predictedCurve: text('predicted_curve', { mode: 'json' }),

  // Water chemistry at brew time
  waterChemistry: text('water_chemistry', { mode: 'json' }),

  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const measurements = sqliteTable('measurements', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // gravity | temperature | ph | volume
  value: real('value').notNull(),
  unit: text('unit'),
  note: text('note'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  r2Key: text('r2_key').notNull(),
  caption: text('caption'),
  takenAt: integer('taken_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const inventoryItems = sqliteTable('inventory_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ingredientType: text('ingredient_type').notNull(), // fermentable | hop | culture | misc
  ingredientId: text('ingredient_id'),
  customName: text('custom_name'),
  amount: real('amount').notNull(),
  unit: text('unit').notNull(), // kg | g | l | ml | unit | pack
  costPerUnit: real('cost_per_unit'),
  costCurrency: text('cost_currency').default('GBP'),
  supplier: text('supplier'),
  purchaseDate: text('purchase_date'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const shoppingListItems = sqliteTable('shopping_list_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ingredientType: text('ingredient_type').notNull(),
  ingredientId: text('ingredient_id'),
  customName: text('custom_name'),
  amountNeeded: real('amount_needed').notNull(),
  unit: text('unit').notNull(),
  purchased: integer('purchased', { mode: 'boolean' }).notNull().default(false),
  linkedInventoryItemId: text('linked_inventory_item_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const batchCosts = sqliteTable('batch_costs', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull().references(() => batches.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  totalCost: real('total_cost').notNull(),
  currency: text('currency').default('GBP'),
  costBreakdownJson: text('cost_breakdown_json', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Types inferred from schema
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type InsertRecipe = typeof recipes.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type InsertBatch = typeof batches.$inferInsert;
export type Measurement = typeof measurements.$inferSelect;
export type InsertMeasurement = typeof measurements.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type InsertNote = typeof notes.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type InsertPhoto = typeof photos.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
export type InsertShoppingListItem = typeof shoppingListItems.$inferInsert;
export type BatchCost = typeof batchCosts.$inferSelect;
export type InsertBatchCost = typeof batchCosts.$inferInsert;
