ALTER TABLE profiles ADD COLUMN notify_follows INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN notify_followed_posts INTEGER NOT NULL DEFAULT 1;

-- Existing accepted relationships pre-date notification controls. Start useful,
-- with both a global switch and a per-brewer bell available to turn them off.
UPDATE follows SET notify_posts = 1 WHERE status = 'accepted';
