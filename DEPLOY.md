# Deployment Guide (Railway)

Status snapshot and the steps to take the app live. All coding phases are done;
what remains needs a Railway account.

## Phase status

| Phase | What | Status |
|---|---|---|
| 3 | Next `/api` routes → Fastify backend | ✅ complete |
| 4 | Server actions → backend | ✅ complete |
| 5 | Dockerize backend (`apps/backend/Dockerfile`) | ✅ complete, verified |
| 6 | Decouple frontend from the DB (no `@/src/db`, no `DATABASE_URL`) | ✅ complete, verified on `docker compose` |
| extra | Port `origin/main`'s commits + admin pages | ✅ done |
| — | **Deploy to Railway** | ⬜ TODO (needs your Railway account) |

The app runs end-to-end locally via `docker compose up --build`. Deploying is the
only remaining step — no new build work.

## Before deploying
1. Commit the working-tree fixes (migrate.ts env fix, `.dockerignore`, the
   "User Setting" sidebar link, email-verification changes if done).
2. Push `develop` to `origin` (currently nothing is pushed).
3. Decide branch strategy for `main` (develop is structurally ahead of
   origin/main — see the "main divergence" memory; do NOT `git merge origin/main`).

## Railway services (3)
1. **Postgres** — Railway managed Postgres plugin.
2. **backend** — build from `apps/backend/Dockerfile` (build context = `apps/backend`).
3. **frontend** — build from root `Dockerfile` (build context = repo root).

## Environment variables

### Postgres
Railway provides `DATABASE_URL` automatically. Use that value for the backend.

### backend
| Var | Value |
|---|---|
| `DATABASE_URL` | Railway Postgres internal URL |
| `PORT` | `4000` (or Railway's `$PORT`) |
| `FRONTEND_ORIGIN` | public frontend URL, e.g. `https://app.yourdomain.com` (CORS + better-auth trustedOrigins) |
| `BETTER_AUTH_SECRET` | same secret as today |
| `BETTER_AUTH_URL` | public backend URL, e.g. `https://api.yourdomain.com` |
| `RESEND_API_KEY` | your Resend key |
| `COOKIE_SECURE` | `true` |
| `COOKIE_DOMAIN` | `.yourdomain.com` (shared parent of frontend + backend) |

### frontend
| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | **public** backend URL (browser-facing), baked at build |
| `API_URL_INTERNAL` | backend URL reachable from the frontend **server** (Railway internal URL). **Phase 6 detail:** RSC/middleware fetches use this; without it, server-side calls hit the frontend container's own localhost. |
| `NODE_ENV` | `production` |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` (or Railway's `$PORT`) |

> `NEXT_PUBLIC_*` are inlined at **build** time → must be set as **build args**, not
> just runtime env. `API_URL_INTERNAL` is read at **runtime**.

## Persistent storage
- Mount a Railway **volume** on the backend at `/app/uploads` (product/ad/avatar
  uploads). Without it, uploaded images vanish on redeploy.

## Migrations (run once per deploy, separate from app start)
The backend container starts the server (`node dist/server.js`) and does **not**
auto-migrate. Run the migration as a one-off / release command:

```bash
node dist/db/migrate.js
```

(Locally this is `npm run db:migrate`; it now loads the root `.env`.) Seeding is
optional in prod: `node dist/db/seed.js` (or `npm run db:seed`).

## Gotchas (learned locally)
- `.env` values must be **unquoted** (docker `env_file`/Railway don't strip quotes;
  a quoted `BETTER_AUTH_URL` crashed better-auth with `ERR_INVALID_URL`).
- Identity sequences in the dev DB had drifted; a fresh DB migrates clean.
- **Don't** use Docker Desktop "Clean / Purge data" to fix disk issues — it deletes
  volumes (the database). Use `docker builder prune -f` for build-cache bloat.
- Back up before risky Docker ops: `docker exec <db> pg_dump -U <user> <db> > backup.sql`.

## Email verification (separate follow-up, not deploy-blocking)
Currently non-functional. To enable, in `apps/backend/src/auth.ts`:
- `emailVerification.sendOnSignUp: true` (actually sends the email on signup)
- optional `emailVerification.autoSignInAfterVerification: true`
- optional `emailAndPassword.requireEmailVerification: true` (block login until verified)
- set `FROM` to a **Resend-verified** sender (or `onboarding@resend.dev` for testing);
  `noreply@yourdomain.com` is a placeholder Resend will reject.
