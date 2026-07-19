ALTER TABLE shopping_list_items ADD COLUMN updated_at INTEGER;

UPDATE shopping_list_items
SET updated_at = COALESCE(created_at, unixepoch() * 1000)
WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_tombstones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_tombstone_entity
ON sync_tombstones(user_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_sync_tombstone_since
ON sync_tombstones(user_id, deleted_at);
