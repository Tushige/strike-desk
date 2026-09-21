import { describe, expect, it } from 'vitest';
import { buyCommandSchema } from '@strike-desk/shared/protocol';
import type { BuyCommand } from '@strike-desk/shared/protocol';
import {
  FAKE_ACCOUNT,
  FAKE_ACCOUNT_AFTER_BUY,
  FAKE_CHOICES,
  FAKE_CONTRACT_A,
  FAKE_CONTRACT_B,
  FAKE_OPEN_TICKET,
  FAKE_SPEND_CHOICES,
  createFakeTicketDesk,
} from '../src/modules/order-ticket/fake';
import { describeTicketDeskContract } from './contracts/ticketDesk.contract';

/** The scripted desk the order ticket is built against, tried against what any desk must do. */
describeTicketDeskContract('the scripted desk', () => {
  const desk = createFakeTicketDesk();
  const props = desk.props();
  return {
    submit: props.submit,
    quote: props.quote,
    onDraftChange: props.onDraftChange,
    answer: (outcome) => {
      desk.controls.answer(outcome);
    },
    commandsSeen: () => desk.controls.submitted().length,
    known: { contractId: 24, spendCents: 5_000_000 },
  };
});

const LEVEL_1 = {
  contractId: 24,
  spendCents: 5_000_000,
  priceCents: 11_800,
  quantity: 423,
  costCents: 4_991_400,
  limitPriceCents: 12_036,
  breakEvenCents: 8618,
  whatIf: [
    { atCents: 8300, profitCents: -4_991_400 },
    { atCents: 8500, profitCents: -4_991_400 },
    { atCents: 8618, profitCents: 0 },
    { atCents: 8700, profitCents: 3_468_600 },
    { atCents: 8900, profitCents: 11_928_600 },
  ],
};

const LEVEL_2 = {
  contractId: 24,
  spendCents: 5_000_000,
  priceCents: 12_000,
  quantity: 416,
  costCents: 4_992_000,
  limitPriceCents: 12_240,
  breakEvenCents: 8620,
  whatIf: [
    { atCents: 8300, profitCents: -4_992_000 },
    { atCents: 8500, profitCents: -4_992_000 },
    { atCents: 8620, profitCents: 0 },
    { atCents: 8700, profitCents: 3_328_000 },
    { atCents: 8900, profitCents: 11_648_000 },
  ],
};

function buy(commandId: string): BuyCommand {
  return { t: 'buy', commandId, day: 1, contractId: 24, spendCents: 5_000_000, seenPriceCents: 11_800 };
}

describe('the scripted desk', () => {
  it('starts as a live desk on day 1 with nothing selected, nothing quoted and nothing held', () => {
    const props = createFakeTicketDesk().props();

    expect(props).toMatchObject({ day: 1, contract: null, line: 'live', retryOffered: false });
    expect(props.choices).toBe(FAKE_CHOICES);
    expect(props.spendChoices).toBe(FAKE_SPEND_CHOICES);
    expect(props.quote.get()).toBeNull();
    expect(props.account.get()).toBe(FAKE_ACCOUNT);
    expect(props.position.get()).toBeNull();
  });

  it('answers the known draft with the typed-in quote, and the second price level with the other one', () => {
    const desk = createFakeTicketDesk();
    const { quote, onDraftChange } = desk.props();

    onDraftChange({ contractId: 24, spendCents: 5_000_000 });
    expect(quote.get()).toEqual(LEVEL_1);

    desk.controls.setPriceLevel(2);
    expect(quote.get()).toEqual(LEVEL_2);
    expect(desk.controls.drafts()).toEqual([{ contractId: 24, spendCents: 5_000_000 }]);

    desk.controls.setPriceLevel(1);
    expect(quote.get()).toEqual(LEVEL_1);
  });

  it('quotes the other spend, the other contract, and a contract with no spend yet', () => {
    const { quote, onDraftChange } = createFakeTicketDesk().props();

    onDraftChange({ contractId: 24, spendCents: 10_000_000 });
    expect(quote.get()).toMatchObject({ quantity: 847, costCents: 9_994_600, breakEvenCents: 8618 });
    expect(quote.get()?.whatIf[4]).toEqual({ atCents: 8900, profitCents: 23_885_400 });

    onDraftChange({ contractId: 61, spendCents: 5_000_000 });
    expect(quote.get()).toMatchObject({ priceCents: 4_500, quantity: 1111, costCents: 4_999_500, limitPriceCents: 4_600, breakEvenCents: 4055 });
    expect(quote.get()?.whatIf[0]).toEqual({ atCents: 3900, profitCents: 17_220_500 });

    onDraftChange({ contractId: 61, spendCents: 10_000_000 });
    expect(quote.get()).toMatchObject({ quantity: 2222, costCents: 9_999_000 });
    expect(quote.get()?.whatIf[1]).toEqual({ atCents: 4000, profitCents: 12_221_000 });

    onDraftChange({ contractId: 24, spendCents: null });
    expect(quote.get()).toEqual({ contractId: 24, spendCents: null, priceCents: 11_800, quantity: 0, costCents: 0, limitPriceCents: 12_036, breakEvenCents: 8618, whatIf: [] });
  });

  it('has no quote for a pair it does not know', () => {
    const { quote, onDraftChange } = createFakeTicketDesk().props();

    onDraftChange({ contractId: 24, spendCents: 7_000_000 });
    expect(quote.get()).toBeNull();
    onDraftChange({ contractId: 25, spendCents: 5_000_000 });
    expect(quote.get()).toBeNull();
    onDraftChange({ contractId: null, spendCents: 5_000_000 });
    expect(quote.get()).toBeNull();
  });

  it('hands out new props, and says so, when the desk changes what it selected, the line or the retry offer', () => {
    const desk = createFakeTicketDesk();
    let told = 0;
    desk.subscribe(() => {
      told += 1;
    });
    const before = desk.props();
    expect(desk.props()).toBe(before);

    desk.controls.select(FAKE_CONTRACT_A);
    expect(desk.props().contract).toBe(FAKE_CONTRACT_A);
    desk.controls.setLine('stale');
    expect(desk.props().line).toBe('stale');
    desk.controls.offerRetry(true);
    expect(desk.props().retryOffered).toBe(true);
    desk.controls.select(FAKE_CONTRACT_B);
    expect(desk.props().contract).toBe(FAKE_CONTRACT_B);

    expect(told).toBe(4);
    expect(desk.props()).not.toBe(before);
    expect(desk.props().quote).toBe(before.quote);
  });

  it('records picks, drafts, retries and commands, and numbers its command ids', () => {
    const desk = createFakeTicketDesk();
    const props = desk.props();

    props.onPick(28);
    props.onDraftChange({ contractId: 28, spendCents: null });
    props.onRetry();
    const first = props.newCommandId();
    const second = props.newCommandId();
    void props.submit(buy(first));

    expect([first, second]).toEqual(['fake-cmd-0001', 'fake-cmd-0002']);
    expect(buyCommandSchema.safeParse(buy(first)).success).toBe(true);
    expect(desk.controls.picks()).toEqual([28]);
    expect(desk.controls.drafts()).toEqual([{ contractId: 28, spendCents: null }]);
    expect(desk.controls.retries()).toBe(1);
    expect(desk.controls.submitted()).toEqual([buy(first)]);
  });

  it('sets the account and the ticket it is given along with an answer', async () => {
    const desk = createFakeTicketDesk();
    const props = desk.props();
    const command = buy(props.newCommandId());

    const submitted = props.submit(command);
    desk.controls.answer(
      { outcome: 'accepted', receipt: { commandId: command.commandId, kind: 'buy', step: 400, outcome: 'accepted', positionId: 'd1' } },
      { account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET },
    );

    await expect(submitted).resolves.toMatchObject({ outcome: 'accepted' });
    expect(props.account.get()).toBe(FAKE_ACCOUNT_AFTER_BUY);
    expect(props.position.get()).toBe(FAKE_OPEN_TICKET);
  });

  it('says so when it is asked to answer and no command is waiting', () => {
    expect(() => {
      createFakeTicketDesk().controls.answer({ outcome: 'lost' });
    }).toThrow('no command is waiting for an answer');
  });
});
