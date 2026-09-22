import {
  advanceTo,
  applyCommand,
  boardFor,
  buildMarket,
  CONTENT_VERSION,
  contractId,
  DAY_STEPS,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  newGame,
  playerOf,
  quoteAt,
  spendCapCents,
} from '@strike-desk/shared/engine';
import type { Command, Side } from '@strike-desk/shared/engine';

/** Reproducible model audit. Bots choose from public opening headlines only.
 * This is an experiment, not a forecast or evidence about real markets. */
const samples = Number(process.argv[2] ?? 1000);
if (!Number.isInteger(samples) || samples < 1 || samples > 10000)
  throw new Error('Use 1–10000 samples.');
const strategies = [
  { name: 'Solid source · close · hold', trust: 3, choice: 0, exit: 500 },
  {
    name: 'Solid source · close · midpoint cash-out',
    trust: 3,
    choice: 0,
    exit: 250,
  },
  { name: 'Wild rumour · moonshot · hold', trust: 1, choice: 2, exit: 500 },
  { name: 'Blind direction · close · hold', trust: 0, choice: 0, exit: 500 },
] as const;
const outcomes: number[][] = strategies.map(() => []);
const titles = new Set<string>();
let rejected = 0;
for (let sample = 0; sample < samples; sample++) {
  const market = buildMarket({
    seed: 42424242 + sample * 104729,
    engine: ENGINE_VERSION,
    content: CONTENT_VERSION,
  });
  for (const day of market.days)
    for (const news of day.news) titles.add(news.headline.title);
  strategies.forEach((strategy, strategyIndex) => {
    let game = newGame();
    const command = (value: Command, step: number) => {
      const answer = applyCommand(market, game, FIRST_PLAYER_ID, value, step);
      game = answer.game;
      if (answer.receipt.outcome === 'rejected') rejected++;
    };
    command({ t: 'start', commandId: 'start-game', pace: 1 }, 0);
    for (let day = 1; day <= 5; day++) {
      const start = (day - 1) * DAY_STEPS;
      game = advanceTo(market, game, start);
      const headline = market.days[day - 1]!.news.find(
        (one) => one.headline.trust === strategy.trust,
      )?.headline;
      const companyId = headline?.companyId ?? (sample + day) % 6;
      const side: Side =
        headline?.direction ?? ((sample + day) % 2 === 0 ? 'up' : 'down');
      const board = boardFor(market, day);
      const company = board.companies[companyId]!;
      const targetIndex = (
        side === 'up' ? company.simpleUp : company.simpleDown
      )[strategy.choice];
      const id = contractId(board.targetsPerCompany, {
        companyId,
        targetIndex,
        side,
      });
      const value = quoteAt(market, day, 0, board, id)!;
      const budget = Math.min(
        10_000_000,
        spendCapCents(playerOf(game, FIRST_PLAYER_ID).cashCents),
      );
      command(
        {
          t: 'buy',
          commandId: `buy-${day}`,
          day,
          contractId: id,
          spendCents: budget,
          seenPriceCents: value.priceCents,
        },
        start,
      );
      if (strategy.exit < 500)
        command(
          { t: 'cashOut', commandId: `exit-${day}`, positionId: `d${day}` },
          start + 300 + strategy.exit,
        );
      game = advanceTo(market, game, start + DAY_STEPS);
    }
    outcomes[strategyIndex]!.push(playerOf(game, FIRST_PLAYER_ID).cashCents);
  });
}
const money = (cents: number) => Math.round(cents / 100);
const results = outcomes.map((values, index) => {
  values.sort((a, b) => a - b);
  const percentile = (p: number) =>
    money(values[Math.max(0, Math.ceil(values.length * p) - 1)]!);
  return {
    strategy: strategies[index]!.name,
    games: samples,
    gainPercent: Number(
      ((values.filter((v) => v > 100_000_000).length / samples) * 100).toFixed(
        1,
      ),
    ),
    lossPercent: Number(
      ((values.filter((v) => v < 100_000_000).length / samples) * 100).toFixed(
        1,
      ),
    ),
    medianFinalDollars: percentile(0.5),
    p10FinalDollars: percentile(0.1),
    p90FinalDollars: percentile(0.9),
  };
});
console.log(
  JSON.stringify(
    {
      engine: ENGINE_VERSION,
      content: CONTENT_VERSION,
      seedSeries: '42424242 + sample × 104729',
      budgetPerDayDollars: 100000,
      samples,
      uniqueHeadlines: titles.size,
      rejectedCommands: rejected,
      results,
    },
    null,
    2,
  ),
);
