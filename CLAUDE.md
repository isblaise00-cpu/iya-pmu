# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three independent services in one repo, run as separate processes:

- [backend/](backend/) — Node.js/Express + Prisma, port **4000**, owns the schema and admin REST API
- [ai-engine/](ai-engine/) — Python/FastAPI + Playwright + Anthropic SDK, port **8000**, owns scraping/AI/scheduler
- [frontend/](frontend/) — React 18 + Vite + Tailwind + TanStack Query, port **3000**, admin SPA
- [database/](database/) — **stale duplicate of the Prisma schema (PostgreSQL variant). The live schema lives in [backend/prisma/schema.prisma](backend/prisma/schema.prisma).**

The root `package.json` is empty; there is no monorepo tooling, no workspace, no test runner, no linter configured anywhere. Each service installs and runs on its own.

## Database (important — README is misleading)

The README and [database/prisma/schema.prisma](database/prisma/schema.prisma) describe **PostgreSQL**, but the actual running stack is **MySQL**:

- [backend/prisma/schema.prisma](backend/prisma/schema.prisma) declares `provider = "mysql"`
- [ai-engine/database.py](ai-engine/database.py) connects via `mysql+aiomysql://` and defaults to `mysql://root:@localhost:3306/pmu_db`
- `requirements.txt` pulls `aiomysql`, no `asyncpg`/`psycopg`

Both services write to the same MySQL database. Prisma owns the schema. The AI engine has its own SQLAlchemy models (`Pronostic`, `Result`, `Setting`) that mirror Prisma's tables with explicit `Column('camelCaseName', ...)` aliases so SQLAlchemy reads/writes Prisma's column names. **When changing fields on those tables, update both [backend/prisma/schema.prisma](backend/prisma/schema.prisma) and [ai-engine/database.py](ai-engine/database.py) or they will silently desync.**

## Commands

### Backend ([backend/](backend/))
```
npm install
npx prisma generate                  # after schema changes
npx prisma migrate dev --name <name> # create + apply a new migration locally
npx prisma migrate deploy            # apply pending migrations (prod-safe)
npx prisma db seed                   # seeds plans, subscribers, pronostics, super admin
npm run dev                          # ts-node-dev, port 4000
npm run build && npm start           # tsc → dist/ → node
npx prisma studio                    # DB inspector
```

### AI engine ([ai-engine/](ai-engine/))
```
pip install -r requirements.txt
playwright install chromium          # required for equidia + pmu.fr scrapers
uvicorn main:app --reload --port 8000
```
On Windows, [main.py](ai-engine/main.py) sets `WindowsProactorEventLoopPolicy` for Playwright compatibility — keep that early in any new entry point.

### Frontend ([frontend/](frontend/))
```
npm install
npm run dev                          # vite, port 3000
npm run build                        # tsc + vite build
```

### Tests
None configured. There is no test framework, no `*.test.*` files, no CI. If asked to add a test, propose the framework first.

## High-level architecture

### Daily pronostic pipeline (how data flows)

1. **Scheduler fires** ([ai-engine/scheduler.py](ai-engine/scheduler.py)) at the `scraping_time` setting (default `07:00`), which is read from the `settings` table on startup ([main.py:101-109](ai-engine/main.py#L101-L109)).
2. **`run_scraping`** ([main.py:22-60](ai-engine/main.py#L22-L60)) deletes pronostics older than yesterday, then calls `scrape_all_sources` ([scraper.py](ai-engine/scraper.py)) which runs three scrapers concurrently: `canalturf` and `zone-turf` via aiohttp + BeautifulSoup, `equidia` via Playwright (JS-rendered).
3. **`synthesize_pronostic`** ([ai_engine.py](ai-engine/ai_engine.py)) sends combined source text to the LLM. Provider is selected by `AI_PROVIDER` env (`anthropic` | `groq` | `mock`); falls back to a deterministic mock if the key is missing or the response can't be JSON-parsed. Output schema: `base_horse`, `tierce`, `quarte`, `quinte`, `outsider`, `confidence_score`, `commentary`.
4. **Saved** as a `Pronostic` row with `is_sent=False`.
5. **Admin reviews/edits** in the frontend (sets `modifiedByAdmin=true` via [PUT /api/pronostics/:id](backend/src/routes/pronostics.ts)).
6. **Admin clicks "Send"** → `POST /api/pronostics/:id/send` → [`sendPronosticToActiveSubscribers`](backend/src/services/sms.service.ts) renders the `sms_default_prono` template (placeholders: `{date} {base} {tierce} {quarte} {quinte} {outsider} {score}`) and dispatches to all `ACTIVE` subscribers via the SMS adapter.

The results pipeline (`run_results_fetch`) is the symmetric flow at `results_fetch_time` (default `18:00`): Playwright scrapes `pmu.fr/turf/2-quinze`, the LLM extracts `arrival_order`, the row is linked to today's pronostic by date.

**Manual trigger path:** Frontend → `POST /api/pronostics/trigger` (backend) → `axios.post(AI_ENGINE_URL + '/scrape')` → AI engine `run_scraping`. The backend never scrapes; it only proxies. Same pattern for `/results/fetch`.

### Auth model

JWT-based, single token accepted from **either** `Cookie: token=...` (httpOnly, set on login) **or** `Authorization: Bearer ...` ([middleware/auth.ts](backend/src/middleware/auth.ts)). The frontend uses the Bearer form via localStorage ([frontend/src/lib/api.ts](frontend/src/lib/api.ts)) and ignores the cookie. `JWT_SECRET` is **required** — `process.env.JWT_SECRET!` will crash at request time if unset.

Roles: `SUPER_ADMIN | ADMIN | VIEWER`. Use `requireRole(...)` from the auth middleware to gate routes. Seeded super admin: `admin@pmu.com` / `azertyuiop` (see [backend/prisma/seed.ts:94](backend/prisma/seed.ts#L94)).

All `/api/*` routes are mounted with `authenticate` middleware in [backend/src/index.ts:33-40](backend/src/index.ts#L33-L40) **except** `/api/auth/*` and `/api/users` (the users router applies its own auth internally — verify when editing it).

### SMS adapter pattern

[backend/src/adapters/sms.adapter.ts](backend/src/adapters/sms.adapter.ts) exposes a single `smsAdapter` instance chosen at module-load time from `SMS_PROVIDER` (`mock | orange | twilio`). The README also lists `vonage` but no Vonage class exists — adding one means a new class implementing `SmsAdapter` plus a case in `createSmsAdapter()`. Mock logs to console only.

Inbound SMS commands (`PRONO`, `RESULTAT`, `SOLDE`, `AIDE`) are handled in [`handleIncomingSms`](backend/src/services/sms.service.ts) — note this is **not currently wired to a webhook route**; if a provider needs to deliver inbound SMS, you'll need to add the route yourself.

### Settings as runtime config

The `settings` table is the source of truth for runtime-tunable values that admins change without a redeploy: `scraping_time`, `results_fetch_time`, `sms_default_prono`, `sms_unknown`, `sms_expired`, etc. Both services read from it. When the AI engine's `/schedule` endpoint is hit, it updates the row **and** rebinds the APScheduler job — keep both in sync if adding new scheduled tasks.

### Frontend data flow

React Router protected routes wrap all pages except `/login` ([App.tsx](frontend/src/App.tsx)). Server state is fetched via the typed wrappers in [frontend/src/lib/api.ts](frontend/src/lib/api.ts) (currently most pages call axios directly rather than going through TanStack Query — TanStack Query is installed but inconsistently used). `VITE_API_URL` (default `/api`) points at the backend; the frontend never calls the AI engine directly.

## Environment

Single `.env` at repo root, consumed by all three services. The example is in [.env.example](.env.example) but note its `DATABASE_URL` is a **PostgreSQL** URL — replace it with a `mysql://user:pass@host:3306/pmu_db` URL to match the live schema. Required keys actually used by the code:

- `DATABASE_URL` (backend + ai-engine)
- `JWT_SECRET` (backend)
- `AI_ENGINE_URL` (backend → ai-engine, default `http://ai-engine:8000`)
- `AI_PROVIDER` (`anthropic` | `groq` | `mock`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`
- `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER`, `SMS_TWILIO_ACCOUNT_SID` (Twilio only)
- `VITE_API_URL`, `VITE_AI_ENGINE_URL`

The Anthropic model in [ai_engine.py:54](ai-engine/ai_engine.py#L54) defaults to `claude-sonnet-4-20250514` — override via `ANTHROPIC_MODEL` rather than editing the source.

## Language conventions

User-facing strings (admin UI labels, SMS templates, AI prompts, log messages in some places) are in **French**. Code identifiers, comments, and route paths are English. The pronostic data model uses French betting terms (`tierce`, `quarte`, `quinte`, `outsider`, `base_horse`) — keep these names; they're domain vocabulary, not typos.
