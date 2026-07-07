# Logbook

**Every vehicle's file.**

A home for everything about the vehicles you own — service history, receipts,
documents, parts, odometer, cost, and notes, for every rig (car, truck, camper
van, motorcycle, whatever you drive). Not a walled app but a record you control:
export your whole history as JSON whenever you want, sync it to your own Google
Drive, talk to it from Claude, and run your own instance on a single
`docker run` if you don't want to rely on any hosted provider.

What it does today:

- **Work logs** — quick-capture form with tap-to-fill presets (oil change,
  brake pads, …), odometer/cost, and full-text search.
- **Odometer tracking** — standalone mileage entries (date + miles + optional
  note) supplement work-log odometer readings. The dashboard chip shows the
  latest reading with its date; the odometer page lists the full history with
  source (linked service log or manual) and lets any crew member add a reading.
- **Vehicle documents & purchase records** — a Documents tab on every
  vehicle holds the paperwork: purchase contract, title, registration,
  insurance, bill of sale. Upload images or PDFs, tag each by type, and
  record structured purchase details (date, price, seller, odometer at
  purchase). Snap a photo and either **scan it flat** — the app finds the
  document's corners and perspective-corrects the angle (all in the
  browser via OpenCV.js, no upload) — or crop it manually, before upload.
  Uploaded photos are OCR'd locally on save, so you can
  **search the words inside a scan** — find a policy number or VIN that
  only appears in the image. Documents ship in the JSON export too.
- **Crew sharing** — invite someone by email to any vehicle; members see
  and log everything on shared vehicles (invites for new emails are
  claimed automatically at signup).
- **Service reminders** — due by date *and/or* mileage, with recurring
  intervals (every 5,000 mi / 6 mo). Urgency is computed from the latest
  logged odometer, and logging the work completes the reminder and rolls
  it forward.
- **Projects** — plan bigger builds (e.g. rally prep): parts with prices
  and links through a proposed → ordered → received → installed pipeline,
  estimated vs committed budget, and a countdown to a target date.
- **Vehicle editing** — owners can update a vehicle's name, year, make,
  model, trim, engine, VIN, and avatar photo at any time. Typing a VIN
  calls the free NHTSA vPIC API directly from the browser (no key, no
  server round-trip) to prefill year/make/model/trim/engine; make/model
  fields offer datalist suggestions from the same source. Editing a VIN
  explicitly is intentionally allowed; scan-based backfill only fills a
  blank VIN.
- **Avatar photos** — vehicle photos are downscaled client-side (≤ 1024px
  JPEG) before upload, so 12 MB phone shots arrive as a few hundred KB.
  (HEIC works in Safari, which can decode it; other browsers fall back to
  the original file and the server's 2MB cap applies.)
- **Dark mode** — one tap flips the whole app between a light and a
  high-contrast dark palette (and it follows your OS preference until you
  choose). Color only — the layout never shifts. Mobile-first throughout,
  with fat touch targets for greasy-thumb use at arm's length.

This repo originally ran on Remix + Fly + Postgres + MinIO. It was rebuilt
from the ground up in 2026 on a TanStack Start stack targeting Cloudflare
Workers, with a first-class self-host path that ships as a single Docker
image.

## Stack

| Concern              | Choice                                       |
| -------------------- | -------------------------------------------- |
| Framework            | [TanStack Start](https://tanstack.com/start) (Vite, React 19) — CF Workers via `@cloudflare/vite-plugin` for dev + prod; Nitro for the self-host Node build |
| ORM                  | [Drizzle](https://orm.drizzle.team)           |
| Database             | Postgres 16 everywhere                       |
| Vectors / FTS ready  | `pgvector` + `pg_trgm` extensions on day one |
| File storage         | R2 (cloud) · local filesystem (self-host)    |
| Cloud deploy         | Cloudflare Workers + Hyperdrive + Neon + R2  |
| Self-host deploy     | Single Docker image (app + Postgres + data volume) |
| Lint / format        | [Biome 2](https://biomejs.dev)                |
| Tests                | Vitest (integration), Playwright e2e smoke tests |
| Auth                 | Cookie session via TanStack Start `useSession` + bcryptjs |
| Styling              | Tailwind v4                                  |

### Why these choices

The interesting decisions, so future me and you know why things are the way
they are:

- **Postgres everywhere instead of SQLite + D1.** Text search is already
  wired up (`tsvector` + GIN index on `logs`), and the near-term plan
  includes a chat agent that will want embeddings. `pgvector` makes that a
  one-system story; SQLite would force a separate vector DB. Neon's free
  tier covers this app easily on Cloudflare, and the self-host image ships
  with Postgres baked in so users still get one-command install.
- **Drizzle over Prisma.** Drizzle is lightweight and edge-runtime-friendly,
  works on Cloudflare Workers via Hyperdrive without a second schema
  language, and generates plain SQL migrations you can read.
- **Cloudflare Workers over Fly.** Lower cost at this scale, globally
  distributed by default, and the R2 + Hyperdrive + Workers combo removes
  the previous custom Fly-region replay Express server entirely.
- **Biome over ESLint + Prettier.** One binary, one config, dramatically
  faster. Replaces everything we were doing before except a handful of
  domain-specific plugins we didn't actually need.
- **TanStack Start over staying on Remix.** Same file-based routing model
  we liked, but with server functions, better typed router, and a Vite
  build pipeline that retargets Cloudflare Workers or Node from one codebase.
- **Local filesystem on self-host, R2 in the cloud.** A single `Storage`
  interface with two drivers. The URL shape (`/files/<key>`) is identical
  on both — there's no presigned-URL dance on self-host.
- **Data export as a core feature.** `GET /account/export` returns your
  entire record as a versioned JSON bundle. Self-hosting is pointless if
  you can't get your data out.

## Quick start (local dev)

Prereqs: Node 24+, Docker.

```sh
# 1. Install deps
npm install

# 2. Start local Postgres (pgvector image, on port 5440)
npm run docker:dev

# 3. Seed env — .env feeds Node tooling (drizzle-kit, seed, vitest);
#    .dev.vars feeds the dev server's SSR, which runs inside workerd via
#    the Cloudflare vite plugin and can't see your shell env.
cp .env.example .env
cp .env.example .dev.vars
# (SESSION_SECRET must be ≥ 32 characters; keep both files in sync)

# 4. Run migrations + seed
npm run db:migrate
npm run db:seed

# 5. Run the dev server
npm run dev
```

Open http://localhost:3000. Seed login: `scott@example.com` / `scottiscool`.

### Useful commands

```sh
npm run dev            # vite dev server
npm run build          # Cloudflare build (dist/)
npm run build:node     # Node/Nitro build (.output/)
npm run typecheck      # tsc --noEmit
npm run lint           # biome check
npm run lint:fix       # biome check --write
npm test               # vitest (watch)
npm test -- --run      # single pass
npm run db:generate    # drizzle-kit generate (after schema changes)
npm run db:migrate     # apply pending migrations
npm run db:studio      # drizzle-kit studio
npm run validate       # typecheck + lint + test (CI equivalent)
npm run scan:extract -- <folder>          # Scan Bay: scans → review JSON
npm run scan:import  -- <review.json> --vehicle <id>   # review JSON → logs
```

## Self-hosting

The self-host image bundles the Node app + Postgres 16 + s6-overlay in a
single container. One command, one mounted volume:

```sh
docker run -d \
  -p 3000:3000 \
  -v logbook-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  ghcr.io/scottprue/logbook:latest
```

Everything persistent (Postgres cluster + uploaded files) lives under
`/app/data`, so backing up is as simple as snapshotting the volume.

See `docs/SELF_HOSTING.md` for upgrades, backups, and exporting your data.

> Note: The self-host image is being finalized — `npm run build:node` has an
> outstanding Nitro + TanStack Start integration issue tracked in the
> Phase 5 TODO. Until that's resolved, self-host users can clone the repo
> and run the dev server directly, or wait for the tagged image release.

## Deploying to Cloudflare Workers

Prereqs: a Cloudflare account, a Neon Postgres database, an R2 bucket, and
a Hyperdrive binding pointing at the Neon connection string.

Set up a Neon Postgres database if you don't have one yet — create an
account at [neon.tech](https://neon.tech) (the free tier works fine), then
initialize a project with the CLI:

```sh
npx neonctl@latest init
```

This will auth you and create a project. Copy the connection string — that's
your `$NEON_URL` for the steps below.

Next, enable R2 in the Cloudflare dashboard if you haven't already:
**Storage & Databases → R2 Object Storage → Overview** (the free tier is
more than enough for this app).

```sh
# Create R2 bucket
npx wrangler r2 bucket create logbook-uploads

# Create Hyperdrive over Neon
npx wrangler hyperdrive create logbook-db --connection-string="$NEON_URL"
# paste the returned id into wrangler.jsonc under hyperdrive[0].id

# Create the KV namespace that stores MCP OAuth grants/tokens
npx wrangler kv namespace create OAUTH_KV
# paste the returned id into wrangler.jsonc under kv_namespaces[0].id

# Set SESSION_SECRET for the Worker
npx wrangler secret put SESSION_SECRET

# Apply migrations to Neon (one-off; CI does this automatically)
DATABASE_URL=$NEON_URL npm run db:migrate

# Deploy
npm run deploy:cf
```

CI (`.github/workflows/deploy.yml`) does steps 3–5 automatically on push
to `main` (production) and `dev` (staging). Required secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_DATABASE_URL`.

Create the `CLOUDFLARE_API_TOKEN` at
**My Profile → API Tokens → Create Token** with these permissions:

- **Account / Workers Scripts** — Edit
- **Account / Workers R2 Storage** — Edit
- **Account / Hyperdrive** — Edit

Scope it to the account you're deploying to.

## Pit Lane — maintenance & feature development (Claude agents)

Day-to-day maintenance and feature work on this project is run by the **Pit
Crew**, a team of Claude Code agents that live as GitHub Actions. They turn
GitHub Issues into a roadmap and groomed issues into PRs. The personas are
named after shop/garage roles — if you're used to standard PM / Architect /
Builder terminology, the mapping is spelled out below.

### The Pit Crew

| Pit Crew name | Classic role | What it does | Lives in |
|---------------|--------------|--------------|----------|
| **Service Writer** | Product Manager | Triages new issues, sets priority/complexity/milestone, writes up the full spec, gatekeeps scope & security | `SERVICE_WRITER.md` + `.github/workflows/groom-issues.yml` |
| **Chief Mechanic** | Software Architect | Periodic architecture review (auth/ownership audit, N+1 scan, schema hygiene, route-boundary error handling) — files issues for what it finds | `CHIEF_MECHANIC.md` |
| **Crew Chief** | DevOps / Platform Engineer | Periodic CI/CD & infra review (workflows, Dockerfile, Cloudflare deploy, secrets) — files `area:devops` issues | `CREW_CHIEF.md` |
| **Wrench** | Builder / feature implementer | Picks a groomed issue, branches, implements against acceptance criteria, runs tests, opens a PR with `Closes #N` | `.github/workflows/build-next.yml` + `.github/workflows/build-issue.yml` |
| **Test Driver** | QA / UX reviewer | On-demand UX/a11y review — triggered by the `test-drive` label or a `/test-drive` comment on a PR; posts affected flows, a manual test plan, and mobile notes | `TEST_DRIVER.md` + `.github/workflows/test-driver.yml` |

See `AGENTS.md` for the full project context each agent reads.

### Flow

1. **Open an issue** using the bug or feature template. The **Service
   Writer** auto-grooms it: scope check → security check → priority
   (`priority:P0`–`P3`) → complexity (`complexity:S`–`XL`) → phase
   milestone, and then either
   - asks clarifying questions (`status:needs-clarification`) — reply on
     the issue and grooming re-triggers automatically, or
   - writes the full spec (Problem, Solution, Implementation Plan,
     Acceptance Criteria, Key Files, Constraints, Dependencies) and marks
     the issue `status:groomed`.
2. **Kick off a build** in one of three ways:
   - Comment `/build` on any groomed issue → a **Wrench** claims it
     (`status:in-progress`), branches, implements against the acceptance
     criteria, runs `npm run validate`, and opens a PR with
     `Closes #<number>`.
   - Manually run the **Build Next** workflow with no input to auto-pick
     the highest-priority groomed issue.
   - Manually run **Build Next** with a specific issue number.
3. **Test Driver** posts a review comment on the PR when triggered — add
   the `test-drive` label or comment `/test-drive`. The comment lists
   the affected user flows, a concrete manual test plan, and
   UX/a11y/mobile notes.
4. **Review the PR.** Comment `@claude` anywhere on the PR to have the
   review agent (`claude-review.yml`) respond or make changes.
5. **Merge.** Squash-merge with a [conventional commit](https://www.conventionalcommits.org/)
   title (`feat:`, `fix:`, `chore:`, etc.). The issue auto-closes via
   `Closes #<number>` and `deploy.yml` ships the change to Cloudflare.

### Re-groom or reset an issue

Comment `/groom` on any issue to strip existing status labels and re-run
the full grooming protocol from scratch — useful after significant
discussion or when requirements change.

### Issue labels

| Label | Meaning |
|-------|---------|
| `status:needs-info` | Incomplete — waiting on reporter for basic information |
| `status:needs-clarification` | Design questions — Service Writer has technical/architectural questions; auto-retriggers grooming when answered |
| `status:groomed` | Fully specified — ready for a Wrench |
| `status:in-progress` | Claimed by a Wrench |
| `status:deferred` | Intentionally delayed |
| `area:devops` | CI/CD, Docker, Cloudflare, or workflow changes — skipped by `build-next` (GitHub Actions can't modify its own workflow files); the Crew Chief files these, humans or desktop Claude Code implement them |
| `priority:P0`–`P3` / `complexity:S`–`XL` | Set by the Service Writer during grooming |

### Required secret

Add `CLAUDE_CODE_OAUTH_TOKEN` to the repo's GitHub Actions secrets.
Without it the agent workflows will fail to authenticate.

### Running agents locally

The same prompts live under `.claude/commands/`. In a Claude Code session
you can run `/groom-issues` (Service Writer) or `/build-next` (Wrench,
with optional `devops` arg) locally — handy for `area:devops` work that
the automated Wrench can't do.

## Architecture

```
app/
  db/
    schema.ts           # Drizzle Postgres tables + tsvector + pgvector setup
    client.ts           # postgres-js client (works on Node + Workers)
    seed.ts             # scott@example.com + 2007 WRX
    migrations/         # drizzle-kit generated SQL
  models/
    user.server.ts      # getUserById, verifyLogin, createUser, ...
    vehicle.server.ts   # CRUD scoped to userId
    log.server.ts       # CRUD + searchLogs using tsvector
  auth/
    session.server.ts   # useAppSession (__session cookie)
    password.server.ts  # bcryptjs wrapper
    server-fns.ts       # loginFn / signupFn / logoutFn / getCurrentUserFn
  storage.server.ts     # Storage interface: LocalFS + R2 drivers
  routes/
    __root.tsx          # HTML shell, tailwind import
    index.tsx           # splash
    login.tsx, join.tsx, logout.tsx
    healthcheck.tsx     # server handler returning "ok"
    files.$.tsx         # streams uploaded files
    account.export.tsx  # GET → JSON bundle
    _authed.tsx         # authed layout
    _authed.vehicles.*  # vehicles CRUD
    _authed.vehicles.$vehicleId.logs.*  # logs CRUD
```

Server-only concerns end in `.server.ts` so the Vite build tree-shakes them
out of the client bundle.

## Data export

`GET /account/export` returns a versioned JSON bundle:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-04-22T...",
  "user": { "id": "...", "email": "...", "createdAt": "...", "updatedAt": "..." },
  "vehicles": [{ ..., "avatarUrl": "/files/..." }],
  "logs": [ ... ],
  "odometerReadings": [ ... ],
  "vehicleDocuments": [{ ..., "fileUrl": "/files/..." }],
  "mechanics": [ ... ],
  "tags": [ ... ],
  "parts": [ ... ],
  "logsToTags": [ ... ],
  "logsToParts": [ ... ]
}
```

`schemaVersion` gives future importers a hook to evolve the format without
breaking old bundles.

## Sync to Google Drive

Optionally back your records up to your own Google Drive. From **Profile →
Sync to Google Drive**, connect a Google account and hit **Sync now**: Logbook
creates a single `Logbook` folder and copies your vehicle documents, receipt
scans, and a full JSON export (the same bundle as above) into it, organized
per vehicle.

It uses Google's [`drive.file`](https://developers.google.com/drive/api/guides/api-specific-auth)
scope — the **least-privilege** Drive scope. Logbook can only see and modify
files **it created**; it can't list, read, or touch anything else in your
Drive. The sync is one-way (app → Drive) and idempotent: re-running only
uploads what's new and refreshes the JSON export. Disconnecting revokes the
grant at Google and drops the stored tokens.

Refresh tokens are encrypted at rest (AES-GCM) and the OAuth `state` is HMAC
-signed and bound to your session, so the connect flow can't be hijacked.

**Setup (operator).** The feature stays hidden until configured. In Google
Cloud Console: create an OAuth 2.0 **Web application** client, enable the
**Drive API**, set the consent screen's scope to `.../auth/drive.file`, and add
the redirect URI `https://<your-domain>/auth/google/callback` (plus
`http://localhost:3000/auth/google/callback` for dev). Then provide three
values — as Wrangler secrets on Cloudflare, or env vars for Node self-host:

```sh
# Cloudflare Workers
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_TOKEN_KEY        # openssl rand -base64 32
```

For local dev put the same three keys in `.dev.vars` (and `.env` for Node
tooling). See `.env.example`.

## Scan Bay — digitizing paper records

A big part of Logbook is getting a backlog of paper shop invoices into the
app. Scan Bay does that locally, for **$0** — it runs a vision model on your own
machine (Ollama + `qwen3-vl:8b` by default), so the receipts never leave your
laptop and there's no per-page API cost.

It's a two-step CLI with a human review in the middle:

```sh
# 1. Extract — read every image in a folder, write a review file
npm run scan:extract -- ~/Desktop/jeep-receipts
#   → ~/Desktop/jeep-receipts/scan-review.json

# 2. Eyeball scan-review.json — fix a misread date, flip an entry's
#    "status" to "skip" to exclude it. Then import:
npm run scan:import -- ~/Desktop/jeep-receipts/scan-review.json \
  --vehicle <vehicleId> --reminders
```

Each imported invoice becomes a work log (title, cost, odometer, service
start/end dates, line items in the notes) with the **original scan stored as
an attachment** on the log, and the shop linked as a **vendor** — the work
history can be filtered by vendor. Receipts that print the VIN can backfill
it onto the vehicle (checksum-validated, and only when the vehicle doesn't
already have one). `--reminders` also drafts a follow-up reminder from any
recommended work the tech noted ("front pads at 5mm, replace in ~5k mi").

Notes:

- Requires [Ollama](https://ollama.com) running locally with a vision model:
  `ollama pull qwen3-vl:8b`. Override with `OLLAMA_HOST` / `SCAN_MODEL`.
- `import` is idempotent — entries are stamped `imported` with their log id,
  so re-running the same review file is safe.
- `--vehicle` targets the vehicle; the acting user defaults to that vehicle's
  owner (override with `--user`). All writes go through the model layer, so
  crew-access checks apply.
- The extraction prompt + JSON schema live in `app/scan/receipt.ts`, shared
  with the in-app scan page below so both paths extract identically.

### In-app scans — snap it at the shop counter

For one-off receipts there's no need for the Mac: every vehicle has a
**📷 Scan receipt** button that opens the phone camera (or photo library),
reads the receipt, and prefills an editable work log — cost, odometer, date,
line items in the notes, plus a one-tap follow-up reminder when the tech
noted recommended work. The photo is attached to the log either way, so even
when extraction misses, you save the record first and fix fields later.

Before the photo is read, a **document scanner** detects the page's four
corners and flattens the perspective (drag a corner to fine-tune), so an
angled receipt straightens out — which both reads better and stores cleaner.
It runs entirely in the browser (OpenCV.js, lazy-loaded on first scan, no
upload); if it can't run you can crop manually or use the photo as-is.

How it extracts, by runtime:

- **Cloudflare Workers (production)**: the Workers AI binding
  (`@cf/meta/llama-3.2-11b-vision-instruct` on the free tier — override with
  a `SCAN_MODEL` Workers var) using the same JSON-schema structured output.
- **Node self-host / local dev**: falls back to the same local Ollama setup
  the batch CLI uses (`OLLAMA_HOST` / `SCAN_MODEL`).

Photos are downscaled client-side (~1600px JPEG) before upload, so a 12 MB
phone photo becomes a few hundred KB round-trip.

Dev note: Workers AI has no local simulator, so the binding is dev-disabled
unless you opt in with `CF_REMOTE_BINDINGS=1 npm run dev` (requires
`wrangler login`); without it, dev scans use local Ollama.

## Logbook MCP — talk to your garage from Claude

The Worker doubles as a remote MCP server at `/mcp`, so anyone on the crew
can connect Logbook to their own Claude account (claude.ai → Settings →
Connectors → Add custom connector → `https://<your-worker-domain>/mcp`)
and ask things like "what's due on the Jeep?" or "log the oil change I
just did at 87,420 miles" — from a phone, mid-wrench.

Auth is OAuth 2.1, but there are no new accounts and no API keys:
[`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
wraps the Worker and handles the protocol (dynamic client registration,
PKCE, token issue/refresh in the `OAUTH_KV` namespace), while the
`/authorize` consent screen reuses the app's session login against the
existing `users` table. The granted token carries only `userId`, and every
tool is a thin wrapper over `app/models/*` — so crew-membership
authorization applies to MCP exactly as it does in the app.

Tools: `list_vehicles`, `get_vehicle_status`, `whats_due`, `log_work`,
`complete_reminder`, `list_projects`, `add_project_item`,
`update_item_status`.

The MCP server runs on Cloudflare only (it needs Durable Objects +
Workers KV); the Node self-host image serves the app without `/mcp`.
Rally-specific procedure deliberately stays out of these tools — the app
stays generic, and event playbooks live in skills that call them.

## Roadmap

Near-term:

- Extend Playwright e2e coverage to avatar upload, export, crew invites,
  and reminder completion (registration/login/vehicle/log flows are covered)
- Finalize the single-container self-host image and publish the first GHCR
  release
- Fix the Nitro 3 + TanStack Start node-build integration so `npm run build:node`
  produces a working `.output/server/index.mjs`
- Reinstate the `_authed` `beforeLoad` guard once `useSession` works from
  loaders

Near-term, garage edition:

- Photos on existing work logs (the scan page attaches at creation; adding
  more photos to a saved log is the missing piece)
- Email/push notifications when a reminder goes overdue
- Fuel tracking (fill-ups double as cheap odometer updates for reminders)
- Printable maintenance history per vehicle (rally tech-inspection sheet)
- Event checklists on projects (recurring rally-prep template)

Beyond that:

- Chat agent backed by `pgvector` embeddings of log title + notes for
  semantic search ("when did I last replace the brake pads on the WRX?")
- Avatar zip download as a `/account/export.zip` companion to the JSON

## License

MIT.
