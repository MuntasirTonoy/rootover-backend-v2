# Agent Context

## Project Overview
- **Name**: Root Over Education Backend (v2)
- **Description**: REST API for a course marketplace for Bangladesh. Verified teachers sell complete subject courses (Level → Course → Chapters → Lessons → YouTube unlisted video); students buy and watch them. Payments are **simulated** (no real gateway).
- **Contract**: `../rootover-frontend-v2/docs/BACKEND_SPEC.md` is the source of truth for the schema, endpoints, response shapes, validation messages and business rules. The frontend mock (`../rootover-frontend-v2/src/lib/pricing.ts`, `selectors.ts`, `context/AppStore.tsx`, `seed.ts`) shows the same rules in working code.
- **Environment**: Node.js, Express 5, TypeScript (ESM format).
- **Database**: PostgreSQL on Neon with Prisma ORM 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`). The app connects through the pooled `DATABASE_URL`; the Prisma CLI uses the direct `DIRECT_URL` (see `prisma.config.ts`).

## Tech Stack & Tooling
- **Language**: TypeScript 7 (`module: "esnext"`, `moduleResolution: "bundler"`, strict).
- **Package Manager**: Strictly `npm` (tracked via `package-lock.json`).
- **Formatting & Linting**: Biome (`@biomejs/biome`): tabs, double quotes.
- **Dev Server**: `tsx watch` for hot-reloading.
- **Validation**: `zod` (v4); env is validated at startup in `src/config/index.ts`.
- **Security**: `helmet`, `cors` (only `FRONTEND_URL`), `express-rate-limit`, 1 MB JSON limit.
- **Authentication**: Passport (`passport-local` for login, `passport-jwt` for `Authorization: Bearer` access tokens, no sessions), `bcryptjs` password hashes, `jsonwebtoken` (HS256, 7-day expiry). Role and ban status live in the database and are reloaded on every request.
- **File storage**: Cloudinary (`cloudinary`, `multer` memory storage). Avatars and thumbnails are public; teacher-application documents are `authenticated` assets served through signed URLs.

## Architecture & Structure
```text
src/
├── app/
│   ├── errors/        # AppError, zod and Prisma error mapping
│   ├── lib/           # Infrastructure: prisma, passport strategies, cloudinary
│   ├── middlewares/   # auth (auth/optionalAuth/currentUser), rateLimiter, validateRequest, globalErrorHandler, notFound
│   ├── modules/       # Feature-based modules (auth, course, checkout, teacher, admin, ...)
│   │   └── <name>/
│   │       ├── <name>.controller.ts
│   │       ├── <name>.interface.ts
│   │       ├── <name>.route.ts
│   │       ├── <name>.service.ts
│   │       └── <name>.validation.ts   # zod request schemas
│   └── routes/        # Main router; every module is mounted under /api
│       └── index.ts
├── config/            # zod-validated environment configuration
│   └── index.ts
├── generated/prisma/  # Prisma client (git-ignored, rebuilt by `npm install` / `npm run db:generate`)
├── app.ts             # Express app setup and middleware registration
└── server.ts          # Server bootstrap (checks the DB connection first) + graceful shutdown
prisma/
├── schema.prisma      # Data model (BACKEND_SPEC section 4, + tokenVersion and Cloudinary publicIds)
└── migrations/        # Committed SQL migrations
prisma.config.ts       # Prisma CLI config (schema path, migrations, datasource URL)
```

## API Conventions
- Base path `/api`; JSON in and out. Responses return the resource directly (no `{ success, data }` wrapper); paginated lists return `{ data, pagination: { page, limit, total, pages } }`.
- Errors always use `{ error: { code, message, fields? } }`. Throw `new AppError(httpStatus.X, "message")` from services; the code (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BUSINESS_RULE`, `INTERNAL`) is derived from the status. zod failures become 400 with per-field `fields` keyed by inner path (`chapters.0.title`).
- Express 5 forwards rejected promises from async handlers to the error handler, so no `catchAsync` wrapper is needed.
- Money is integer BDT; dates are ISO strings; ids are `cuid()` strings in `id`.

## Available Scripts
- `npm run dev`: Starts development server with `tsx watch`.
- `npm run build`: Compiles TypeScript to the `dist/` directory.
- `npm run typecheck`: `tsc --noEmit`.
- `npm start`: Runs the production build from `dist/src/server.js`.
- `npm run format:check` / `npm run format:fix`: Runs Biome formatter.
- `npm run lint:check` / `npm run lint:fix`: Runs Biome linter.
- `npm run db:generate`: Regenerates the Prisma client after editing the schema.
- `npm run db:migrate`: Creates and applies a new migration in development (`prisma migrate dev`).
- `npm run db:deploy`: Applies pending migrations (production / CI).
- `npm run db:status` / `npm run db:studio`: Migration status / Prisma Studio.

## Important Conventions
1. **ESM Imports**: Since `"type": "module"` is used, local file imports should include `.js` extensions (e.g., `import app from './app.js';`).
2. **Git**: `package-lock.json` is tracked, other lock files are ignored.
3. **Generated Code**: Any generated code (e.g., Prisma client) should be placed in `/src/generated` which is git-ignored and excluded from Biome. Import the client from `../generated/prisma/client.js` and use the shared instance in `src/app/lib/prisma.ts`.
4. **Secrets**: `.env` is git-ignored; `.env.example` holds placeholders only, never real credentials.
