import type { CompanyKind } from './cast';
import type { Trust } from './pricing';
import type { Side } from './protocol';

/**
 * The headline pool, as reviewed data: who is speaking, and what is said to
 * have happened. The writer in `news.ts`
 * puts a headline together from one entry of each list.
 *
 * Rules for every string here:
 *
 * - A headline claims something. It never says, hints or jokes about whether
 *   the claim is so: the same situation has to read naturally from a company,
 *   from someone close to it and from someone online, because the writer pairs
 *   any situation with any source.
 * - Each event lists the company kinds it fits. The company's name and
 *   what it makes are filled in at the two marked places and nowhere else.
 * - Every title names its company. That is what lets a small pool write a
 *   whole game without a title ever repeating.
 * - Plain words and short sentences, for a reader of ten to fourteen. No real
 *   company, brand, person or place, and nothing frightening.
 *
 * Changing a word here changes what a market number shows: bump
 * `CONTENT_VERSION` in `market.ts` in the same commit.
 */

/** Where the writer puts the company's name. */
export const NAME_MARK = '{name}';
/** Where the writer puts what the company makes. */
export const PRODUCT_MARK = '{product}';

/** Something that is said to have happened to a company. */
export interface Situation {
  /** What it claims: `'up'` for good news, `'down'` for bad. */
  direction: Side;
  title: string;
  body: string;
}

export interface HeadlineText {
  readonly title: string;
  readonly body: string;
}

export interface EventType {
  readonly id: string;
  readonly direction: Side;
  readonly kinds: readonly CompanyKind[];
  readonly wordings: Readonly<Partial<Record<CompanyKind, readonly HeadlineText[]>>>;
}

export interface NewsPool {
  readonly sources: Readonly<Record<Trust, readonly string[]>>;
  readonly events: readonly EventType[];
}

/**
 * Who is speaking. The speaker sets the trust level: the company itself is
 * solid news (3), someone close to the matter could be true (2), someone
 * online is a wild rumor (1). A phrase belongs to one level and to no other.
 */
export const SOURCES: Readonly<Record<Trust, readonly string[]>> = {
  3: ['The company itself says', "The company's boss says", 'An official company report says'],
  2: ['A store manager says', 'A worker at the company says', 'A delivery driver says'],
  1: ['Someone online says', 'A post going around online says', 'A friend of a friend says'],
};

/**
 * What is said to have happened: six situations that claim good news, then
 * six that claim bad. A company has at most one headline a day, so at most
 * five in a game: with at least five situations for each direction, there is
 * always one a company has not had yet. Never let a direction drop below five.
 */
export const EVENTS: readonly EventType[] = [
  {
    id: 'sell-out',
    direction: 'up',
    title: '{name} sells out everywhere',
    body: 'Shops cannot keep {product} on the shelves. More are being made right now.',
  },
  {
    id: 'award',
    direction: 'up',
    title: '{name} wins a big award',
    body: 'Its {product} were picked as the best of the year by a panel of judges.',
  },
  {
    id: 'viral-video',
    direction: 'up',
    title: '{name} video goes viral',
    body: 'A clip about its {product} has millions of views, and everybody is talking about them.',
  },
  {
    id: 'large-order',
    direction: 'up',
    title: 'Giant order lands at {name}',
    body: 'A huge chain of shops wants {product} from {name} in every one of its stores.',
  },
  {
    id: 'new-factory',
    direction: 'up',
    title: '{name} opens a huge new factory',
    body: 'It can now make twice as many {product} as before.',
  },
  {
    id: 'famous-fan',
    direction: 'up',
    title: 'A famous star loves {name}',
    body: 'A famous singer was spotted with its {product}, and fans want the same.',
  },
  {
    id: 'supply-shortage',
    direction: 'down',
    title: '{name} runs low on supplies',
    body: 'Something needed to make {product} is hard to get, so fewer can be made this month.',
  },
  {
    id: 'batch-recall',
    direction: 'down',
    title: '{name} calls back a batch',
    body: 'A batch of {product} did not pass its checks and is going back to the factory.',
  },
  {
    id: 'rival-launch',
    direction: 'down',
    title: 'A new rival takes on {name}',
    body: 'Another company has started selling its own {product} at a lower price.',
  },
  {
    id: 'low-reviews',
    direction: 'down',
    title: 'Low scores pile up for {name}',
    body: 'People who tried its newest {product} are giving them low scores.',
  },
  {
    id: 'launch-delay',
    direction: 'down',
    title: '{name} delays its big launch',
    body: 'Its newest {product} will not be ready in time and are pushed back by months.',
  },
  {
    id: 'machine-breakdown',
    direction: 'down',
    title: 'Factory trouble at {name}',
    body: 'A big machine broke down, and no {product} can be made until it is fixed.',
  },
].map(({ id, direction, title, body }): EventType => {
  const wording = { title, body };
  return {
    id,
    direction: direction as Side,
    kinds: ['toys', 'drinks', 'wearables', 'food', 'games', 'energy'],
    wordings: { toys: [wording], drinks: [wording], wearables: [wording], food: [wording], games: [wording], energy: [wording] },
  };
});

/** Ordered compatibility projection for sheet readers; EVENTS owns the content. */
export const SITUATIONS: readonly Situation[] = Array.from(
  new Map(EVENTS.flatMap((event) => event.kinds.flatMap((kind) =>
    (event.wordings[kind] ?? []).map(({ title, body }) => {
      const situation = { direction: event.direction, title, body };
      return [JSON.stringify(situation), situation] as const;
    }),
  ))).values(),
);
