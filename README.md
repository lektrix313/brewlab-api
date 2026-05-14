# TUN BrewLab API

Cloudflare Workers backend for the TUN BrewLab mobile app.

## Stack

- **Runtime**: Cloudflare Workers
- **Router**: Hono
- **Database**: D1 (SQLite)
- **ORM**: Drizzle ORM
- **Auth**: Clerk JWT verification
- **Storage**: R2 (batch photos)

## Setup

### 1. Install dependencies

```bash
cd api
npm install
```

### 2. Configure Clerk

Create a Clerk application at [clerk.com](https://clerk.com). Then set the secrets:

```bash
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put CLERK_JWKS_URL
# e.g. https://your-app.clerk.accounts.dev/.well-known/jwks.json
```

Update `wrangler.toml` with your publishable key:

```toml
[vars]
CLERK_PUBLISHABLE_KEY = "pk_test_..."
```

### 3. Create D1 database

```bash
npx wrangler d1 create brewlab-db
# Copy the database_id into wrangler.toml
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Run locally

```bash
npm run dev
```

The API will be available at `http://localhost:8787`.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Health check |
| GET | `/recipes` | Yes | List my recipes |
| GET | `/recipes/public` | No | Browse public recipes |
| GET | `/recipes/:id` | Optional | Get single recipe |
| POST | `/recipes` | Yes | Create recipe |
| PUT | `/recipes/:id` | Yes | Update recipe |
| DELETE | `/recipes/:id` | Yes | Delete recipe |
| GET | `/batches` | Yes | List my batches |
| GET | `/batches/:id` | Yes | Get single batch |
| POST | `/batches` | Yes | Create batch |
| PUT | `/batches/:id` | Yes | Update batch |
| DELETE | `/batches/:id` | Yes | Delete batch |
| GET | `/measurements/batch/:batchId` | Yes | List measurements |
| POST | `/measurements/batch/:batchId` | Yes | Add measurement |
| DELETE | `/measurements/:id` | Yes | Delete measurement |
| GET | `/sync?since=ISO8601` | Yes | Pull all data since timestamp |
| POST | `/sync/push` | Yes | Push local changes |

## Auth

All protected endpoints expect an `Authorization: Bearer <clerk_jwt>` header.

The JWT is obtained from `@clerk/clerk-expo` in the React Native app.
