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
  "1": [
    "People online are buzzing about this",
    "An excited online post says",
    "A fan chat is full of talk about this",
    "Someone online cannot wait to share"
  ],
  "2": [
    "A worker at the company says",
    "A store manager says",
    "A delivery driver shares this news",
    "A shop owner has this update"
  ],
  "3": [
    "The boss shares this update",
    "A company announcement says",
    "The boss explains the latest news",
    "The company's latest report says"
  ]
};

/** Each kind has at least five events per direction, enough for its five daily appearances. */
export const EVENTS: readonly EventType[] = [
  {
    "id": "bulk-order",
    "direction": "up",
    "kinds": [
      "toys",
      "food",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} gets a pet-shop order",
          "body": "A chain of pet shops wants robot pets in every store, bringing in a large order."
        },
        {
          "title": "Pet shops make room for {name}",
          "body": "A pet-shop chain is adding robot pets to its shelves and has placed a large order."
        }
      ],
      "food": [
        {
          "title": "{name} lands a travel order",
          "body": "A travel company wants space snacks in its meal packs, bringing in a large order."
        },
        {
          "title": "Travel packs add {name} snacks",
          "body": "A travel company has ordered space snacks for its meal packs, giving the factory a big batch to make."
        }
      ],
      "energy": [
        {
          "title": "{name} powers a delivery fleet",
          "body": "A courier company has ordered super batteries for its delivery carts, adding a steady customer."
        },
        {
          "title": "Delivery carts pick {name} power",
          "body": "A courier is fitting its carts with super batteries and has placed an order for the whole fleet."
        }
      ]
    }
  },
  {
    "id": "long-term-deal",
    "direction": "up",
    "kinds": [
      "drinks",
      "wearables",
      "games"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} wins a refill deal",
          "body": "A cinema chain has chosen its fizzy drinks for refill stations, adding regular orders."
        },
        {
          "title": "Cinema refills bring business to {name}",
          "body": "A cinema chain will use its fizzy drinks at refill stations, bringing in orders throughout the year."
        }
      ],
      "wearables": [
        {
          "title": "{name} signs a skate-park deal",
          "body": "An indoor skate park will rent out its jet sneakers, paying for new pairs and regular servicing."
        },
        {
          "title": "Skate-park rentals choose {name}",
          "body": "A skate park has signed a year-long deal to rent its jet sneakers and pay for upkeep."
        }
      ],
      "games": [
        {
          "title": "{name} signs an arcade deal",
          "body": "An arcade chain will pay to offer its video games at every branch, bringing in regular fees."
        },
        {
          "title": "Arcade screens add {name} games",
          "body": "An arcade chain has agreed to pay a yearly fee to put its video games on more screens."
        }
      ]
    }
  },
  {
    "id": "better-fit",
    "direction": "up",
    "kinds": [
      "toys",
      "wearables",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} makes pets easier to hold",
          "body": "Smaller hand grips on its robot pets help younger players carry them, and stores are ordering more."
        },
        {
          "title": "New pet grips help {name} sell",
          "body": "Its robot pets now have handles made for smaller hands. Shops say more families are choosing them."
        }
      ],
      "wearables": [
        {
          "title": "{name} finds a better fit",
          "body": "New adjustable straps help more shoppers find jet sneakers that fit, and stores are ordering extra pairs."
        },
        {
          "title": "Better straps bring orders to {name}",
          "body": "More shoppers can wear its jet sneakers with the new adjustable straps, so shops are stocking extra pairs."
        }
      ],
      "energy": [
        {
          "title": "{name} adds a handy connector",
          "body": "A new connector lets its super batteries fit more garden tools, opening up another group of buyers."
        },
        {
          "title": "More tools can use {name} batteries",
          "body": "Its super batteries now come with a connector for several garden tools, helping it reach more customers."
        }
      ]
    }
  },
  {
    "id": "new-release",
    "direction": "up",
    "kinds": [
      "drinks",
      "food",
      "games"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} launches a peach fizz",
          "body": "A new peach fizzy drink is drawing shoppers to the shelves, and stores are placing opening orders."
        },
        {
          "title": "Peach fizz joins the {name} range",
          "body": "Shops are ordering its new peach fizzy drink to give customers another flavour to try."
        }
      ],
      "food": [
        {
          "title": "{name} launches a crunchy snack",
          "body": "Its new crunchy space snacks are ready for sale. Shops are ordering the first boxes for their shelves."
        },
        {
          "title": "A new crunch arrives from {name}",
          "body": "Stores are taking their first deliveries of its new crunchy space snacks, adding another product to sell."
        }
      ],
      "games": [
        {
          "title": "{name} releases a puzzle game",
          "body": "Its new video game lets players build floating mazes, and launch-day sales are bringing in money."
        },
        {
          "title": "Floating mazes arrive from {name}",
          "body": "Players are buying its newly released maze-building game, giving the studio a fresh source of sales."
        }
      ]
    }
  },
  {
    "id": "sell-out",
    "direction": "up",
    "kinds": [
      "toys",
      "drinks",
      "wearables"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} pets sell out at a fair",
          "body": "A toy fair has sold all its robot pets. The stall holders are ordering more for the next weekend."
        },
        {
          "title": "Toy-fair stalls need more {name} pets",
          "body": "Every robot pet at a toy fair has been bought, leaving sellers asking for another delivery."
        }
      ],
      "drinks": [
        {
          "title": "{name} empties the drinks shelves",
          "body": "Shops have sold their fizzy-drink supplies earlier than expected and are placing extra orders."
        },
        {
          "title": "Shops call for more {name} fizz",
          "body": "Its fizzy drinks have sold out in several shops, so the shops want a larger next delivery."
        }
      ],
      "wearables": [
        {
          "title": "{name} runs out of a popular size",
          "body": "A popular size of jet sneakers has sold out. Shops are asking the company to make more pairs."
        },
        {
          "title": "Shoppers snap up {name} sneakers",
          "body": "Stores have sold every pair in one popular size of jet sneakers and have ordered replacements."
        }
      ]
    }
  },
  {
    "id": "product-award",
    "direction": "up",
    "kinds": [
      "food",
      "games",
      "energy"
    ],
    "wordings": {
      "food": [
        {
          "title": "{name} wins a snack award",
          "body": "Its space snacks won a taste award at a food fair. Shops want to stock the winning flavour."
        },
        {
          "title": "A taste prize puts {name} on shelves",
          "body": "A food-fair prize for its space snacks is drawing shop owners to order the winning flavour."
        }
      ],
      "games": [
        {
          "title": "{name} wins a game-design prize",
          "body": "A games festival gave its puzzle game a design prize, and more visitors are buying a copy."
        },
        {
          "title": "A festival prize brings sales to {name}",
          "body": "Its video game won a prize for puzzle design. Players who saw it at the festival are buying it."
        }
      ],
      "energy": [
        {
          "title": "{name} wins a battery-design award",
          "body": "A tools fair gave its super batteries a design award. More tool shops are asking to stock them."
        },
        {
          "title": "Tool shops notice {name}'s award",
          "body": "An award for its super-battery design is attracting orders from shops that sell garden tools."
        }
      ]
    }
  },
  {
    "id": "faster-production",
    "direction": "up",
    "kinds": [
      "toys",
      "drinks",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} speeds up pet assembly",
          "body": "A new workbench lets workers fit robot-pet legs faster, so the factory can finish more pets each day."
        },
        {
          "title": "More pets leave the {name} workbench",
          "body": "A better assembly bench speeds up fitting the robot pets' legs, letting the factory fill more orders."
        }
      ],
      "drinks": [
        {
          "title": "{name} speeds up bottle filling",
          "body": "A new filling machine handles more fizzy-drink bottles each hour, helping the factory keep up with orders."
        },
        {
          "title": "More bottles roll through {name}'s factory",
          "body": "A faster filling machine lets the factory pack more fizzy drinks into the same working day."
        }
      ],
      "energy": [
        {
          "title": "{name} speeds up battery checks",
          "body": "New testing racks check more super batteries at once, so finished orders can leave the factory sooner."
        },
        {
          "title": "Battery tests move faster at {name}",
          "body": "Its factory can test several trays of super batteries together, clearing orders for delivery more quickly."
        }
      ]
    }
  },
  {
    "id": "new-retail-outlet",
    "direction": "up",
    "kinds": [
      "wearables",
      "food",
      "games"
    ],
    "wordings": {
      "wearables": [
        {
          "title": "{name} steps into more sports shops",
          "body": "A sports-shop chain is adding its jet sneakers to stores that have never sold them, reaching new shoppers."
        },
        {
          "title": "More sports shops stock {name}",
          "body": "Its jet sneakers are going into new branches of a sports-shop chain, giving more shoppers a place to try them."
        }
      ],
      "food": [
        {
          "title": "{name} reaches station shops",
          "body": "Shops at busy train stations are starting to stock its space snacks, putting them in front of more travellers."
        },
        {
          "title": "Station shelves welcome {name}",
          "body": "Its space snacks are arriving in train-station shops for the first time, reaching people buying food for a trip."
        }
      ],
      "games": [
        {
          "title": "{name} reaches another game store",
          "body": "An online game store is adding its video games, giving the studio a new place to sell downloads."
        },
        {
          "title": "A new download shop lists {name}",
          "body": "Its video games will appear in another online store, putting them in front of that store's regular shoppers."
        }
      ]
    }
  },
  {
    "id": "less-waste",
    "direction": "up",
    "kinds": [
      "drinks",
      "food",
      "energy"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} cuts bottle waste",
          "body": "A stronger crate keeps more fizzy-drink bottles intact during delivery, cutting the cost of replacing broken ones."
        },
        {
          "title": "Better crates protect {name} drinks",
          "body": "Fewer fizzy-drink bottles break in its new delivery crates, so it spends less on replacements."
        }
      ],
      "food": [
        {
          "title": "{name} keeps snacks crisp for longer",
          "body": "A better seal keeps its space snacks crisp for longer. Shops throw away fewer unsold packs and order more."
        },
        {
          "title": "Freshness seals help {name} snacks last",
          "body": "Its new packet seal keeps space snacks crisp on the shelf, reducing waste for shops that stock them."
        }
      ],
      "energy": [
        {
          "title": "{name} reuses battery packing trays",
          "body": "Reusable trays protect its super batteries during delivery and return to the factory, saving packing costs."
        },
        {
          "title": "Returnable trays save money for {name}",
          "body": "Its battery-delivery trays can be used again, so the company buys less new packing material."
        }
      ]
    }
  },
  {
    "id": "returning-customers",
    "direction": "up",
    "kinds": [
      "toys",
      "wearables",
      "games"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} owners come back for another pet",
          "body": "Families who bought one robot pet are returning for a second, adding repeat sales for the company."
        },
        {
          "title": "Second pets bring sales to {name}",
          "body": "Shops say robot-pet owners are buying another pet to join the first, bringing back customers."
        }
      ],
      "wearables": [
        {
          "title": "{name} wearers return for a new pair",
          "body": "People who wore out their jet sneakers are choosing the same brand again, adding repeat orders."
        },
        {
          "title": "Old customers choose {name} again",
          "body": "Shops say customers replacing worn-out jet sneakers are buying another pair from the same company."
        }
      ],
      "games": [
        {
          "title": "{name} players buy the next chapter",
          "body": "Players who finished its adventure game are paying for the next chapter, bringing in more sales."
        },
        {
          "title": "Returning players support {name}",
          "body": "More owners of its adventure game are buying the next chapter instead of moving to another game."
        }
      ]
    }
  },
  {
    "id": "paid-repair-service",
    "direction": "up",
    "kinds": [
      "toys",
      "wearables",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} opens a pet repair desk",
          "body": "Robot-pet owners can now pay for tune-ups at its repair desk, adding income beyond selling new pets."
        },
        {
          "title": "Pet tune-ups earn money for {name}",
          "body": "Its new repair desk charges for robot-pet tune-ups, giving the company another way to earn money."
        }
      ],
      "wearables": [
        {
          "title": "{name} starts a sneaker service",
          "body": "Owners can pay to have their jet sneakers cleaned and adjusted, bringing in money between new-pair sales."
        },
        {
          "title": "Sneaker servicing adds income at {name}",
          "body": "A new paid cleaning and adjustment service gives jet-sneaker owners a reason to visit between purchases."
        }
      ],
      "energy": [
        {
          "title": "{name} offers paid battery checks",
          "body": "Tool owners can pay to have their super batteries checked, adding service income alongside battery sales."
        },
        {
          "title": "Battery check-ups earn fees for {name}",
          "body": "Its new paid service checks how well super batteries are working, bringing in money from existing owners."
        }
      ]
    }
  },
  {
    "id": "popular-demonstration",
    "direction": "up",
    "kinds": [
      "drinks",
      "food",
      "games"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name}'s fizz demo draws a crowd",
          "body": "A shop demonstration of its colour-changing fizzy drink drew a crowd, and more visitors bought a bottle."
        },
        {
          "title": "A drink demo brings buyers to {name}",
          "body": "Shoppers stopped to watch its fizzy drink change colour, then bought bottles to try it themselves."
        }
      ],
      "food": [
        {
          "title": "{name}'s snack demo gets people talking",
          "body": "A video showing its space snacks floating in a display has spread online, bringing new shoppers to stores."
        },
        {
          "title": "A snack video brings attention to {name}",
          "body": "More people are visiting shops for its space snacks after watching a popular floating-snack demonstration."
        }
      ],
      "games": [
        {
          "title": "{name}'s game demo attracts players",
          "body": "A video of players building a giant maze in its game is getting shared, and more viewers are buying it."
        },
        {
          "title": "A maze-building video helps {name} sell",
          "body": "Viewers of a popular video want to build their own mazes in its video game, bringing in new sales."
        }
      ]
    }
  },
  {
    "id": "specialist-team",
    "direction": "up",
    "kinds": [
      "toys",
      "games",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} adds a pet-tricks team",
          "body": "New robot trainers are helping finish more pet tricks at once, getting a paid trick pack ready sooner."
        },
        {
          "title": "Extra trainers speed up {name}'s work",
          "body": "Its new robot-training team can prepare pet tricks together, shortening work on a paid trick pack."
        }
      ],
      "games": [
        {
          "title": "{name} adds a sound team",
          "body": "New sound designers can work on several game levels at once, helping the studio finish its next paid release."
        },
        {
          "title": "More sound designers join {name}",
          "body": "An expanded sound team is finishing game music and effects faster, helping the next release stay on schedule."
        }
      ],
      "energy": [
        {
          "title": "{name} adds a machine-repair team",
          "body": "New repair technicians keep its battery-making machines running for longer, helping the factory fill more orders."
        },
        {
          "title": "Extra technicians help {name} keep working",
          "body": "Its new machine-repair team reduces pauses on the super-battery line, leaving more time to fill orders."
        }
      ]
    }
  },
  {
    "id": "control-error",
    "direction": "down",
    "kinds": [
      "toys",
      "games",
      "wearables"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} pauses a batch of pets",
          "body": "Some robot pets sit when asked to fetch. Fixing their commands is holding up deliveries."
        },
        {
          "title": "Mixed-up tricks hold up {name} pets",
          "body": "A batch of robot pets follows the wrong commands. The company must fix them before sending them to shops."
        }
      ],
      "games": [
        {
          "title": "{name} holds back an update",
          "body": "The new game menu keeps hiding the play button. Fixing it is delaying the paid expansion."
        },
        {
          "title": "{name} delays a game expansion",
          "body": "Players cannot reach the play button in the new menu. The paid expansion must wait for a fix."
        }
      ],
      "wearables": [
        {
          "title": "{name} checks muddled sneaker controls",
          "body": "A setting button on some jet sneakers selects the wrong mode, so the company is pausing deliveries for a fix."
        },
        {
          "title": "Wrong settings hold up {name} sneakers",
          "body": "Some jet sneakers choose the wrong mode when their button is pressed. Fixing the controls is delaying orders."
        }
      ]
    }
  },
  {
    "id": "supply-shortage",
    "direction": "down",
    "kinds": [
      "drinks",
      "food",
      "energy"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} waits for bottle caps",
          "body": "A late shipment of bottle caps means fewer fizzy drinks can leave the factory this week."
        },
        {
          "title": "Missing caps slow {name} deliveries",
          "body": "The factory has fizzy drinks ready but is still waiting for bottle caps, holding up this week's orders."
        }
      ],
      "food": [
        {
          "title": "{name} runs short of packets",
          "body": "The factory has plenty of space snacks but too few packets, so some deliveries must wait."
        },
        {
          "title": "Too few packets hold up {name} snacks",
          "body": "A shortage of empty packets is stopping the factory from packing all its space-snack orders."
        }
      ],
      "energy": [
        {
          "title": "{name} waits for battery connectors",
          "body": "A supplier has run short of connectors for its super batteries, leaving finished battery packs waiting for parts."
        },
        {
          "title": "Missing connectors delay {name} orders",
          "body": "Its supplier cannot send enough battery connectors, so some super batteries cannot be finished for delivery."
        }
      ]
    }
  },
  {
    "id": "repair-bill",
    "direction": "down",
    "kinds": [
      "toys",
      "wearables",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} repairs loose pet tails",
          "body": "Some robot pets have loose tail joints. Fixing returned pets is costing the company extra money."
        },
        {
          "title": "Loose tails add costs for {name}",
          "body": "The company is paying to repair tail joints on returned robot pets, adding an unexpected workshop bill."
        }
      ],
      "wearables": [
        {
          "title": "{name} checks squeaky sneakers",
          "body": "A batch of jet sneakers squeaks with every step. Replacing the soles is adding repair costs."
        },
        {
          "title": "Squeaky soles cost {name} money",
          "body": "The company is replacing noisy soles on a batch of jet sneakers, adding costs after the pairs were sold."
        }
      ],
      "energy": [
        {
          "title": "{name} repairs battery handles",
          "body": "Some super-battery carrying handles are coming loose. Replacing them is adding costs for the company."
        },
        {
          "title": "Loose handles bring a bill for {name}",
          "body": "It is paying to replace handles on super batteries that customers already bought, increasing repair costs."
        }
      ]
    }
  },
  {
    "id": "delivery-disruption",
    "direction": "down",
    "kinds": [
      "toys",
      "drinks",
      "food"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} pets wait at the warehouse",
          "body": "A delivery truck has broken down with robot-pet orders still at the warehouse, delaying sales to shops."
        },
        {
          "title": "A broken truck delays {name} pets",
          "body": "Its robot pets cannot reach shops on time after a delivery truck broke down, pushing some sales back."
        }
      ],
      "drinks": [
        {
          "title": "{name} drinks miss their delivery slot",
          "body": "A road closure has delayed its fizzy-drink trucks, so shops cannot get their orders for a busy weekend."
        },
        {
          "title": "Closed roads slow {name} deliveries",
          "body": "Fizzy-drink orders are arriving late because trucks must take a longer route, leaving some shops short."
        }
      ],
      "food": [
        {
          "title": "{name} snacks miss a ferry",
          "body": "A missed ferry has left space-snack orders at the port, delaying their arrival at island shops."
        },
        {
          "title": "A ferry delay holds up {name} snacks",
          "body": "Boxes of space snacks are waiting for the next ferry, so island shops will get their orders later."
        }
      ]
    }
  },
  {
    "id": "failed-batch-check",
    "direction": "down",
    "kinds": [
      "wearables",
      "food",
      "energy"
    ],
    "wordings": {
      "wearables": [
        {
          "title": "{name} holds a batch of sneakers",
          "body": "A batch of jet sneakers has uneven stitching. It must be checked again before the pairs can go to shops."
        },
        {
          "title": "Stitching checks slow {name} orders",
          "body": "Inspectors found uneven seams on new jet sneakers, so the company is holding the batch for extra checks."
        }
      ],
      "food": [
        {
          "title": "{name} holds back soft snacks",
          "body": "A batch of crunchy space snacks came out soft. The factory must remake it before filling the orders."
        },
        {
          "title": "A soft batch delays {name} snacks",
          "body": "Its crunchy space snacks missed their usual crunch, so a replacement batch must be made for waiting shops."
        }
      ],
      "energy": [
        {
          "title": "{name} checks short-running batteries",
          "body": "A batch of super batteries ran for less time in factory tests. Extra checks are holding up the order."
        },
        {
          "title": "Battery tests delay {name} shipments",
          "body": "New super batteries did not run long enough in testing, so the batch must stay at the factory for checks."
        }
      ]
    }
  },
  {
    "id": "lost-contract",
    "direction": "down",
    "kinds": [
      "drinks",
      "games",
      "energy"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} loses a cafe contract",
          "body": "A cafe chain will stop buying its fizzy drinks next month, leaving the company with fewer regular orders."
        },
        {
          "title": "A cafe deal ends for {name}",
          "body": "One cafe chain is dropping its fizzy drinks, taking away a stream of regular sales."
        }
      ],
      "games": [
        {
          "title": "{name} loses an arcade contract",
          "body": "An arcade chain will stop paying to offer its video games, cutting the studio's regular fee income."
        },
        {
          "title": "An arcade deal ends for {name}",
          "body": "A chain of arcades is removing its games and ending the payments it made to the studio each year."
        }
      ],
      "energy": [
        {
          "title": "{name} loses a battery contract",
          "body": "A garden-tool maker will stop ordering its super batteries, leaving a gap in the factory's regular business."
        },
        {
          "title": "A tool-maker deal ends for {name}",
          "body": "One tool maker is ending its regular super-battery orders, giving the company fewer packs to sell."
        }
      ]
    }
  },
  {
    "id": "rival-launch",
    "direction": "down",
    "kinds": [
      "toys",
      "wearables",
      "games"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} faces a cheaper robot pet",
          "body": "A rival has launched a lower-priced robot pet, and some shops are reducing their orders to try it."
        },
        {
          "title": "A rival pet competes with {name}",
          "body": "Shops are making space for a cheaper robot pet from another company, ordering fewer of its pets."
        }
      ],
      "wearables": [
        {
          "title": "{name} faces a lighter rival sneaker",
          "body": "A rival's new jet sneakers weigh less, and some shoppers are choosing them instead of its pairs."
        },
        {
          "title": "A lighter sneaker challenges {name}",
          "body": "Another company has launched light jet sneakers that are winning over some of its usual customers."
        }
      ],
      "games": [
        {
          "title": "{name} faces a rival puzzle release",
          "body": "A rival has released a new puzzle game, and players are spending less on its own puzzle adventures."
        },
        {
          "title": "A rival game draws players from {name}",
          "body": "Some players are buying another studio's new puzzle game instead of its next adventure."
        }
      ]
    }
  },
  {
    "id": "machine-breakdown",
    "direction": "down",
    "kinds": [
      "drinks",
      "food",
      "energy"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} stops a filling line",
          "body": "A broken pump has stopped one fizzy-drink filling line, reducing the number of bottles it can send to shops."
        },
        {
          "title": "A pump fault slows {name} bottling",
          "body": "One filling line is waiting for a pump repair, so the factory is sending out fewer fizzy drinks."
        }
      ],
      "food": [
        {
          "title": "{name} stops a snack mixer",
          "body": "A broken mixing machine is slowing space-snack production, leaving the factory behind on shop orders."
        },
        {
          "title": "A mixer repair delays {name} snacks",
          "body": "The space-snack mixer needs repairs, cutting the amount the factory can make for waiting shops."
        }
      ],
      "energy": [
        {
          "title": "{name} pauses a battery line",
          "body": "A machine that joins super-battery parts has stopped working, reducing the number of packs the factory can finish."
        },
        {
          "title": "A broken machine slows {name} output",
          "body": "The battery line is waiting for a joining-machine repair, leaving fewer super batteries ready to sell."
        }
      ]
    }
  },
  {
    "id": "poor-reviews",
    "direction": "down",
    "kinds": [
      "toys",
      "food",
      "games"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} pets get low play scores",
          "body": "Toy reviewers say its robot pets repeat too few tricks. Some shops are cutting orders after reading the reviews."
        },
        {
          "title": "Short trick lists hurt {name} reviews",
          "body": "Reviews say its robot pets run through their tricks too quickly, and shops are ordering fewer pets."
        }
      ],
      "food": [
        {
          "title": "{name} snacks get low taste scores",
          "body": "Food reviewers say a space-snack flavour tastes too salty. Shops are ordering fewer packs of that flavour."
        },
        {
          "title": "Salty snacks bring poor reviews for {name}",
          "body": "Reviews of one space-snack flavour complain about too much salt, and shop orders for it are shrinking."
        }
      ],
      "games": [
        {
          "title": "{name} game gets low puzzle scores",
          "body": "Game reviewers say its new puzzles feel too similar, and fewer players are buying the adventure."
        },
        {
          "title": "Repeated puzzles hurt {name}'s reviews",
          "body": "Reviews say its video game repeats the same kinds of puzzle, putting some buyers off the game."
        }
      ]
    }
  },
  {
    "id": "rising-input-cost",
    "direction": "down",
    "kinds": [
      "toys",
      "drinks",
      "wearables"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} pays more for pet motors",
          "body": "The small motors inside its robot pets now cost more, leaving less money from each pet sale."
        },
        {
          "title": "Costlier motors squeeze {name}",
          "body": "A supplier has raised the price of robot-pet motors, making each new pet more expensive to build."
        }
      ],
      "drinks": [
        {
          "title": "{name} pays more for fruit flavour",
          "body": "The fruit flavour used in its fizzy drinks costs more this month, raising the cost of each bottle."
        },
        {
          "title": "Flavour costs rise for {name}",
          "body": "Its fizzy-drink flavour supplier has raised prices, leaving less money from each bottle sold."
        }
      ],
      "wearables": [
        {
          "title": "{name} pays more for sneaker fabric",
          "body": "The tough fabric used in its jet sneakers now costs more, making each pair more expensive to produce."
        },
        {
          "title": "Fabric costs rise for {name}",
          "body": "A higher price for sneaker fabric is adding to the cost of every pair of jet sneakers it makes."
        }
      ]
    }
  },
  {
    "id": "cancelled-sales-event",
    "direction": "down",
    "kinds": [
      "drinks",
      "food",
      "games"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} loses a festival sales day",
          "body": "An outdoor festival has been cancelled, leaving its drink stall without the crowd it expected to sell to."
        },
        {
          "title": "A cancelled festival cuts {name}'s sales",
          "body": "Its fizzy-drink stall was stocked for a festival that will no longer take place, removing a day's sales."
        }
      ],
      "food": [
        {
          "title": "{name} loses a food-fair weekend",
          "body": "A food fair has been cancelled, leaving its space-snack stand with stock but no visitors to sell to."
        },
        {
          "title": "A cancelled fair leaves {name} waiting",
          "body": "Its space snacks were packed for a busy food fair, but the cancelled event means those sales will not happen."
        }
      ],
      "games": [
        {
          "title": "{name} loses a game-show weekend",
          "body": "A games show has been cancelled, taking away a chance to demonstrate its video games and sell copies."
        },
        {
          "title": "A cancelled show costs {name} a sales chance",
          "body": "The studio prepared a game demonstration for a show that will not run, losing its planned weekend of sales."
        }
      ]
    }
  },
  {
    "id": "returns",
    "direction": "down",
    "kinds": [
      "wearables",
      "games",
      "energy"
    ],
    "wordings": {
      "wearables": [
        {
          "title": "{name} gets more sneaker returns",
          "body": "More shoppers are returning jet sneakers after finding them heavier than expected, so the company is issuing refunds."
        },
        {
          "title": "Heavy sneakers bring refunds at {name}",
          "body": "Shoppers who find its jet sneakers too heavy are sending pairs back, returning money the company had taken in."
        }
      ],
      "games": [
        {
          "title": "{name} sees more game refunds",
          "body": "More buyers say its video game is shorter than they expected and are asking for their money back."
        },
        {
          "title": "Short play time brings refunds at {name}",
          "body": "Players who expected a longer video game are requesting refunds, reducing the money kept from sales."
        }
      ],
      "energy": [
        {
          "title": "{name} gets more battery returns",
          "body": "Buyers say its super batteries take up too much room in their tool bags, and more are requesting refunds."
        },
        {
          "title": "Bulky batteries come back to {name}",
          "body": "Some tool owners are returning super batteries that do not fit their bags, so the company must refund them."
        }
      ]
    }
  },
  {
    "id": "training-delay",
    "direction": "down",
    "kinds": [
      "toys",
      "wearables",
      "energy"
    ],
    "wordings": {
      "toys": [
        {
          "title": "{name} takes longer to train new staff",
          "body": "New workers need extra practice fitting robot-pet joints, so the factory is finishing fewer pets this week."
        },
        {
          "title": "Extra training slows {name}'s pet line",
          "body": "Training new staff to fit robot-pet joints is taking longer than planned, leaving less time for this week's orders."
        }
      ],
      "wearables": [
        {
          "title": "{name} extends sneaker training",
          "body": "New workers need more practice setting jet-sneaker straps, reducing the number of pairs finished this week."
        },
        {
          "title": "More training delays {name} pairs",
          "body": "Extra strap-fitting lessons for new staff mean fewer jet sneakers are ready for this week's deliveries."
        }
      ],
      "energy": [
        {
          "title": "{name} extends battery-test training",
          "body": "New staff need more training on super-battery testing, slowing the checks that orders need before shipping."
        },
        {
          "title": "Training takes longer at {name}",
          "body": "Its new battery testers need extra lessons, leaving fewer super-battery orders checked and ready to send."
        }
      ]
    }
  },
  {
    "id": "packing-mix-up",
    "direction": "down",
    "kinds": [
      "drinks",
      "food",
      "games"
    ],
    "wordings": {
      "drinks": [
        {
          "title": "{name} sorts mixed-up drink labels",
          "body": "A packing batch put the wrong flavour labels on fizzy drinks. Correcting them is delaying shop deliveries."
        },
        {
          "title": "Wrong labels hold up {name} drinks",
          "body": "Its fizzy drinks need new labels after flavours were mixed up on the packing line, slowing deliveries."
        }
      ],
      "food": [
        {
          "title": "{name} sorts mixed-up snack boxes",
          "body": "Snack boxes were packed with the wrong mix of flavours. Repacking them is adding work before they can ship."
        },
        {
          "title": "A box mix-up delays {name} snacks",
          "body": "Its space-snack boxes contain the wrong flavour mix, so workers must repack them before sending orders."
        }
      ],
      "games": [
        {
          "title": "{name} fixes codes in game boxes",
          "body": "Some boxed video games contain the wrong download code. Replacing the code cards is holding up deliveries."
        },
        {
          "title": "Wrong code cards delay {name} boxes",
          "body": "Its game boxes need replacement download cards after a packing mix-up, delaying orders for shops."
        }
      ]
    }
  }
];

/** Ordered compatibility projection for sheet readers; EVENTS owns the content. */
export const SITUATIONS: readonly Situation[] = Array.from(
  new Map(EVENTS.flatMap((event) => event.kinds.flatMap((kind) =>
    (event.wordings[kind] ?? []).map(({ title, body }) => {
      const situation = { direction: event.direction, title, body };
      return [JSON.stringify(situation), situation] as const;
    }),
  ))).values(),
);
