# Pupside

**Grow it. Or blow it.**

Pupside is a single-player options game for your browser. Start with $1,000,000 of pretend money, follow six fictional companies, and decide what to buy and when to cash out over five trading days.

[**Play Pupside →**](https://strike-desk.onrender.com/)

No account required. All companies, prices, news, and money are fictional.

## How to play

1. **Choose your pace.** Pick a 15-, 5-, or 2-minute game and open the desk.
2. **Read the news.** Explore the companies and their headlines. Trust ratings range from **Solid news** to **Wild rumor**.
3. **Build a ticket.** Choose a company, **UP** or **DOWN**, a target price, and how much to spend. An UP ticket pays at the closing bell if the share price finishes above your target; a DOWN ticket pays if it finishes below.
4. **Decide when to exit.** Watch your tickets change in value. Cash out individual purchases during trading, hold them until the bell, or sit the day out.
5. **Review your run.** Each day's results connect the news to your decisions. After the final bell, see your rank, follow your balance journey, and revisit any day's trades.

## What's on the desk

- **Live price charts and news follow-ups.** Track the fictional market as events unfold, then inspect earlier prices and your trade markers.
- **Trade previews.** See ticket costs, break-even prices, and what-if outcomes before buying. Scenarios help explain possible results; they aren't predictions.
- **Contract comparison.** Compare targets and directions side by side, with filters for direction and affordability.
- **Community statistics.** The landing page shows completed games, pretend profits earned, and the best completed run when statistics are available.

The desk works on desktop and mobile, with separate Market, News, and Your ticket views on smaller screens.

## The rules that matter

You can make **up to three purchases per day**, sharing an allowance of **half your start-of-day cash**. Cashing out doesn't refill the allowance or restore a purchase. You buy whole tickets, and each ticket represents 100 shares.

**A payout isn't always a profit.** If a ticket costs $300 and pays out $200, you've lost $100. A correct prediction about direction can still lose money because the target, ticket cost, and exit timing all matter. At the closing bell, a ticket that finishes on the wrong side of its target—or exactly on it—is worth $0.

Along the way, you'll learn options terminology: UP is a **call**, DOWN is a **put**, the target is the **strike price**, the ticket cost is the **premium**, and the closing bell is **expiry**. Built-in help explains these ideas as you play.

## Returning to a game

Play each run in one sitting. With browser storage available, refreshing can recover an active game in the same tab. Runs expire after 30 minutes disconnected and can be lost if the service restarts. **End game** closes your run and shows an early-exit summary; that run cannot be resumed.

## Run locally

Use **Node.js 24** and **pnpm 12.5.1**. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:5173](http://localhost:5173). The core game runs without a database or analytics account.

The app uses React, TypeScript, and Tailwind CSS with a Node.js game server. For development checks, run `pnpm typecheck`, `pnpm lint`, and `pnpm test`. To run a production build locally, use `pnpm build` followed by `pnpm start`, then open [localhost:10000](http://localhost:10000).

Further reading: [frontend design system](docs/FRONTEND-DESIGN-SYSTEM.md), [fictional market model](docs/MODEL.md), and [optional statistics and analytics setup](docs/ANALYTICS.md).
