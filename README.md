# Guestra CRM

Full-stack hospitality CRM built with React, Vite, TypeScript, Express, PostgreSQL, and Drizzle ORM.

## Data modes

- `sales@guestra.com` opens the deterministic demo dataset. Its changes stay in browser memory and never write to PostgreSQL.
- `admin@guestra.com` loads and updates PostgreSQL. Changes persist after reload and server restart.

Passwords are never stored in the repository. Set both bootstrap passwords through environment variables; the bootstrap hashes them with bcrypt and creates missing users idempotently.

## Local setup

1. Copy `.env.example` to `.env` and replace every secret/password placeholder.
2. Create the PostgreSQL database from `DATABASE_URL`.
3. Install and build:

```bash
npm install
npm run build
```

4. Load environment variables in your shell, then prepare the database and start the app:

```bash
npm run db:migrate
npm run db:bootstrap
npm start
```

For frontend development, run `npm run dev`; in a second terminal run `npm run dev:server`. Vite proxies `/api` to port 3000.

## Railway

Add a PostgreSQL service, expose its `DATABASE_URL`, and set all values from `.env.example`. Use `npm run build` as the build command and `npm run start:production` as the start command. The start command applies pending migrations and runs the idempotent bootstrap before starting the web server. The included `Dockerfile` provides the same sequence automatically.

## AI integration

Send `x-crm-api-key: <CRM_INTEGRATION_API_KEY>` to:

- `POST /api/integrations/ai/leads/upsert`
- `POST /api/integrations/ai/offers/upsert`
- `POST /api/integrations/ai/bookings/confirm`

These endpoints store structured CRM facts and idempotency markers. They do not persist raw Telegram or AI message bodies.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
