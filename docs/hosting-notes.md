# Hosting notes

Plain, measured notes on how the live service behaves on its host. Every number below is a single run, from one machine, on the stated date — never a number copied from documentation or a forum post.

## Service

- Host: Render, Free instance type, region Virginia (US East)
- Public URL: https://strike-desk.onrender.com
- Node.js: 24.21.0 (read from the project's pinned Node version at build time)
- pnpm: v12.5.1 (matching the project's pinned package manager)

## What was measured

| Date | What | How | Result |
|------|------|-----|--------|
| 2026-09-20 | An idle WebSocket connection with nothing flowing over it in either direction, for 20 minutes, run alone with no other request to the service | `node scripts/measure-ws-idle.mjs "wss://strike-desk.onrender.com/ws?probe=silent" --minutes 20 --label silent --connect-wait-s 90` | `RESULT open-after=20min messages=0` — the connection stayed open for the entire 20 minutes |
| 2026-09-20 | Cold start: time to the first answer from the health endpoint, checked immediately after the run above ended | `curl -o /dev/null -s -w '%{time_total}' --max-time 180 https://strike-desk.onrender.com/healthz` | `0.132586` seconds. The instance answered instantly, so it had not gone to sleep — this is not a genuine cold-start number |
| — | A connection that also receives small periodic heartbeat messages, held past 16 minutes | — | Not yet measured |
| — | A connection that also receives the live ticking value, held past 16 minutes | — | Not yet measured |

## What this means

- One idle connection with absolutely nothing flowing over it stayed open for a full 20 minutes on this single run, on this date. That is longer than this hosting plan's documented 15-minute idle window. One run does not prove this holds under every condition (a longer wait, a different time of day, a different starting state) — it is a measurement, not a guarantee.
- Checking the health endpoint right after that run answered in about 0.13 seconds, the fastest kind of answer there is. That means the instance never went to sleep during or after the 20-minute run, so this run does not have a genuine cold-start number to report — a cold start can only be timed after the instance has actually gone to sleep, and it never did here.
- Whether a connection that also carries a small heartbeat message, or one carrying the live ticking value, survives the same kind of idle window has not been checked yet. Those two measurements, and the follow-up checks needed to get a genuine cold-start number, are marked "not yet measured" above — they were deferred, not attempted and failed.

## How to repeat

```
node scripts/measure-ws-idle.mjs "wss://strike-desk.onrender.com/ws?probe=silent" --minutes 20 --label silent --connect-wait-s 90
curl -o /dev/null -s -w '%{time_total}' --max-time 180 https://strike-desk.onrender.com/healthz
node scripts/measure-ws-idle.mjs "wss://strike-desk.onrender.com/ws?probe=quiet" --minutes 20 --label heartbeat-only --connect-wait-s 90
node scripts/measure-ws-idle.mjs "wss://strike-desk.onrender.com/ws" --minutes 20 --label ticks --connect-wait-s 90
```
