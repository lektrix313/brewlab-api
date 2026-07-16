CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  handle_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Community brewer',
  avatar_url TEXT,
  bio TEXT,
  location_label TEXT,
  experience TEXT NOT NULL DEFAULT 'starting',
  favourite_styles TEXT NOT NULL DEFAULT '[]',
  is_private INTEGER NOT NULL DEFAULT 0,
  show_connection_lists INTEGER NOT NULL DEFAULT 1,
  default_post_visibility TEXT NOT NULL DEFAULT 'public',
  comment_permission TEXT NOT NULL DEFAULT 'everyone',
  mention_permission TEXT NOT NULL DEFAULT 'everyone',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  notify_posts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  accepted_at INTEGER,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS user_moderation_edges (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (actor_id, subject_id, kind),
  CHECK (actor_id <> subject_id)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

ALTER TABLE community_posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE community_posts ADD COLUMN comment_permission TEXT NOT NULL DEFAULT 'viewers';
ALTER TABLE community_posts ADD COLUMN source_post_id TEXT;
ALTER TABLE community_posts ADD COLUMN source_author_id TEXT;
ALTER TABLE community_posts ADD COLUMN change_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle_normalized);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actor ON user_moderation_edges(actor_id, subject_id, kind);
CREATE INDEX IF NOT EXISTS idx_activity_recipient ON activity_events(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_author_visibility ON community_posts(author_id, visibility, created_at DESC);
