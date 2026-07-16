ALTER TABLE batches ADD COLUMN packaged_at INTEGER;
ALTER TABLE batches ADD COLUMN finished_at INTEGER;
ALTER TABLE batches ADD COLUMN batch_serial TEXT;
ALTER TABLE batches ADD COLUMN community_post_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_user_serial ON batches(user_id, batch_serial) WHERE batch_serial IS NOT NULL;
