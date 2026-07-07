# CLAUDE.md — Logbook

Quick reference for Claude Code sessions in this repo. Read `README.md` for
user-facing context and tool-choice rationale.

## Stack

- **Framework**: TanStack Start (Vite) — file-based routes in
  `app/routes/`, server functions via `createServerFn`. Dev and the
  production CF build both run through `@cloudflare/vite-plugin`
  (reusing Vite's `ssr` env so the TanStack Start server-fn transformer
  is applied). Nitro is only wired in for `npm run build:node`.
- **Runtime targets**: Cloudflare Workers (primary) and Node self-host
  (Docker image). The runtime seam is kept small: `app/db/client.ts`,
  `app/storage.server.ts`. Everything else is isomorphic.
- **DB connection**: `getDb()` is **async** — on Workers it dynamically
  imports `cloudflare:workers` and uses `env.HYPERDRIVE.connectionString`,
  returning a fresh client per request (Hyperdrive pools under the hood).
  On Node it falls back to `DATABASE_URL` with a process-wide singleton.
  All callers `await getDb()`.
- **ORM**: Drizzle, Postgres dialect, postgres-js driver.
- **DB**: Postgres 16 everywhere. Extensions enabled in the initial
  migration: `pg_trgm`, `vector` (pgvector). `logs.search_tsv` is a
  generated column with a GIN index — use `searchLogs()` for FTS.
- **Lint/format**: Biome 2 (`biome.json`). No ESLint/Prettier.
- **Tests**: Vitest (integration, hits real local Postgres). Playwright
  e2e smoke tests in `e2e/` (registration, login, vehicle+log CRUD).
- **Auth**: TanStack Start `useSession` in `app/auth/session.server.ts`,
  wrapped by `loginFn`, `signupFn`, `logoutFn`, `getCurrentUserFn` in
  `app/auth/server-fns.ts`. bcryptjs for hashing.
- **MCP server**: remote MCP at `/mcp` (CF-only — needs Durable Objects +
  KV). `server.ts` wraps the TanStack handler in `workers-oauth-provider`
  (OAuth 2.1: dynamic client registration, PKCE, tokens in `OAUTH_KV`);
  `app/mcp/agent.server.ts` is the `McpAgent` (agents SDK) whose tools
  wrap `app/models/*` with the token's `userId`. `/authorize` (route)
  renders consent and reuses session login; `app/mcp/oauth-context.server.ts`
  carries the per-request `env.OAUTH_PROVIDER` helpers into the route via
  AsyncLocalStorage. Worker entry is `server.ts` (`main` in wrangler.jsonc).
- **Styling**: Tailwind v4 via `@tailwindcss/vite`. No `tailwind.config.ts`,
  no PostCSS — `@import "tailwindcss"` in `app/styles.css`.
- **Package manager**: npm, lockfile `package-lock.json`. Node 24+.

## Common commands

```sh
npm run docker:dev      # start local Postgres (pgvector/pgvector:pg16 on :5440)
npm run db:migrate      # apply Drizzle migrations
npm run db:seed         # scott@example.com / scottiscool + vehicle, log, reminders, project
npm run scan:extract -- <folder>            # Scan Bay: scans → review JSON (local Ollama)
npm run scan:import -- <review.json> --vehicle <id> [--user <id>] [--reminders]
npm run db:generate     # after schema changes
npm run db:studio       # Drizzle Studio against local DB
npm run dev             # Vite dev server on :3000
npm run build           # Cloudflare Workers build → dist/
npm run build:node      # Node/Nitro build → .output/ (WIP — see README)
npm run typecheck       # runs `tsr generate && tsc --noEmit`
npm run lint            # biome check
npm run lint:fix        # biome check --write
npm test -- --run       # vitest single pass
npm run validate        # typecheck + lint + test
npm run test:e2e        # playwright smoke tests (needs dev server + DB)
```

## Conventions

- **Server-only modules end in `.server.ts` / `.server.tsx`** — Vite
  tree-shakes them out of the client bundle. Anything touching Drizzle,
  `useSession`, or filesystem/R2 belongs in a `.server.ts` file.
- **Data layer lives in `app/models/*.server.ts`**. Routes import from
  `~/models/...`, not from `~/db/client` directly.
- **Auth is two layers: route guard + server function check.**
  `/_authed` layout enforces auth in `beforeLoad` via `getCurrentUserFn`
  (redirects to `/login` if no session). Server functions additionally
  call `requireAuth()` from `~/auth/session.server` for defense-in-depth.
- **`throw redirect()` only works in `beforeLoad`/loaders.** When a
  `createServerFn` handler throws `redirect()` and is called from a
  client event handler, the redirect arrives as a 307 Response the
  router never sees. Server functions called from forms must **return
  data** and let the client navigate — use `window.location.assign()`
  for auth (forces full reload to pick up session cookie) or
  `useNavigate()` for mutations.
- **Access is membership-based, not owner-only.** `vehicle_members` grants
  crew access (roles: `owner` | `member`); every vehicle-scoped model
  function calls `requireVehicleAccess({ vehicleId, userId })` from
  `~/models/member.server` (or joins on `vehicle_members`). Owner-only
  ops (delete vehicle, manage crew) use `requireVehicleOwner`. The
  vehicle's `userId` column remains the owner. Invites for unknown
  emails live in `vehicle_invites` and are claimed in `signupFn`.
- **Ownership checks in queries**: any model function that takes an `id`
  must scope by `userId` (membership) too. See `getVehicle({ id, userId })`.
- **Semantic color tokens, not raw palette classes** in app UI: use
  `bg-surface`/`bg-card`/`bg-sunken`, `text-ink`/`text-ink-muted`,
  `border-line`, `bg-accent`, `text-danger`/`warn`/`ok` (defined via
  `@theme inline` in `app/styles.css`). Dark mode toggles a `.dark` class on
  `<html>` (palette swap only — no font-size change, so the layout never
  shifts; `ThemeToggle` in `_authed.tsx` persists `logbook-theme`, and a
  pre-paint script in `__root.tsx` applies it / falls back to the OS
  `prefers-color-scheme`) — raw slate/red classes won't reskin. The brand
  mark is `app/components/Logo.tsx` (folder + car silhouette, `currentColor`).
  Shared class recipes live in `app/components/ui.ts`.
- **Branded error + not-found pages.** The root route (`__root.tsx`) sets
  `errorComponent` and `notFoundComponent` to render `ErrorState`
  (`app/components/ErrorState.tsx` — a sad broken-down car) inside the document
  shell; `RootDocument` takes `children` so the same `<html>` shell wraps the
  normal, error, and not-found views. Public-route loaders (e.g. `/`) must not
  hard-depend on a DB/session lookup — wrap `getCurrentUserFn()` in try/catch
  and degrade to the logged-out view so a stale cookie or DB blip can't crash
  the page.
- **Dev server env comes from `.dev.vars`**, not the host process env —
  the Cloudflare vite plugin runs SSR in workerd, which can't see shell
  exports. Node-side tooling (drizzle-kit, seed, vitest) still reads
  `DATABASE_URL` from the environment / `.env`. Keep both files in sync
  (both are gitignored).
- **Path alias**: `~/*` → `./app/*`.
- **Biome `useHookAtTopLevel` is disabled for `.server.ts`, `server-fns.ts`,
  and `app/routes/**`** because TanStack Start's `use*`-named helpers are
  server-side, not React hooks.

## Safety rules (non-negotiable)

- Do NOT skip auth — every server function that reads/writes user data
  calls `requireAuth()` first (returns `userId` or throws redirect).
- Do NOT return another user's data — every query takes a `userId` and
  filters on it. Same for vehicleId → userId, logId → userId+vehicleId.
- Do NOT import `~/db/client` from a route — go through `~/models/...`.
- Do NOT commit `.env` or Cloudflare secrets.
- Do NOT weaken the Biome config to silence violations.
- Do NOT bypass Drizzle migrations on production (both `wrangler deploy`
  CI and self-host first-start run `drizzle-kit migrate`).

## Files to know

1. `app/db/schema.ts` — all tables + pgvector + tsvector setup
   (incl. `log_attachments`: scans/photos/docs attached to a log;
   `vehicles.vin`: backfilled from receipts, never overwritten;
   `vehicles.engine`: free-text engine description, filled by vPIC decode,
   always user-editable;
   `vehicles.purchasedAt`/`purchasePrice`/`purchaseOdometer`/`seller`/
   `purchaseNote`: owner-editable acquisition details (Documents tab);
   `vehicle_documents`: files attached directly to a vehicle (purchase
   contract, title, registration, insurance), tagged by `kind` (vocab in
   `document.shared.ts`), with `extracted_text` (best-effort OCR on image
   upload) feeding a generated `search_tsv` GIN index for word-in-scan search;
   `logs.service_started_at` + `serviced_at`: service start and
   close/completion dates — a single-date receipt fills only the close;
   `odometer_readings`: standalone mileage entries (odometer, read_at, note,
   user_id) — "last odometer" is latest-by-date across logs + manual readings,
   ties broken by higher miles;
   `google_connections`: per-user Google Drive OAuth-client tokens (Logbook is
   the OAuth *client* here, the opposite role from the MCP server) — `drive.file`
   scope only, refresh token AES-GCM encrypted at rest, access token cached;
   `drive_synced_files`: idempotent map of synced source → Drive file/folder id
   so re-syncing skips already-uploaded blobs and reuses folders)
2. `app/db/client.ts` — postgres-js client, runtime-aware
3. `app/db/migrations/` — generated SQL (do not edit by hand unless
   adding CREATE EXTENSION-style ops that Drizzle can't infer)
4. `app/auth/session.server.ts` — session cookie config + `requireAuth()`
5. `app/auth/server-fns.ts` — login/signup/logout/currentUser server fns
6. `app/storage.server.ts` — `Storage` interface + LocalFS + R2 drivers;
   `getStorage()` auto-resolves the R2 `UPLOADS` binding on Workers (lazy,
   via `cloudflare:workers`), LocalFS elsewhere
7. `app/models/*.server.ts` — the only place that imports from `~/db/client`;
   `member.server.ts` (crew/invites/access), `reminder.server.ts`
   (date+mileage due, recurring roll-forward), `project.server.ts`
   (builds + parts pipeline; status vocab in `project.shared.ts` because
   client code can't import values from `.server.ts` modules),
   `attachment.server.ts` (log attachments — uploads via storage layer +
   row insert, access checked against the log's vehicle),
   `document.server.ts` (vehicle documents — upload + best-effort OCR via
   `transcribeImage`, FTS via `searchVehicleDocuments`, retag, uploader-or-
   owner delete, blob reap on vehicle delete; kind vocab in
   `document.shared.ts` because client routes can't import from `.server.ts`),
   `mechanic.server.ts` (vendors/shops — case-insensitive find-or-create;
   logs link via `logs.mechanicId`, the logs list filters by vendor),
   `odometer.server.ts` (union latest across logs + manual readings, batch
   helper, history, create/delete — deletes restricted to author-or-owner),
   `vehicle-form.server.ts` (shared parse + avatar store + avatar reap for
   create and edit routes),
   `export.server.ts` (`buildUserExport` — the full "your data" JSON bundle,
   shared by the `/account/export` download and the Drive sync),
   `google-drive.server.ts` (one-way app → Drive sync: connection CRUD with
   token refresh/caching, `syncToDrive` over owned vehicles' documents + log
   attachments + the JSON export, idempotent via `drive_synced_files`)
8. `app/lib/` — isomorphic client utilities (safe to call from route
   components): `image.ts` (`downscaleImage` — shared JPEG downscale used
   by the scan page ~1600px and avatar uploads ~1024px; deliberately NOT
   named `.client.ts` because TanStack Start's import-protection denies
   `*.client.*` imports from SSR-reachable route components — functions are
   only called inside browser event handlers; `cropImage` — same module,
   crops to a fractional sub-rect for the `ImageCropper` modal
   (`app/components/ImageCropper.tsx`, pointer-drag crop used before
   scan/document upload; pass `aspect` for square avatar crops)),
   `document-scan.ts` (OpenCV.js document flattening — `detectDocumentQuad` +
   `warpDocument` deskew a photographed page; pure geometry helpers are
   unit-tested; drives the `DocumentScanner` modal) + `opencv.ts` (lazy
   OpenCV loader — see below), `vpic.ts` (NHTSA vPIC
   client — VIN decode prefills year/make/model/trim/engine; make/model
   datalist suggestions; browser-direct CORS calls, no API key, 5s timeout,
   degrades gracefully to plain free-text)

   **OpenCV.js is self-hosted, not bundled.** `scripts/copy-opencv.mjs`
   copies the ~10MB UMD build from node_modules into `public/opencv.js`
   (gitignored; runs on postinstall + dev + build). `app/lib/opencv.ts`
   injects it via a `<script>` on first scan and waits for
   `window.cv`/`onRuntimeInitialized`. A bundler `import()` would drag the
   10MB into the Cloudflare Worker upload even though it only runs in the
   browser — the static asset keeps the Worker lean (~700KB gzip) and the
   file edge-caches after first download.
9. `app/scan/` — Scan Bay. `receipt.ts` is the isomorphic extraction
   contract (JSON schema + prompt + `normalizeReceipt`/`receiptToNotes`);
   `extract.server.ts` is the runtime seam (Workers AI binding on CF,
   Ollama fallback on Node — `ollama.server.ts`; also exports
   `transcribeImage`, the best-effort plain-text OCR that makes uploaded
   vehicle documents searchable); `import.server.ts` is
   `createLogWithScan` (log + attachment + optional reminder), shared by
   the batch CLI (`scripts/scan-bay/`) and the in-app scan page.
10. `app/routes/*` — file-based routes, including `/files/$` streaming
    route, `/account/export` JSON bundle endpoint,
    `_authed.vehicles.$vehicleId.scan.tsx` (in-app receipt scan),
    `_authed.vehicles.$vehicleId.odometer.tsx` (current reading + source +
    quick-add form + history with author-or-owner delete),
    `_authed.vehicles.$vehicleId.edit.tsx` (owner-only vehicle edit:
    name/year/make/model/trim/engine/VIN/avatar),
    `_authed.vehicles.$vehicleId.documents.tsx` (Documents tab: owner-only
    purchase-details panel + tagged document upload + FTS search box over
    OCR'd text/label/filename + document list with retag and uploader-or-
    owner delete), `authorize.tsx`
    (OAuth consent for the MCP server — server handlers only, renders
    plain HTML, reuses session auth), and the Google Drive connect flow
    `auth.google.start.tsx` / `auth.google.callback.tsx` (server handlers:
    redirect to Google consent with a signed `state`, exchange the code,
    store the connection; both land back on `/profile?drive=…`). The Drive
    sync panel (connect / sync-now / disconnect) lives on
    `_authed.profile.tsx`. `app/components/VehicleForm.tsx`
    is the shared create/edit form (vPIC assists + avatar downscale)
11b. `app/google/` — Google Drive integration helpers (server-only): `oauth.server.ts`
    (`drive.file` + `openid email` scopes, code/refresh exchange, revoke,
    `isGoogleDriveConfigured`), `drive.server.ts` (minimal Drive v3 REST —
    create folder, multipart upload, update content, existence check),
    `crypto.server.ts` (AES-GCM at-rest encryption of refresh tokens, keyed by
    `GOOGLE_TOKEN_KEY`), `state.server.ts` (stateless HMAC-signed OAuth `state`
    keyed by `SESSION_SECRET`, bound to the user). Creds come from
    `process.env` (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, `GOOGLE_TOKEN_KEY`) —
    same `process.env` path as `SESSION_SECRET`, so no new wrangler binding.
11. `server.ts` + `app/mcp/` — Worker entry (`main` in wrangler.jsonc):
    wraps the TanStack handler in `workers-oauth-provider`, mounts
    `LogbookMCP.serve("/mcp")`, and re-exports the `LogbookMCP` Durable
    Object. `agent.server.ts` defines the MCP tools (`list_vehicles`,
    `get_vehicle_status`, `whats_due`, `log_work`, `complete_reminder`,
    `list_projects`, `add_project_item`, `update_item_status`) as thin
    wrappers over `app/models/*` using the OAuth token's `userId`;
    `oauth-context.server.ts` is the AsyncLocalStorage bridge that gets
    `env.OAUTH_PROVIDER` into the `/authorize` route. `app/env.d.ts`
    declares the bindings on `Cloudflare.Env`. E2E coverage:
    `e2e/mcp-oauth.spec.ts` (register → login → consent → PKCE token →
    MCP initialize/tools-list → 401 anon).
12. `wrangler.jsonc` — Cloudflare Workers config (Hyperdrive, R2, Workers
    AI, `OAUTH_KV` KV namespace, `MCP_OBJECT` Durable Object, secrets).
    The `ai` binding is remote-only; dev keeps remote bindings OFF unless
    `CF_REMOTE_BINDINGS=1` (see vite.config.ts), so `npm run dev` never
    requires `wrangler login`.
13. `drizzle.config.ts` — Drizzle Kit config
14. `tsr.config.json` — TanStack Router CLI config; drives
    `app/routeTree.gen.ts` generation (the file is gitignored, so
    `npm run typecheck` regenerates it via `tsr generate` first)
15. `biome.json` — lint/format rules
16. `Dockerfile` + `docker/s6-rc.d/` — single-container self-host image
17. `docker-compose.yml` — dev Postgres only (not for self-host)

## Git conventions

- **Squash merge only** — each PR becomes one commit on `main`.
- **Conventional commits** — PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, with
  optional scopes (`feat(db): ...`). Breaking changes use `feat!:` or
  include `BREAKING CHANGE:` in the body.
- PR title = commit message; PR body = commit description. Write clear,
  descriptive PR titles — they become the permanent history.

## Pit Crew — agent automation workflows

See the README "Pit Lane" section for the full flow and issue labels.

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | PRs | Biome + TypeScript + Vitest + CF build |
| `deploy.yml` | push to main/dev | Apply Drizzle migrations to Neon, then `wrangler deploy` |
| `groom-issues.yml` | issues, `/groom` comments | Service Writer: evaluates + plans + labels |
| `build-next.yml` | `/build` command or dispatch | Wrench: implements a groomed issue, opens PR |
| `build-issue.yml` | `/build` comment | Routes to `build-next.yml` |
| `test-driver.yml` | `test-drive` label or `/test-drive` comment | Posts a UX/a11y test plan |
| `claude-review.yml` | `@claude` mention | Code review |

Agent persona docs (`SERVICE_WRITER.md`, `CHIEF_MECHANIC.md`, etc.)
describe each role's protocol — they still reference the old
Remix/Prisma stack in places and are queued for a refresh pass.

## Open issues to be aware of

- `npm run build:node` (Nitro + TanStack Start node preset) produces
  `.output/server/index.mjs` but runtime 404s on all routes — SSR
  fallback wiring. Tracked for the self-host image release.

## Deploy & ops gotchas (learned the hard way)

- **A new wrangler binding needs matching deploy-token perms.** `deploy.yml`
  authenticates with the `CLOUDFLARE_API_TOKEN` GitHub secret. Adding any
  binding to `wrangler.jsonc` (KV, R2, Durable Object, Hyperdrive…) requires
  that token to carry the matching *Edit* permission. Symptom when it's
  missing: `wrangler deploy` uploads every asset, **then** fails at the
  script-update step with `A request to the Cloudflare API ... failed ...
  kv bindings require kv write perms [code: 10023]` — so prod silently stops
  updating while the build looks fine. This froze production from the MCP PR
  (#59 added `OAUTH_KV`) until the token gained `Workers KV Storage:Edit`.
  Fix lives in the Cloudflare dashboard token, not the repo.
- **Cloudflare secrets are per-Worker-script; a rename drops them.** When
  `name` in `wrangler.jsonc` changed (`vehicle-work-log` → `logbook`), the
  new script started with **no** secrets and the app threw at runtime
  (`SESSION_SECRET must be set and at least 32 characters long`). After any
  Worker rename, re-run `wrangler secret put` for every secret on the new
  name: `SESSION_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`,
  `GOOGLE_TOKEN_KEY`. (Same trap if a "missing env" error appears in prod but
  not dev — dev reads `.dev.vars`, prod reads the Worker's secrets.)

## Next up (June 2026, in priority order)

### 1. Scan Bay — paper shop-record ingestion (local AI, $0)

The app's core purpose is digitizing Scott's vehicle maintenance records,
including a backlog of paper shop invoices.

- **Phase 1 (DONE) — batch CLI.** `scripts/scan-bay/` + local Ollama
  (`qwen3-vl:8b`, JSON-schema structured output via `format` on `/api/chat`,
  temp 0). Two steps with a human review between: `npm run scan:extract --
  <folder>` writes a `scan-review.json`; edit it; `npm run scan:import --
  <review.json> --vehicle <id> [--reminders]` creates a log per invoice via
  the model layer, stores the original scan as a `log_attachments` row, and
  (with `--reminders`) drafts a reminder from `recommendedWork`. Idempotent —
  imported entries are stamped with their logId. The extraction prompt +
  schema + normalizer live in `app/scan/receipt.ts` (isomorphic, so phase 2
  reuses them). Attachments render on the log detail page.
- **Phase 2 (DONE) — in-app one-off scans:** `/vehicles/$vehicleId/scan`
  (📷 button on the vehicle dashboard + logs list). Phone camera capture →
  client-side downscale (~1600px JPEG) → `extractReceiptScan()` in
  `app/scan/extract.server.ts` (Workers AI `@cf/meta/llama-3.2-11b-vision-
  instruct` w/ `response_format` json_schema on CF; Ollama fallback on
  Node/dev) → editable prefilled form → `createLogWithScan()` saves log +
  attaches the photo + optionally drafts a reminder from `recommendedWork`.
  Extraction failures degrade gracefully: the form opens blank and the
  photo still attaches on save.
- Deliberately NOT the Anthropic API — cost. Don't suggest it for this.

### 2. Logbook MCP server (DONE — see "Files to know" #11)

So the crew can talk to Logbook from their own Claude accounts
(claude.ai custom connector, works on mobile). NOTE: rally-specific
features stay OUT of the app — the app is generic vehicle maintenance;
rally procedure lives in Scott's external rebelle-rally skill, which
calls these MCP tools:

- **(DONE)** Remote MCP endpoint at `/mcp` on the existing Worker —
  Cloudflare `agents` SDK (`McpAgent`) + `workers-oauth-provider`, OAuth
  backed by the existing `users` table + session auth (login screen on
  connect; no API keys for end users). Deploy prereqs: `wrangler kv
  namespace create OAUTH_KV` (paste id into wrangler.jsonc) — the
  `MCP_OBJECT` Durable Object ships with the first deploy's migration.
- **(DONE)** Tools are thin wrappers over `app/models/*` so crew-membership
  authorization is enforced for free: `list_vehicles`, `log_work`,
  `whats_due`, `complete_reminder`, `get_vehicle_status`, `list_projects`,
  `add_project_item`, `update_item_status`.
- A rally-prep skill (Rebelle Rally — Scott has a draft) layers event
  procedure on top and calls these tools; keep event-specific content in
  the skill, generic data access in MCP.

## Documentation policy

When making code changes, update the relevant docs:

- `README.md` — user-facing docs, tool-choice rationale
- `CLAUDE.md` (this file) — quick reference for future sessions
- `docs/SELF_HOSTING.md` — self-host UX
- `app/db/schema.ts` + the generated migration — schema changes
- `.env.example` — any new env vars

Agent persona docs (`SERVICE_WRITER.md`, `CHIEF_MECHANIC.md`,
`CREW_CHIEF.md`, `TEST_DRIVER.md`, `AGENT.md`, `AGENTS.md`) are
pre-rewrite and need a refresh pass before they're accurate again.
