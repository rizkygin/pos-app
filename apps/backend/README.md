# Backend (Fastify) — build & deploy

The backend is a standalone Fastify server. It compiles to `dist/` (CommonJS) and
runs with plain Node — no `tsx`/`drizzle-kit` in the production image.

## Image

`apps/backend/Dockerfile` is self-contained: **build context is `apps/backend`**,
so it does not depend on the frontend workspace.

```bash
# from repo root
docker build -t pos-backend ./apps/backend
```

- **Builder stage** installs production deps + a standalone `typescript` and runs
  `tsc`. It intentionally skips full devDependencies because `tsx` + `drizzle-kit`
  pull conflicting `esbuild` versions whose postinstall fails in CI.
- **Runtime stage** installs production deps only and copies `dist/` + `drizzle/`.
- The host `package-lock.json` is dropped in both stages so npm resolves the
  linux-musl native binaries (`sharp`) for the image instead of the macOS ones.

## Runtime contract

- Listens on `PORT` (default `4000`), host `0.0.0.0`.
- Health check: `GET /health` → `{ "ok": true }`.
- **Uploads** are written to `process.cwd()/uploads` (i.e. `/app/uploads`). This
  is a `VOLUME` — mount persistent storage there or uploaded files are lost on
  redeploy.

### Required env vars

| Var                  | Notes                                                  |
| -------------------- | ------------------------------------------------------ |
| `DATABASE_URL`       | Postgres connection string (required, throws if unset) |
| `FRONTEND_ORIGIN`    | Allowed CORS origin + better-auth trusted origin       |
| `BETTER_AUTH_SECRET` | better-auth signing secret                             |
| `BETTER_AUTH_URL`    | better-auth base URL — **must be unquoted** (see below) |
| `RESEND_API_KEY`     | transactional email                                    |
| `PORT`               | optional, default `4000`                               |
| `COOKIE_SECURE`      | optional; `true`/`false`. Default = (`NODE_ENV==production`) |
| `COOKIE_DOMAIN`      | optional; session cookie domain. Default = `.ulunpesan.com` in prod, host-only otherwise. Set empty for local HTTP. |

> **Session cookies over HTTP:** the prod build sets a `Secure` cookie scoped to
> `.ulunpesan.com`, which browsers reject on `http://localhost`. To run the prod
> image locally (compose), set `COOKIE_SECURE=false` and `COOKIE_DOMAIN=` (empty).
> For a real deploy on a custom domain, set `COOKIE_DOMAIN=.yourdomain.com`.

> **`.env` quoting gotcha:** Docker's `--env-file` / compose `env_file` do **not**
> strip quotes the way `dotenv` does. A value like `BETTER_AUTH_URL="http://..."`
> is passed with the literal quotes and crashes better-auth with `ERR_INVALID_URL`.
> Keep values in `.env` unquoted.

## Database migrations

Migrations are a **separate deploy step** (the app does not auto-migrate). The
compiled migrator runs without tsx:

```bash
node dist/db/migrate.js     # reads ./drizzle relative to cwd
```

Run this against the target DB after deploy / before first boot.

## Local (docker-compose)

`docker-compose.yml` defines a `backend` service that builds this image, waits for
the `db` healthcheck, persists uploads to the `backend-uploads` volume, and
overrides `DATABASE_URL` to reach Postgres over the compose network (`db:5432`).

```bash
docker compose up -d db redis backend
```

> Note: the service publishes host port `4000`. Stop any `npm run dev:backend`
> first, or it will fail to bind.

## Deploy (Railway)

1. New service → "Deploy from repo", set **root directory** to `apps/backend`
   (so this Dockerfile + context are used).
2. Add a Postgres plugin; set `DATABASE_URL` from it.
3. Set the env vars above (unquoted). Point `FRONTEND_ORIGIN` at the deployed
   frontend domain.
4. Attach a **volume mounted at `/app/uploads`** for persistent uploads.
5. Run migrations once: `node dist/db/migrate.js` (Railway shell or a one-off).
