import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// Augment wrangler-generated types with secrets
export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  CLERK_PUBLISHABLE_KEY: string;
  // Secrets (set via `wrangler secret put`)
  CLERK_SECRET_KEY: string;
  CLERK_JWKS_URL: string;
};

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
