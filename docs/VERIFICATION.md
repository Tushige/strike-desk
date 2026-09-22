# Port verification — 22 September 2026

Source: the working tree on `feature/layout-improvements`, based on `9a02418`. No commit, push or deployment was made in this session. The generated build stamp identifies that base commit plus its build time; it does not identify an independently published port revision.

## Environment and checks

Live-number stability follow-up: inspected the bundled font tables. Lexend has no `tnum` feature and ten different digit advances (500–620 font units); Unbounded includes `tnum`. The system monospace fallback audited on Windows (Consolas) has one digit advance (1126). Body/grid numeric text now uses the monospace stack, while display amounts keep Unbounded's tabular figures. Layout slots also handle commas, signs and digit-count changes; no values are rounded differently or omitted. The affected company, chart, scroll, streaming-ticket and column tests pass (24 tests). Actual browser layout-shift measurements remain unavailable and are not claimed by these DOM/font checks.

Screenshot follow-ups: redundant cash is hidden when equal to worth; the ticket uses shorter choice copy and expandable custom/scenario controls; the comparison chart now reserves 136px of actual plot height even on short desktops, with prices in a separate right rail. The chart geometry tests at three sizes and the comparison interaction test pass (4 tests), as do typecheck, focused lint and the web production build. These follow-up edits postdate the full-suite result below. Browser visual confirmation remains pending.

Windows, Node **24.21.0**, pnpm **12.5.1**, Vitest **5.0.1**, production Vite/Node build. The system's Node 22 / broken pnpm launcher were bypassed using official tools in a temporary directory; the Node archive's published SHA-256 was verified. Dependencies installed with the frozen lockfile. No dependency, lockfile, Render contract or model changes were required.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test --maxWorkers=2` | **1,421 / 1,421 tests**, 64 files; 149.33 s |
| `pnpm build` | Pass; initial app and deferred comparison chunks |
| `pnpm check:bundle` | Pass; engine-only markers absent, grid outside initial static-import graph |
| `pnpm check:css` | Pass; layer order and AG Grid CSS boundary retained |
| `pnpm smoke` | Pass; local production HTTP/health/build and WebSocket checks |
| `pnpm simulate 1000` | Pass; 4,000 games, zero rejected commands; [raw output](model-audit.json) |

The final comparison-height adjustment was followed by typecheck/lint, the affected streaming DOM test, production rebuild, both guards and smoke again. The Vite warning about the large **deferred** grid chunk remains visible; it is not hidden with a raised warning threshold.

## What the tests establish

- Real-socket interruption tests cover an accepted buy whose reply is lost and a buy never delivered; receipt recovery and same-ID retry leave one position and one debit. Those two tests now run successfully on Windows using Node with a `file:` loader URL instead of spawning a Unix-only pnpm executable name.
- New recovery tests cover registration while already live without immediate send, unchanged original age, recent exact-payload retry once, old explicit retry, accepted/rejected receipts before eligibility even at final, changed day/session, finished games, missing/closed cash-out positions, malformed/future/expired records and throwing storage operations.
- A controlled clock-only frame notifies the clock once and ticket, desk, comparison and news zero times. Existing frame ordering, draft pacing, grid virtualization/batching, sort stabilization and freshness tests remain.
- The real React desk in jsdom retains side/target/spend while filtering under streaming updates and across comparison toggles. Invalid custom edits remove the prior actionable quote; positive whole-dollar conversion, unsafe amounts and the cap are covered.
- Public samples and command-reply projection omit event truth during trading, including after news arrival, and expose the actual truth at debrief. Existing five-day server journeys, settlement, deduplication, workload refusal and no-future-state tests pass.
- Historical review tests show the selected day's server-backed amounts, label skipped days, and exclude current-day news from earlier review. Lesson assertions distinguish target payout from profit and closing endpoint from intraday path.

Verification-harness corrections preserve assertions: workload cadence tests now await a real socket round trip between simulated ticks (otherwise synchronous loops hit OS backpressure); the content-revision CLI matrix gets a Windows-only process-startup budget; the separate news CLI proof/review/invalid-input invocations have separate tests instead of sharing five seconds. UI cold imports run in setup, outside the timed interaction test. Smoke accepts Windows' SIGTERM exit representation; Unix still requires graceful code zero.

## Bundle evidence

`check:bundle` reads the production manifest, follows entry static imports, rejects an eager comparison chunk or AG Grid implementation in the initial graph, and scans all scripts for engine-only markers. It prints raw and gzip sizes for the initial JavaScript and deferred grid separately. CSS/fonts and total build-directory size are different metrics. See the current command output when rebuilding; sizes depend on the build stamp.

Final local build: initial JavaScript **412,816 bytes** (**123,900 gzip**); deferred grid **776,258 bytes** (**217,660 gzip**). The separate grid remains large because it includes AG Grid Community. The manifest guard establishes static separation; a real-browser network trace remains pending.

## Not yet verified

The browser automation tool returned no available browser and rejected creation of an in-app browser. Therefore no fresh screenshots, browser network trace, physical viewport check, pointer/touch/focus inspection, or fresh browser workload timing was collected. jsdom tests and the build graph are not substitutes for these observations. Existing screenshots are historical references only.

Before release, inspect normal, comparison, pending, held, debrief and final at **1366×768**, **1440×900**, and **390×844**. Confirm no page-wide horizontal overflow; chart label/marker separation; all columns or contained table scrolling; reachable actions; native dialog Escape/focus restoration; and section navigation. Play all five days with an early exit, settlement and skipped day, inspect each final day, refresh during pending buy/cash-out and at final, and start a new game. While owning company A, browse B and cash out A; B must have no A annotations.

Collect a fresh visible-tab workload run at `/?board=2500&dev`, recording browser/version, production build stamp, CPU/environment, board count, pace, phase and visible duration. Report received/accepted changed records/s, client observation delay p50/p95, rAF intervals and long tasks. The delay excludes network latency and is not physical paint. Preserve collecting/paused/unsupported states. No donor or historical Fable timing is claimed as this port's performance.

At accelerated workload paces, missing price indexes still wait for complete history. Only workload silence tolerance is 3 seconds; normal trading keeps 1.5-second stale blocking. Sessions remain memory-only, expiring after 30 minutes disconnected and disappearing on restart/redeploy. Actual Render service settings, previous successful deployment ID, deployed revision and public journeys were not checked. Follow [RENDER.md](RENDER.md) for release and rollback.
