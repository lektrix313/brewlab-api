import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../db/client';
import { clerkAuth, optionalAuth } from '../middleware/auth';

const community = new Hono<{ Bindings: Env }>();
const json = (value: unknown, fallback: unknown) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const iso = (value: unknown) => new Date(Number(value) || Date.now()).toISOString();

function shapePost(row: Record<string, unknown>) {
  return {
    id: row.id, author_id: row.author_id, author: { id: row.author_id, name: row.display_name || 'Community brewer', avatar_url: row.avatar_url || undefined }, batch_id: row.batch_id || undefined,
    title: row.title, tasting_summary: row.tasting_summary || undefined, worked_well: row.worked_well || undefined, change_next_time: row.change_next_time || undefined,
    difficulty: row.difficulty, recipe_snapshot: json(row.recipe_snapshot, {}), batch_summary: json(row.batch_summary, undefined), media: json(row.media, []),
    comments_enabled: Boolean(row.comments_enabled), comment_count: Number(row.comment_count || 0), brew_count: Number(row.brew_count || 0), created_at: iso(row.created_at), updated_at: iso(row.updated_at),
  };
}

const postSelect = `SELECT p.*, u.display_name, u.avatar_url,
  (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
  (SELECT COUNT(*) FROM community_plans x WHERE x.post_id = p.id) AS brew_count
  FROM community_posts p LEFT JOIN users u ON u.id = p.author_id`;

community.post('/media', clerkAuth, async (c) => {
  const auth = c.get('auth'); const form = await c.req.formData(); const value = form.get('file');
  if (!value || typeof value === 'string') return c.json({ error: 'Invalid image' }, 400); const file = value as unknown as File;
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) return c.json({ error: 'Invalid image' }, 400);
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'; const key = `community/${auth.userId}/${crypto.randomUUID()}.${extension}`;
  await c.env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { owner: auth.userId } });
  const origin = new URL(c.req.url).origin; return c.json({ data: { id: `media-${crypto.randomUUID()}`, url: `${origin}/community/media/${encodeURIComponent(key)}`, position: 0 } }, 201);
});

community.get('/media/:key{.+}', async (c) => {
  const object = await c.env.PHOTOS.get(decodeURIComponent(c.req.param('key'))); if (!object) return c.json({ error: 'Image not found' }, 404);
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('Cache-Control', 'public, max-age=31536000, immutable'); return new Response(object.body, { headers });
});

community.get('/posts', optionalAuth, async (c) => {
  const result = await c.env.DB.prepare(`${postSelect} ORDER BY p.created_at DESC LIMIT 30`).all<Record<string, unknown>>();
  return c.json({ data: { items: (result.results || []).map(shapePost), cursor: null } });
});

community.get('/public/:id', async (c) => {
  const row = await c.env.DB.prepare(`${postSelect} WHERE p.id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return c.html('<h1>Brew not found</h1>', 404); const post = shapePost(row); const recipe = post.recipe_snapshot as Record<string, any>; const media = post.media as Array<{ url?: string }>;
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  const hero = media[0]?.url ? `<img class="hero" src="${escape(media[0].url)}" alt="${escape(post.title)}">` : '<div class="hero blank">TUN</div>';
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(post.title)} · TUN</title><meta name="description" content="${escape(post.tasting_summary || 'A community brew on TUN')}"><style>*{box-sizing:border-box}body{margin:0;background:#f5f0e6;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:680px;margin:auto;padding:20px 20px 60px}.brand{text-align:center;letter-spacing:5px;font-size:13px;margin:8px 0 22px}.hero{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:22px}.blank{background:#ead8c5;color:#b8633a;display:grid;place-items:center;font:700 48px Georgia,serif}h1{font:600 46px/1 Georgia,serif;letter-spacing:-1px;margin:26px 0 8px}.by{color:#8e4a2a;font-size:11px;letter-spacing:1.4px;text-transform:uppercase}.summary{font:italic 20px/1.45 Georgia,serif;color:#625c55}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#faf6ee;border:1px solid #e1d6c7;padding:16px;border-radius:16px;margin:24px 0}.stat small{display:block;color:#777;font-size:9px;letter-spacing:1px}.stat strong{display:block;margin-top:5px}.section{border-top:1px solid #d9cdbd;padding-top:18px;margin-top:24px}.section h2{font:600 24px Georgia,serif;margin:0 0 8px}.section p{line-height:1.55;color:#4d4944}.cta{display:block;background:#b8633a;color:#fff8ed;text-decoration:none;text-align:center;font-weight:700;padding:17px;border-radius:15px;margin-top:28px}</style></head><body><main class="wrap"><div class="brand">TUN</div>${hero}<p class="by">By ${escape(post.author.name)}</p><h1>${escape(post.title)}</h1><p class="summary">${escape(post.tasting_summary || recipe.description || '')}</p><div class="stats"><div class="stat"><small>ABV</small><strong>${Number(recipe.estimated_abv_pct || recipe.estimatedAbvPct || 0).toFixed(1)}%</strong></div><div class="stat"><small>IBU</small><strong>${Math.round(Number(recipe.estimated_ibu || recipe.estimatedIbu || 0))}</strong></div><div class="stat"><small>OG</small><strong>${Number(recipe.estimated_og || recipe.estimatedOg || 0).toFixed(3)}</strong></div><div class="stat"><small>SIZE</small><strong>${escape(recipe.batch_size_l || recipe.batchSizeL)}L</strong></div></div>${post.worked_well ? `<section class="section"><h2>What worked</h2><p>${escape(post.worked_well)}</p></section>` : ''}${post.change_next_time ? `<section class="section"><h2>Next time</h2><p>${escape(post.change_next_time)}</p></section>` : ''}<a class="cta" href="tun://community/post/${escape(post.id)}">Brew this in TUN</a></main></body></html>`);
});

community.get('/posts/:id', optionalAuth, async (c) => {
  const row = await c.env.DB.prepare(`${postSelect} WHERE p.id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  return row ? c.json({ data: shapePost(row) }) : c.json({ error: 'Post not found' }, 404);
});

const createPost = z.object({ batchId: z.string().optional(), title: z.string().min(1).max(200), tastingSummary: z.string().max(1000).optional(), workedWell: z.string().max(1000).optional(), changeNextTime: z.string().max(1000).optional(), difficulty: z.enum(['approachable', 'involved', 'advanced']).default('involved'), commentsEnabled: z.boolean().default(true), recipeSnapshot: z.record(z.any()), batchSummary: z.record(z.any()).optional(), media: z.array(z.object({ id: z.string(), url: z.string().url(), position: z.number() })).max(6).default([]) });
community.post('/posts', clerkAuth, async (c) => {
  const parsed = createPost.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: 'Invalid post', details: parsed.error.flatten() }, 400);
  const auth = c.get('auth'); const body = parsed.data; const id = `post-${crypto.randomUUID()}`; const now = Date.now();
  await c.env.DB.prepare(`INSERT INTO community_posts (id, author_id, batch_id, title, tasting_summary, worked_well, change_next_time, difficulty, recipe_snapshot, batch_summary, media, comments_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`)
    .bind(id, auth.userId, body.batchId || null, body.title, body.tastingSummary || null, body.workedWell || null, body.changeNextTime || null, body.difficulty, JSON.stringify(body.recipeSnapshot), body.batchSummary ? JSON.stringify(body.batchSummary) : null, body.commentsEnabled ? 1 : 0, now, now).run();
  await c.env.DB.prepare('UPDATE community_posts SET media = ? WHERE id = ?').bind(JSON.stringify(body.media), id).run();
  const row = await c.env.DB.prepare(`${postSelect} WHERE p.id = ?`).bind(id).first<Record<string, unknown>>(); return c.json({ data: shapePost(row!) }, 201);
});

community.get('/posts/:id/comments', optionalAuth, async (c) => {
  const result = await c.env.DB.prepare(`SELECT c.*, u.display_name, u.avatar_url FROM community_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT 100`).bind(c.req.param('id')).all<Record<string, unknown>>();
  const items = (result.results || []).map((r) => ({ id: r.id, post_id: r.post_id, author_id: r.author_id, parent_id: r.parent_id || undefined, author: { id: r.author_id, name: r.display_name || 'Community brewer', avatar_url: r.avatar_url || undefined }, body: r.body, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
  return c.json({ data: { items, cursor: null } });
});

community.post('/posts/:id/comments', clerkAuth, async (c) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(500), parentId: z.string().optional() }).safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: 'Invalid comment' }, 400);
  const auth = c.get('auth'); const id = `comment-${crypto.randomUUID()}`; const now = Date.now(); await c.env.DB.prepare(`INSERT INTO community_comments (id, post_id, author_id, parent_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, c.req.param('id'), auth.userId, parsed.data.parentId || null, parsed.data.body, now, now).run();
  return c.json({ data: { id, post_id: c.req.param('id'), author_id: auth.userId, author: { id: auth.userId, name: 'You' }, body: parsed.data.body, created_at: iso(now), updated_at: iso(now) } }, 201);
});

community.post('/posts/:id/plan', clerkAuth, async (c) => {
  const auth = c.get('auth'); const post = await c.env.DB.prepare('SELECT recipe_snapshot FROM community_posts WHERE id = ?').bind(c.req.param('id')).first<{ recipe_snapshot: string }>(); if (!post) return c.json({ error: 'Post not found' }, 404);
  const input = z.object({ batchSizeL: z.number().positive().optional() }).safeParse(await c.req.json()); await c.env.DB.prepare('INSERT OR IGNORE INTO community_plans (user_id, post_id, batch_size_l) VALUES (?, ?, ?)').bind(auth.userId, c.req.param('id'), input.success ? input.data.batchSizeL || null : null).run();
  return c.json({ data: { recipe: json(post.recipe_snapshot, {}) } });
});

export default community;
