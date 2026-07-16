import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../db/client';
import { clerkAuth, optionalAuth } from '../middleware/auth';

type Row = Record<string, unknown>;
type Auth = { userId: string; email: string };

const social = new Hono<{ Bindings: Env; Variables: { auth?: Auth } }>();
const now = () => Date.now();
const iso = (value: unknown) => new Date(Number(value) || Date.now()).toISOString();
const json = <T>(value: unknown, fallback: T): T => {
  try { return (typeof value === 'string' ? JSON.parse(value) : value ?? fallback) as T; } catch { return fallback; }
};

function defaultHandle(userId: string) {
  const suffix = userId.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toLowerCase() || crypto.randomUUID().slice(0, 8);
  return `brewer.${suffix}`;
}

async function ensureProfile(env: Env, userId: string) {
  const existing = await env.DB.prepare('SELECT user_id FROM profiles WHERE user_id = ?').bind(userId).first();
  if (existing) return;
  const user = await env.DB.prepare('SELECT display_name, avatar_url FROM users WHERE id = ?').bind(userId).first<Row>();
  const handle = defaultHandle(userId);
  await env.DB.prepare(`INSERT OR IGNORE INTO profiles
    (user_id, handle, handle_normalized, display_name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(userId, handle, handle.toLowerCase(), user?.display_name || 'Community brewer', user?.avatar_url || null, now(), now()).run();
}

async function isBlocked(env: Env, first: string, second: string) {
  const row = await env.DB.prepare(`SELECT 1 FROM user_moderation_edges
    WHERE kind = 'block' AND ((actor_id = ? AND subject_id = ?) OR (actor_id = ? AND subject_id = ?)) LIMIT 1`)
    .bind(first, second, second, first).first();
  return Boolean(row);
}

async function relationship(env: Env, viewerId: string | undefined, subjectId: string) {
  if (!viewerId || viewerId === subjectId) {
    return { follows: false, followed_by: false, request_pending: false, is_mate: false, is_muted: false, is_restricted: false, is_blocked: false };
  }
  const [outgoing, incoming, edges] = await Promise.all([
    env.DB.prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?').bind(viewerId, subjectId).first<{ status: string }>(),
    env.DB.prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?').bind(subjectId, viewerId).first<{ status: string }>(),
    env.DB.prepare('SELECT actor_id, kind FROM user_moderation_edges WHERE (actor_id = ? AND subject_id = ?) OR (actor_id = ? AND subject_id = ?)')
      .bind(viewerId, subjectId, subjectId, viewerId).all<{ actor_id: string; kind: string }>(),
  ]);
  const ownEdges = (edges.results || []).filter((edge) => edge.actor_id === viewerId);
  const blocked = (edges.results || []).some((edge) => edge.kind === 'block');
  const follows = outgoing?.status === 'accepted';
  const followedBy = incoming?.status === 'accepted';
  return {
    follows,
    followed_by: followedBy,
    request_pending: outgoing?.status === 'pending',
    is_mate: follows && followedBy,
    is_muted: ownEdges.some((edge) => edge.kind === 'mute'),
    is_restricted: ownEdges.some((edge) => edge.kind === 'restrict'),
    is_blocked: blocked,
  };
}

async function shapeProfile(env: Env, row: Row, viewerId?: string) {
  const userId = String(row.user_id);
  const viewerRelationship = await relationship(env, viewerId, userId);
  const canSeeCounts = !row.is_private || viewerId === userId || viewerRelationship.follows;
  const counts = canSeeCounts
    ? await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM follows WHERE following_id = ? AND status = 'accepted') followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND status = 'accepted') following,
        (SELECT COUNT(*) FROM follows a JOIN follows b ON a.following_id = b.follower_id AND a.follower_id = b.following_id
          WHERE a.follower_id = ? AND a.status = 'accepted' AND b.status = 'accepted') mates,
        (SELECT COUNT(*) FROM community_posts WHERE author_id = ? AND visibility <> 'private') published_brews,
        (SELECT COUNT(*) FROM community_plans cp JOIN community_posts p ON p.id = cp.post_id WHERE p.author_id = ?) brewed_by_others`)
      .bind(userId, userId, userId, userId, userId).first<Row>()
    : {};
  return {
    user_id: userId,
    handle: row.handle,
    display_name: row.display_name,
    avatar_url: row.avatar_url || undefined,
    bio: row.bio || undefined,
    location_label: row.location_label || undefined,
    experience: row.experience,
    favourite_styles: json<string[]>(row.favourite_styles, []),
    is_private: Boolean(row.is_private),
    show_connection_lists: Boolean(row.show_connection_lists),
    default_post_visibility: row.default_post_visibility,
    comment_permission: row.comment_permission,
    mention_permission: row.mention_permission,
    counts: {
      followers: Number(counts?.followers || 0),
      following: Number(counts?.following || 0),
      mates: Number(counts?.mates || 0),
      published_brews: Number(counts?.published_brews || 0),
      brewed_by_others: Number(counts?.brewed_by_others || 0),
    },
    viewer_relationship: viewerRelationship,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

const profileSelect = 'SELECT * FROM profiles WHERE user_id = ?';

social.get('/profile', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await ensureProfile(c.env, auth.userId);
  const row = await c.env.DB.prepare(profileSelect).bind(auth.userId).first<Row>();
  return c.json({ data: await shapeProfile(c.env, row!, auth.userId) });
});

const updateProfile = z.object({
  handle: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9._]+$/).optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().trim().max(160).nullable().optional(),
  locationLabel: z.string().trim().max(80).nullable().optional(),
  experience: z.enum(['starting', 'developing', 'seasoned']).optional(),
  favouriteStyles: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
  isPrivate: z.boolean().optional(),
  showConnectionLists: z.boolean().optional(),
  defaultPostVisibility: z.enum(['public', 'followers', 'mates', 'private']).optional(),
  commentPermission: z.enum(['everyone', 'followers', 'mates', 'none']).optional(),
  mentionPermission: z.enum(['everyone', 'followers', 'mates', 'none']).optional(),
});

social.patch('/profile', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await ensureProfile(c.env, auth.userId);
  const parsed = updateProfile.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Invalid profile', details: parsed.error.flatten() }, 400);
  const body = parsed.data;
  const current = await c.env.DB.prepare(profileSelect).bind(auth.userId).first<Row>();
  const handle = body.handle ?? String(current!.handle);
  try {
    await c.env.DB.prepare(`UPDATE profiles SET handle = ?, handle_normalized = ?, display_name = ?, avatar_url = ?, bio = ?, location_label = ?, experience = ?, favourite_styles = ?, is_private = ?, show_connection_lists = ?, default_post_visibility = ?, comment_permission = ?, mention_permission = ?, updated_at = ? WHERE user_id = ?`)
      .bind(handle, handle.toLowerCase(), body.displayName ?? current!.display_name, body.avatarUrl === undefined ? current!.avatar_url : body.avatarUrl, body.bio === undefined ? current!.bio : body.bio, body.locationLabel === undefined ? current!.location_label : body.locationLabel, body.experience ?? current!.experience, JSON.stringify(body.favouriteStyles ?? json(current!.favourite_styles, [])), body.isPrivate === undefined ? Number(current!.is_private) : Number(body.isPrivate), body.showConnectionLists === undefined ? Number(current!.show_connection_lists) : Number(body.showConnectionLists), body.defaultPostVisibility ?? current!.default_post_visibility, body.commentPermission ?? current!.comment_permission, body.mentionPermission ?? current!.mention_permission, now(), auth.userId).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return c.json({ error: 'That handle is already taken' }, 409);
    throw error;
  }
  await c.env.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').bind(body.displayName ?? current!.display_name, body.avatarUrl === undefined ? current!.avatar_url : body.avatarUrl, auth.userId).run();
  const row = await c.env.DB.prepare(profileSelect).bind(auth.userId).first<Row>();
  return c.json({ data: await shapeProfile(c.env, row!, auth.userId) });
});

social.get('/profiles/:id', optionalAuth, async (c) => {
  const viewer = c.get('auth')?.userId;
  const id = c.req.param('id');
  if (viewer && await isBlocked(c.env, viewer, id)) return c.json({ error: 'Profile not found' }, 404);
  const row = await c.env.DB.prepare(profileSelect).bind(id).first<Row>();
  return row ? c.json({ data: await shapeProfile(c.env, row, viewer) }) : c.json({ error: 'Profile not found' }, 404);
});

social.get('/search', optionalAuth, async (c) => {
  const viewer = c.get('auth')?.userId;
  const query = (c.req.query('q') || '').trim().toLowerCase().slice(0, 60);
  if (!query) return c.json({ data: { items: [], cursor: null } });
  const result = await c.env.DB.prepare(`SELECT * FROM profiles p WHERE (p.handle_normalized LIKE ? OR lower(p.display_name) LIKE ?)
    AND NOT EXISTS (SELECT 1 FROM user_moderation_edges e WHERE e.kind = 'block' AND ((e.actor_id = ? AND e.subject_id = p.user_id) OR (e.actor_id = p.user_id AND e.subject_id = ?)))
    ORDER BY p.display_name LIMIT 30`).bind(`%${query}%`, `%${query}%`, viewer || '', viewer || '').all<Row>();
  return c.json({ data: { items: await Promise.all((result.results || []).map((row) => shapeProfile(c.env, row, viewer))), cursor: null } });
});

social.get('/suggestions', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  const result = await c.env.DB.prepare(`SELECT * FROM profiles p WHERE p.user_id <> ?
    AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = p.user_id)
    AND NOT EXISTS (SELECT 1 FROM user_moderation_edges e WHERE e.kind = 'block' AND ((e.actor_id = ? AND e.subject_id = p.user_id) OR (e.actor_id = p.user_id AND e.subject_id = ?)))
    ORDER BY (SELECT COUNT(*) FROM community_posts cp WHERE cp.author_id = p.user_id) DESC, p.created_at DESC LIMIT 6`)
    .bind(auth.userId, auth.userId, auth.userId, auth.userId).all<Row>();
  return c.json({ data: { items: await Promise.all((result.results || []).map((row) => shapeProfile(c.env, row, auth.userId))), cursor: null } });
});

social.post('/profiles/:id/follow', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  const targetId = c.req.param('id');
  if (targetId === auth.userId) return c.json({ error: 'You cannot follow yourself' }, 400);
  if (await isBlocked(c.env, auth.userId, targetId)) return c.json({ error: 'Profile not found' }, 404);
  const target = await c.env.DB.prepare(profileSelect).bind(targetId).first<Row>();
  if (!target) return c.json({ error: 'Profile not found' }, 404);
  const status = target.is_private ? 'pending' : 'accepted';
  const timestamp = now();
  await c.env.DB.prepare(`INSERT INTO follows (follower_id, following_id, status, created_at, accepted_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(follower_id, following_id) DO UPDATE SET status = excluded.status, accepted_at = excluded.accepted_at`)
    .bind(auth.userId, targetId, status, timestamp, status === 'accepted' ? timestamp : null).run();
  const kind = status === 'pending' ? 'follow_request' : 'new_follower';
  await c.env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id, recipient_id, actor_id, kind, entity_type, entity_id, dedupe_key, created_at) VALUES (?, ?, ?, ?, 'profile', ?, ?, ?)`)
    .bind(`activity-${crypto.randomUUID()}`, targetId, auth.userId, kind, auth.userId, `${kind}:${auth.userId}:${targetId}`, timestamp).run();
  const rel = await relationship(c.env, auth.userId, targetId);
  if (rel.is_mate) {
    const pair = [auth.userId, targetId].sort().join(':');
    for (const recipient of [auth.userId, targetId]) {
      const actor = recipient === auth.userId ? targetId : auth.userId;
      await c.env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id, recipient_id, actor_id, kind, entity_type, entity_id, dedupe_key, created_at) VALUES (?, ?, ?, 'mate_created', 'profile', ?, ?, ?)`)
        .bind(`activity-${crypto.randomUUID()}`, recipient, actor, actor, `mate_created:${pair}:${recipient}`, timestamp).run();
    }
  }
  return c.json({ data: { status, viewer_relationship: rel } });
});

social.delete('/profiles/:id/follow', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(auth.userId, c.req.param('id')).run();
  return c.json({ data: { removed: true } });
});

social.get('/follow-requests', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  const result = await c.env.DB.prepare(`SELECT p.* FROM follows f JOIN profiles p ON p.user_id = f.follower_id WHERE f.following_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 50`).bind(auth.userId).all<Row>();
  return c.json({ data: { items: await Promise.all((result.results || []).map((row) => shapeProfile(c.env, row, auth.userId))), cursor: null } });
});

social.post('/follow-requests/:id/approve', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  const requesterId = c.req.param('id');
  if (await isBlocked(c.env, auth.userId, requesterId)) return c.json({ error: 'Request not found' }, 404);
  const timestamp = now();
  const result = await c.env.DB.prepare(`UPDATE follows SET status = 'accepted', accepted_at = ? WHERE follower_id = ? AND following_id = ? AND status = 'pending'`).bind(timestamp, requesterId, auth.userId).run();
  if (!result.meta.changes) return c.json({ error: 'Request not found' }, 404);
  await c.env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id, recipient_id, actor_id, kind, entity_type, entity_id, dedupe_key, created_at) VALUES (?, ?, ?, 'follow_approved', 'profile', ?, ?, ?)`)
    .bind(`activity-${crypto.randomUUID()}`, requesterId, auth.userId, auth.userId, `follow_approved:${requesterId}:${auth.userId}`, timestamp).run();
  const rel = await relationship(c.env, auth.userId, requesterId);
  if (rel.is_mate) {
    for (const recipient of [auth.userId, requesterId]) {
      const actor = recipient === auth.userId ? requesterId : auth.userId;
      const pair = [auth.userId, requesterId].sort().join(':');
      await c.env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id, recipient_id, actor_id, kind, entity_type, entity_id, dedupe_key, created_at) VALUES (?, ?, ?, 'mate_created', 'profile', ?, ?, ?)`)
        .bind(`activity-${crypto.randomUUID()}`, recipient, actor, actor, `mate_created:${pair}:${recipient}`, timestamp).run();
    }
  }
  return c.json({ data: { approved: true, viewer_relationship: rel } });
});

social.delete('/follow-requests/:id', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'pending'`).bind(c.req.param('id'), auth.userId).run();
  return c.json({ data: { declined: true } });
});

social.delete('/followers/:id', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`).bind(c.req.param('id'), auth.userId).run();
  return c.json({ data: { removed: true } });
});

async function connectionList(c: any, kind: 'followers' | 'following' | 'mates') {
  const viewer = c.get('auth')?.userId as string | undefined;
  const subjectId = c.req.param('id');
  const subject = await c.env.DB.prepare(profileSelect).bind(subjectId).first() as Row | null;
  if (!subject || (viewer && await isBlocked(c.env, viewer, subjectId))) return c.json({ error: 'Profile not found' }, 404);
  const rel = await relationship(c.env, viewer, subjectId);
  if (!subject.show_connection_lists && viewer !== subjectId) return c.json({ error: 'Connection list is private' }, 403);
  const sql = kind === 'followers'
    ? `SELECT p.* FROM follows f JOIN profiles p ON p.user_id = f.follower_id WHERE f.following_id = ? AND f.status = 'accepted'`
    : kind === 'following'
      ? `SELECT p.* FROM follows f JOIN profiles p ON p.user_id = f.following_id WHERE f.follower_id = ? AND f.status = 'accepted'`
      : `SELECT p.* FROM follows a JOIN follows b ON a.following_id = b.follower_id AND a.follower_id = b.following_id JOIN profiles p ON p.user_id = a.following_id WHERE a.follower_id = ? AND a.status = 'accepted' AND b.status = 'accepted'`;
  const result = await c.env.DB.prepare(`${sql} ORDER BY p.display_name LIMIT 100`).bind(subjectId).all() as { results?: Row[] };
  return c.json({ data: { items: await Promise.all((result.results || []).map((row: Row) => shapeProfile(c.env, row, viewer))), cursor: null } });
}

social.get('/profiles/:id/followers', optionalAuth, (c) => connectionList(c, 'followers'));
social.get('/profiles/:id/following', optionalAuth, (c) => connectionList(c, 'following'));
social.get('/profiles/:id/mates', optionalAuth, (c) => connectionList(c, 'mates'));

for (const kind of ['mute', 'restrict', 'block'] as const) {
  social.post(`/profiles/:id/${kind}`, clerkAuth, async (c) => {
    const auth = c.get('auth')!;
    const subject = c.req.param('id');
    if (subject === auth.userId) return c.json({ error: `You cannot ${kind} yourself` }, 400);
    if (kind === 'block') {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').bind(auth.userId, subject, subject, auth.userId),
        c.env.DB.prepare(`DELETE FROM user_moderation_edges WHERE actor_id = ? AND subject_id = ? AND kind IN ('mute', 'restrict')`).bind(auth.userId, subject),
      ]);
    }
    await c.env.DB.prepare(`INSERT OR IGNORE INTO user_moderation_edges (actor_id, subject_id, kind, created_at) VALUES (?, ?, ?, ?)`).bind(auth.userId, subject, kind, now()).run();
    return c.json({ data: { applied: true } });
  });
  social.delete(`/profiles/:id/${kind}`, clerkAuth, async (c) => {
    const auth = c.get('auth')!;
    await c.env.DB.prepare('DELETE FROM user_moderation_edges WHERE actor_id = ? AND subject_id = ? AND kind = ?').bind(auth.userId, c.req.param('id'), kind).run();
    return c.json({ data: { removed: true } });
  });
}

social.get('/activity', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  const result = await c.env.DB.prepare(`SELECT a.*, p.display_name, p.avatar_url FROM activity_events a LEFT JOIN profiles p ON p.user_id = a.actor_id WHERE a.recipient_id = ? ORDER BY a.created_at DESC LIMIT 50`).bind(auth.userId).all<Row>();
  const items = (result.results || []).map((row) => ({ id: row.id, actor: row.actor_id ? { id: row.actor_id, name: row.display_name || 'Community brewer', avatar_url: row.avatar_url || undefined } : undefined, kind: row.kind, entity_type: row.entity_type || undefined, entity_id: row.entity_id || undefined, metadata: json(row.metadata, {}), read_at: row.read_at ? iso(row.read_at) : undefined, created_at: iso(row.created_at) }));
  return c.json({ data: { items, cursor: null } });
});

social.post('/activity/:id/read', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('UPDATE activity_events SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_id = ?').bind(now(), c.req.param('id'), auth.userId).run();
  return c.json({ data: { read: true } });
});

social.post('/activity/read-all', clerkAuth, async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('UPDATE activity_events SET read_at = COALESCE(read_at, ?) WHERE recipient_id = ?').bind(now(), auth.userId).run();
  return c.json({ data: { read: true } });
});

export default social;
