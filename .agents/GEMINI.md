# Project-Specific Rules — Atelier Market (nodeJs-shop)

These rules apply only to this project. They supplement and may override the global rules in
`~/.gemini/config/GEMINI.md`. The global rules still apply in full unless explicitly overridden here.

---

## 1. Project Identity & Stack

- **Project name**: Atelier Market — a multi-vendor artisanal e-commerce marketplace.
- **Backend**: Node.js (CommonJS, `"type": "commonjs"`) + Express v5 + Mongoose + MongoDB Atlas.
- **Frontend**: React 18 + TypeScript (strict) + Vite + TanStack Query v5 + React Router v6.
- **Payments**: Paymob (card, 3DS, HMAC-SHA512 webhook verification).
- **Testing**: Vitest + Supertest (backend API), Testing Library (frontend), in-memory MongoDB.
- **Deployment**: Vercel (serverless). Session store: `connect-mongodb-session`. DB: cached singleton.
- **i18n**: Full EN/AR bilingual via `i18n.tsx` context. All user-facing strings must be localized.

---

## 2. Project File Structure

Do not create files outside of the established structure. Follow these conventions:

### Backend
```
controllers/          ← Route handlers (thin). One file per domain.
controllers/api/      ← Sub-controllers for API-specific concerns (e.g., meta.js)
services/             ← Business logic, external API calls. One file per domain.
models/               ← Mongoose schemas and models. One file per entity.
routes/               ← Express routers. One file per route group.
middleware/           ← Reusable Express middleware (auth guards, role checks).
util/                 ← Pure utility functions (db.js, file.js, invoiceGenerator.js).
```

### Frontend
```
client/src/types.ts            ← ALL shared TypeScript domain types live here.
client/src/lib/                ← Shared utilities: api.ts, csrf.ts, i18n.tsx.
client/src/auth/               ← Auth context, RequireAuth guard.
client/src/features/<name>/    ← Feature folders (components, hooks, tests, all co-located).
client/src/components/         ← Shared, reusable UI components (not feature-specific).
client/src/design-system/      ← Design tokens (tokens.css) and Styleguide.
client/src/pages/              ← Generic full-page components (NotFound, RouteError).
```

---

## 3. Backend Patterns

### Controllers must be thin
A controller function must:
1. Extract validated data from `req.body`, `req.params`, or `req.query`.
2. Call one or more service functions.
3. Return the JSON response.
It must NOT contain raw DB queries, external API calls, or complex calculations.

### Service layer
- Every new feature that involves business logic must have a corresponding service in `services/`.
- Services must be plain functions (or a module of named functions) — not classes.
- Services must receive all dependencies (models, config) as imports, not as function arguments.
- Services must throw errors with appropriate `status` properties for the controller to handle.

### Authentication & Authorization
- All protected routes must use `middleware/is-auth.js` for authentication.
- All role-restricted routes must use `middleware/require-role.js` with the allowed role(s).
- These middleware must be applied at the **router level**, not inside controllers.
- Valid roles are: `'customer'`, `'seller'`, `'admin'`.

### Input Validation
- All POST/PUT/PATCH routes must use `express-validator` (`body()`, `check()`, `param()`) validators
  declared in the route file.
- The controller must call `validationResult(req)` and return a `422` response if there are errors.
- Do not perform validation inside controllers or services.

### Error propagation
- All async controller functions must use `try/catch` and call `next(err)` in the catch block.
- Throw errors with a `status` or `httpStatusCode` property so the global error handler can pick up
  the correct HTTP status code.
- Example: `const err = new Error('Not found'); err.status = 404; throw err;`

---

## 4. Frontend Patterns

### API calls
- All HTTP calls from the frontend must use the helper functions from `client/src/lib/api.ts`:
  `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiUpload`.
- Never call `fetch()` directly in a component or hook.
- All mutations must go through `useMutation`. All reads must go through `useQuery`.

### TanStack Query conventions
- Query keys must be arrays: `['products']`, `['product', id]`, `['orders', userId]`.
- After a mutation's `onSuccess`, invalidate the relevant query keys to keep the cache in sync.
- Do not manually manage loading or error state for server data — use `isLoading`, `isError`
  from TanStack Query.

### Component conventions
- Components must be function components. Never use class components.
- Declare components with named `export function` (not `export default`) for better tree-shaking
  and import clarity.
- Props interfaces must be named `[ComponentName]Props`.
- Co-locate the component, its test, and its feature-specific hook in the same feature folder.

### Type conventions
- All API response types and domain types must be defined in `client/src/types.ts`.
- When a custom hook needs an intermediate type (e.g., a request payload), define it in the
  same hook file with a descriptive name.

### i18n conventions
- Every user-visible string must use the `t('key')` function from the `useI18n()` hook.
- Add new translation keys to both the `en` and `ar` sections of `TRANSLATIONS` in `i18n.tsx`.
- Never hardcode English strings in JSX — always use a translation key.

---

## 5. Mongoose Model Conventions

- Every schema must use `{ timestamps: true }`.
- Sub-schemas that are reused across multiple documents must be defined as a named `Schema`
  variable before the main schema.
- Required fields must have `required: true`. Fields with a fixed set of values must have `enum`.
- Payment-sensitive data (card numbers, CVVs) must NEVER be stored. Only PCI-safe metadata
  (last 4 digits, card brand, expiry) may be stored.
- Always use `$addToSet`, `$pull`, `$inc` for atomic array/counter updates rather than loading
  and re-saving entire documents.

---

## 6. Testing Conventions

### Backend (Vitest + Supertest)
- Test files live in `test/api/` and are named `<feature>.test.js`.
- Use the global test setup in `test/setup.js` (MongoMemoryServer, `beforeAll`/`afterEach`/`afterAll`).
- Import `app` from `../../app.js` for Supertest — never boot the real server.
- Run all backend tests with: `npm test` (from the project root).

### Frontend (Vitest + Testing Library)
- Test files live alongside the component they test: `<ComponentName>.test.tsx`.
- Use `@testing-library/react` for rendering and `@testing-library/user-event` for interactions.
- Use `msw` to mock API responses — never mock `fetch` directly.
- Run frontend tests from the `client/` directory.

---

## 7. Security — Project-Specific

- Paymob webhook endpoints (`/api/paymob/webhook`, `/api/paymob/callback`) are CSRF-exempt
  because they use HMAC-SHA512 signature verification via `verifyHmacSignature()` in
  `services/paymobService.js`. All other mutation endpoints require a valid CSRF token.
- The session secret is read from `SESSION_SECRET` in `.env`. Never generate it at runtime
  in production code — always require it from the environment.
- Rate limiting is applied to all auth endpoints via `express-rate-limit` with a 15-minute window.
  Do not remove or weaken these limits.
- Helmet is configured with `contentSecurityPolicy: false` for Vercel compatibility. Do not
  enable CSP without first configuring it properly for the CDN and asset URLs.

---

## 8. Environment & Deployment

- The app is deployed to **Vercel** as a serverless function. The DB connection is managed
  by a cached singleton in `util/db.js` — never call `mongoose.connect()` directly.
- File uploads go to `os.tmpdir()` on Vercel and `images/` locally. This is handled in `app.js`.
  Do not hardcode upload paths.
- The frontend SPA build must be output to `public/app/` (served statically by Express).
  The build command is `npm run build` from the project root.
- Environment variables required by the app are documented in `.env.example`. Always keep
  `.env.example` up to date when adding new env vars.

---

## 9. Repository Guardrails & Migration Isolation

- **DO NOT add, stage, commit, or push `POSTGRES_MIGRATION.md` in this repository.**
  This specification file belongs strictly to the upcoming `atelier-market-postgres` repository (where it will live as `docs/POSTGRES_MIGRATION.md`) and must never be tracked or committed to the MongoDB edition repository.
- **Future Task (Post-Migration):** Once the PostgreSQL edition is fully deployed, update `README.md` in this repository with a prominent cross-link to the PostgreSQL edition live demo and repository, and align inventory/search descriptions.

---

## 10. Local Environment Services (Docker & PostgreSQL)

- **Do NOT attempt to auto-start Docker Desktop or PostgreSQL services via background scripts or commands.**
- Docker and PostgreSQL services are intentionally configured not to start on Windows startup. Whenever Docker or PostgreSQL is needed and not running, **ask the user directly to start them manually**.

