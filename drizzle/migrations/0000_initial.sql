-- Initial schema for TUN BrewLab

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  style_id TEXT,
  style_name TEXT,
  type TEXT NOT NULL DEFAULT 'all grain',
  batch_size_l REAL NOT NULL,
  efficiency_pct INTEGER NOT NULL DEFAULT 75,
  fermentables TEXT NOT NULL,
  hops TEXT NOT NULL,
  cultures TEXT NOT NULL,
  process TEXT,
  water_profile TEXT,
  estimated_og REAL NOT NULL,
  estimated_fg REAL NOT NULL,
  estimated_abv_pct REAL NOT NULL,
  estimated_ibu INTEGER NOT NULL,
  estimated_srm REAL NOT NULL,
  estimated_ebc REAL,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  template_id TEXT,
  tags TEXT DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_public ON recipes(is_public);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  recipe_snapshot TEXT NOT NULL,
  started_at INTEGER,
  estimated_ready_at INTEGER,
  completed_at INTEGER,
  predicted_curve TEXT,
  water_chemistry TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_batches_user ON batches(user_id);
CREATE INDEX IF NOT EXISTS idx_batches_recipe ON batches(recipe_id);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  note TEXT,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_measurements_batch ON measurements(batch_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_notes_batch ON notes(batch_id);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  caption TEXT,
  taken_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_photos_batch ON photos(batch_id);
