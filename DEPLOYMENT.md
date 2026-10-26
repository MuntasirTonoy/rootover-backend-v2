# Deploying Root Over

Two apps: this API (`rootover-backend-v2`, Express + Prisma on Node) and the web
app (`rootover-frontend-v2`, Next.js). Any Node host works for the API (Render,
Railway, Fly, a VPS); Vercel or any Node host works for the web app.

## 1. Services to set up first

| Service | What you need |
|---|---|
| PostgreSQL (Neon) | A **new production database** (not the dev one). Pooled URL for the app, direct URL for migrations. Turn on backups. |
| bKash | Live **merchant** credentials (username, password, app key, app secret). Until approved, the sandbox works but collects no money. |
| Resend | An API key with sending access and a **verified domain** for `EMAIL_FROM`. |
| Cloudinary | Cloud name, API key, API secret (a separate folder or account from dev). |

## 2. API environment (production)

```
NODE_ENV=production
PORT=5000                      # or what the host provides
DATABASE_URL=...               # Neon pooled URL, sslmode=verify-full
DIRECT_URL=...                 # Neon direct URL (migrations)
FRONTEND_URL=https://www.your-domain.com
API_PUBLIC_URL=https://api.your-domain.com
JWT_ACCESS_SECRET=...          # new, 48+ random bytes; never reuse the dev one
JWT_ACCESS_EXPIRES_IN=7d
TRUST_PROXY=1                  # behind the host's proxy / load balancer
DEMO_MODE=false
RESEND_API_KEY=...
EMAIL_FROM="Root Over Education <no-reply@your-domain.com>"
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=rootover-prod
BKASH_BASE_URL=https://tokenized.pay.bka.sh/v1.2.0-beta
BKASH_USERNAME=...
BKASH_PASSWORD=...
BKASH_APP_KEY=...
BKASH_APP_SECRET=...
```

The server refuses to start in production if `FRONTEND_URL` / `API_PUBLIC_URL`
aren't https, `DEMO_MODE` is on, `RESEND_API_KEY` is missing, payments would be
simulated, or storage is the test-only memory driver. It warns when bKash is
still the sandbox. Generate the JWT secret with
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

**Don't paste the local `.env` into the host.** Its development values
(`http://localhost:...` URLs, `DEMO_MODE=true`, the dev database and JWT secret)
stop the server with:

```
Invalid environment variables:
  - FRONTEND_URL: FRONTEND_URL must be an https URL in production (got http://localhost:3000)
  - API_PUBLIC_URL: API_PUBLIC_URL must be an https URL in production (not set)
  - DEMO_MODE: DEMO_MODE must be off in production (set DEMO_MODE=false)
```

"not set" means the variable is missing and fell back to its localhost default.
`FRONTEND_URL` must match the address in the browser bar exactly (no trailing
`/`, `www` or not), because it is the only origin CORS allows.

### Payment variables

| Variable | Testing a deployment (sandbox) | Live |
|---|---|---|
| `API_PUBLIC_URL` | `https://api.rootover.site` (or the `onrender.com` URL) | same |
| `PAYMENT_PROVIDER` | leave unset (`bkash` because the credentials are set) | leave unset |
| `BKASH_BASE_URL` | `https://tokenized.sandbox.bka.sh/v1.2.0-beta` | `https://tokenized.pay.bka.sh/v1.2.0-beta` |
| `BKASH_USERNAME` / `BKASH_PASSWORD` / `BKASH_APP_KEY` / `BKASH_APP_SECRET` | sandbox credentials | **live merchant** credentials |

Sandbox credentials don't work on the live URL and the other way round: switch
the URL and all four credentials together. Sandbox in production starts with the
warning `bKash SANDBOX in production; no real money will be collected`; after
switching, `GET /api/config` shows `payment.sandbox: false`.

### Render

- Node: `package.json` `engines` requires Node `>=22.12` (Prisma 7, TypeScript 7);
  Render picks a matching version.
- Build command: `npm ci --include=dev && npm run build && npm run db:deploy`.
  `--include=dev` is required: with `NODE_ENV=production` npm skips the dev
  dependencies, and the build needs `prisma` and `typescript`. `db:deploy` in the
  build applies migrations (the free plan has no pre-deploy command).
- Start command: `npm start`. Health check path: `/api/health`. Render sets `PORT`.
- `TRUST_PROXY=1`.

## 3. API build and release

```
npm ci
npm run build                  # also generates the Prisma client (postinstall)
npm run db:deploy              # applies pending migrations; run on every release
npm start                      # node dist/src/server.js
```

- **Never run `npm run db:seed` against production**: it wipes every table (it
  refuses unless given `--force`).
- Health check path: `GET /api/health`.
- The server checks the database connection at startup and shuts down
  gracefully on SIGTERM.

## 4. The first admin

On a new (empty) database, **the first account that verifies its email
becomes the admin** automatically. So right after deploying, register and
verify the admin's own account before announcing the site.

Every later account is a student. An admin can make any active student an
admin (admin area → Students → "Make admin") and remove other admins' roles
(admin area → Admins); nobody can change their own role, so there is always at
least one admin. If you ever lose access to every admin account, promote one
from the API host:

```
npm run admin:promote -- someone@your-domain.com
```

## 5. Web app environment and build

```
NEXT_PUBLIC_API_URL=https://api.your-domain.com/api
```

```
npm ci
npm run build
npm start                      # or deploy to Vercel
```

The demo logins, coupon hints and "Fill demo data" button only appear when the
API runs with `DEMO_MODE=true`, so nothing in the web app needs changing.

## 6. After the first deploy

1. Open `https://api.your-domain.com/api/config`: `payment.provider` is `bkash`,
   `payment.sandbox` is `false`, `demo` is `false`.
2. Register an account: the verification email arrives (Resend).
3. That first verified account is the admin (step 4): open the admin area.
4. Apply as a teacher with real documents; the admin can open them.
5. Buy a cheap course with a real bKash wallet: you land on
   `/payment/result` with "Payment successful" and the course is in My Classes.
6. Check the response headers of the web app (X-Frame-Options, HSTS) and that
   the API rejects requests from other origins (CORS).

## Known limits

- Refunds are manual: a payment bKash confirmed but that couldn't be fulfilled
  is marked failed with its bKash transaction id; refund it from the bKash
  merchant panel.
- Teacher payouts are manual: send the money by bKash, then approve the
  withdrawal in the admin area to record it.
- Replaced avatars and thumbnails stay in Cloudinary.
- No error monitoring is built in (add Sentry or the host's log alerts).
