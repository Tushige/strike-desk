# Analytics and completed-game statistics

Accepted services: Neon for PostgreSQL in development and production, Umami for visitor and gameplay analytics. Default deployment arrangement: the existing Render service, Neon, and Umami Cloud. No Docker database is required. Neither provider is provisioned by the code change, and nothing is transmitted until environment variables are configured.

## Neon setup

1. Create a Neon project close to the Render service (currently Virginia). Keep a `production` branch and create an isolated `development` branch. A new branch can inherit its parent's data: create development before collecting live results, or use a schema-only branch when appropriate. Do not reset a development branch onto production or promote test rows into production.
2. Copy `apps/server/.env.example` to `apps/server/.env.local`. Set `DATABASE_URL` to the **development branch** connection string and `STATS_ENVIRONMENT=development`. Local server commands load this file; environment files are git-ignored. Never put a database URL in the web app or a `VITE_` variable.
3. Run `pnpm db:migrate` from the repository root. The runner applies numbered SQL migrations transactionally and records checksums. Do not edit an applied migration; add another numbered file. Run one migration process per database at a time. It reports failure without printing provider exceptions that might contain credentials.
4. Run `pnpm dev`. Finish five game days and request `http://localhost:5173/api/stats`. Development totals should update within about a minute.
5. For production, set Render's server environment to the **production branch** `DATABASE_URL` and `STATS_ENVIRONMENT=production`. Apply `pnpm db:migrate` against that same production connection before deploying the integration. Run migrations explicitly from a trusted machine or deployment job; the game server never changes schema at startup. Keep each URL in its environment's secret settings.

Branches isolate the databases; the `environment` column additionally separates aggregates if a development connection accidentally points at a copied dataset. The column cannot detect an incorrectly configured environment. A shared branch is not a substitute for separate development and production branches.

With no database URL, the game works normally and `/api/stats` returns 503 rather than invented zeros. A configured URL requires an explicit valid environment. Database requests have a three-second timeout. There are no database reads in the quote or trade calculation loop.

## Umami setup

1. Create an Umami Cloud account and add the live site's hostname as a website. Copy its public website ID and tracking-script URL from the website settings. No Umami admin API key belongs in the application.
2. Set these **build-time** variables on Render and rebuild the web app:

```dotenv
VITE_UMAMI_WEBSITE_ID=<public website ID>
VITE_UMAMI_SCRIPT_URL=https://cloud.umami.is/script.js
VITE_UMAMI_DOMAINS=<exact live hostname, without scheme or path>
```

Multiple hostnames are comma-separated. Leave `VITE_UMAMI_ALLOW_DEV` unset in production. For local validation, create a separate Umami website, copy `apps/web/.env.example` to `apps/web/.env.local`, use that test website's ID, set the hostname list to `localhost,127.0.0.1`, and set `VITE_UMAMI_ALLOW_DEV=true`. Restart Vite after changing its environment.

The supplied production Umami website ID (`b91be93e-848a-4778-a181-c08cdf8c10fc`), Cloud script URL and documented Render hostname (`strike-desk.onrender.com`) are now in `render.yaml`, along with `STATS_ENVIRONMENT=production`. A Blueprint-managed service receives these when its configuration is synced; for a manually configured service, copy the same values into Render's Environment settings and rebuild. Add the production `DATABASE_URL` separately as a secret in Render. A checked-in Blueprint does not change the running deployment by itself.

The async script records visits and referral/device information through Umami. Query strings and hashes are excluded from page URLs. The app also honors Do Not Track. Tracking is disabled for scratch pages and URLs containing `board` or `dev`; development builds require explicit opt-in as well as the hostname allowlist. Ordinary app tracking only initializes at `/`.

The optional script does not block rendering or trades. Up to 30 events can wait for the script to load; a blocked/failed script cannot prevent gameplay. Browser analytics are approximate: blockers, storage restrictions, navigation and connection loss can omit events. The app does not bypass blockers.

| Event | Meaning | Properties |
| --- | --- | --- |
| `game_started` | First observed server frame of a started game | pace |
| `purchase_accepted` | An authoritative position appears; rejected buys do not count | day, purchaseNumber (1–3), direction, pace |
| `cash_out_accepted` | Server records a cash-out exit | day, pace |
| `comparison_opened` | Player opens Compare contracts | day, pace |
| `game_completed` | Final summary phase is observed | pace, purchases |
| `game_ended_early` | Player confirms End game | day, purchases, pace |
| `replay_clicked` | Player chooses Play again or Back to start | none |

Start, purchase, cash-out and completion events are deduplicated per game in optional tab storage. Reload/reconnect frames can recover unseen events; their analytics timestamps describe when they were observed, not necessarily when the action occurred. Closing a browser is not an explicit `game_ended_early` event. Session IDs, resume tokens, command IDs, market seeds and market codes are never sent as custom event data. Local deduplication state stays in the tab.

Use Umami's dashboard to inspect visitors, referrers and these events. It is not the accounting source for public game totals.

## Public statistics contract

`GET /api/stats` (also HEAD) reads completed results; all other methods return 405. Responses are cached for 60 seconds on the server and may be cached another 60 seconds by HTTP clients. Concurrent cache misses share one query. Query failures return a generic 503 and are retried no more than once every ten seconds; provider errors and individual records are not exposed.

The response includes `currency: "pretend-USD"` and:

| Field | Definition |
| --- | --- |
| `completedGames` | Games whose five closing bells settled, including games with no purchases. Not unique people. |
| `pretendProfitsEarnedCents` | Sum of positive net results: `max(final balance − starting balance, 0)` per completed game. Losing runs do not reduce this metric. |
| `netProfitCents` | Sum of signed net results, including losses. |
| `bestFinalBalanceCents` | Largest completed final balance; null when no games have completed. Includes starting money, so do not label it profit. |
| `bestNetProfitCents` | Largest final balance minus that run's starting balance; null when no games have completed. Use for “Best completed run” on the landing page. Can be negative if all completed games lost money. |
| `purchases` | Accepted purchases across completed games, not contracts or unique players. |

All counts and cent amounts are decimal **strings** to preserve large integers across JSON. Convert cents carefully for display; avoid converting huge totals straight to JavaScript Number. Suggested public wording is “Pretend profits earned,” with its positive-results-only definition available. Never present starting balances or ticket proceeds as profit.

Completion is captured at the fifth settlement, before the final debrief finishes. Early exits before that point and engineering workloads are excluded. Only server state creates records; there is no client submission endpoint. Each result uses a SHA-256 digest of the random session ID as its idempotency key. The raw bearer/resume token is not stored. The database's `(environment, run_id)` primary key prevents retries from counting twice.

## Persistence limits and verification

Saved rows survive app restarts. Unfinished sessions remain in memory and are not restored from this database. Result writes run asynchronously, with at most four in flight. Failed writes remain in a bounded memory queue (1,000 results) and retry after 30 seconds. Shutdown attempts one final batch and reports unsaved results. A process crash, forced shutdown, or overflowing queue can lose an unsaved result. This is duplicate-safe insertion, not a durable delivery guarantee. Add a durable outbox/session persistence before promising lossless accounting.

Authenticated identities and anti-bot scoring are outside this change. Server authority stops a browser submitting a fabricated profit total, but it does not stop someone automating legitimate games. These figures describe games, not verified people or audited financial activity.

Tests cover completion through the real socket/sampler, retries, caching, unavailable storage, analytics deduplication and workload exclusions. Repository SQL runs against PGlite's PostgreSQL engine to check environment isolation, idempotent writes, profit definitions and large integer totals. Live Neon connectivity and Umami dashboard receipt still require the owner's configuration and a deployed smoke test. The landing-page stats design is intentionally a separate scratch-page review.

Local verification (2026-09-23): 100 distinct focused tests passed across 14 files, including existing landing, desk, final-summary and recovery tests. TypeScript build, changed-file ESLint, production build, browser bundle/CSS checks and the built-server smoke test passed. No live provider connection was configured or tested.

References: [Neon driver](https://github.com/neondatabase/serverless), [Neon branching](https://neon.com/branching), [Umami tracker configuration](https://docs.umami.is/docs/tracker-configuration), [Umami tracker functions](https://docs.umami.is/docs/tracker-functions).
