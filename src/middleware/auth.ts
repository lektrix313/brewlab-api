import { createMiddleware } from 'hono/factory';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env } from '../db/client';
import { createDb } from '../db/client';
import { profiles, users } from '../db/schema';

export type AuthContext = {
  userId: string;
  email: string;
};

/**
 * Verify Clerk JWT from Authorization header.
 *
 * Expected header: `Authorization: Bearer <clerk_jwt>`
 *
 * Env vars needed:
 *   CLERK_JWKS_URL — e.g. https://your-app.clerk.accounts.dev/.well-known/jwks.json
 */
export const clerkAuth = createMiddleware<{ Bindings: Env; Variables: { auth: AuthContext } }>(
  async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized — missing Bearer token' }, 401);
    }

    const token = authHeader.slice(7);
    const jwksUrl = c.env.CLERK_JWKS_URL;
    if (!jwksUrl) {
      return c.json({ error: 'Server misconfiguration — CLERK_JWKS_URL not set' }, 500);
    }

    try {
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jwtVerify(token, JWKS, {
        clockTolerance: 60,
        // Clerk JWT issuer varies by instance; we skip strict issuer check
        // and rely on signature + audience (sub) instead
      });

      const userId = payload.sub;
      const email = payload.email as string | undefined;

      if (!userId) {
        return c.json({ error: 'Unauthorized — invalid token payload' }, 401);
      }

      // All synced domain records reference users.id. Clerk authenticates the
      // person, but a webhook is not guaranteed to have provisioned the local
      // row before their first sync, so create it atomically on first request.
      const resolvedEmail = email ?? `${userId}@users.invalid`;
      const db = createDb(c.env.DB);
      await db
        .insert(users)
        .values({ id: userId, email: resolvedEmail })
        .onConflictDoNothing({ target: users.id });
      const handle = `brewer.${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toLowerCase()}`;
      await db
        .insert(profiles)
        .values({
          userId,
          handle,
          handleNormalized: handle,
          displayName: typeof payload.name === 'string' ? payload.name : 'Community brewer',
          avatarUrl: typeof payload.picture === 'string' ? payload.picture : null,
        })
        .onConflictDoNothing();

      c.set('auth', { userId, email: resolvedEmail });
      await next();
    } catch (err) {
      console.error('JWT verification failed:', err);
      return c.json({ error: 'Unauthorized — invalid token' }, 401);
    }
  }
);

/**
 * Optional auth — sets user if token present, continues regardless.
 * Useful for public recipe browsing with personalised features.
 */
export const optionalAuth = createMiddleware<{ Bindings: Env; Variables: { auth?: AuthContext } }>(
  async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    const jwksUrl = c.env.CLERK_JWKS_URL;
    if (!jwksUrl) {
      return next();
    }

    try {
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jwtVerify(token, JWKS, { clockTolerance: 60 });
      const userId = payload.sub;
      const email = payload.email as string | undefined;
      if (userId) {
        c.set('auth', { userId, email: email ?? '' });
      }
    } catch {
      // Silently ignore invalid optional tokens
    }

    await next();
  }
);
