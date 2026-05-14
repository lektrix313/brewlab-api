-- Add inventory, shopping list, and batch cost tables

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_type TEXT NOT NULL,
  ingredient_id TEXT,
  custom_name TEXT,
  amount REAL NOT NULL,
  unit TEXT NOT NULL,
  cost_per_unit REAL,
  cost_currency TEXT DEFAULT 'GBP',
  supplier TEXT,
  purchase_date TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ingredient ON inventory_items(ingredient_id);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_type TEXT NOT NULL,
  ingredient_id TEXT,
  custom_name TEXT,
  amount_needed REAL NOT NULL,
  unit TEXT NOT NULL,
  purchased INTEGER NOT NULL DEFAULT 0,
  linked_inventory_item_id TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_user ON shopping_list_items(user_id);

CREATE TABLE IF NOT EXISTS batch_costs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_cost REAL NOT NULL,
  currency TEXT DEFAULT 'GBP',
  cost_breakdown_json TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

ALTER TABLE recipes ADD COLUMN forked_from_id TEXT;

CREATE INDEX IF NOT EXISTS idx_batch_costs_batch ON batch_costs(batch_id);
