import type { Env } from '../db/client';

export async function queueCommunityPush(
  env: Env,
  input: { userId: string; key: string; kind: string; title: string; body: string; deepLink: string },
) {
  const timestamp = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO push_schedules
      (id, user_id, batch_id, kind, title, body, deep_link, send_at, sent_at, cancelled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`) 
      .bind(`community-${input.key}`, input.userId, input.key, input.kind, input.title.slice(0, 100), input.body.slice(0, 220), input.deepLink, timestamp, timestamp, timestamp).run();
  } catch (error) {
    // Community actions must still succeed if the optional notification tables
    // have not been installed in a local development database yet.
    console.warn('Could not queue community push', error);
  }
}
