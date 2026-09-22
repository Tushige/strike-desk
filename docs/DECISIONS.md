# Decisions

One line per decision made while replacing the screens: what, and why. Newest at the bottom.

- **Feed: `modules/connection` stays, `feed/wsFeed.ts` goes.** The connection already answers every command with an explicit outcome, marks unanswered commands "checking" when the line drops, resends by id after a reconnect and knows when its data is stale; the older feed did none of that and the order ticket was built against the connection's shape. The board-size hello (the `?board=` stress switch) moved into the connection's feed.
- **Resend after a reconnect: automatic while the press is under 20 seconds old and still the same day (`resendWhileFresh`).** A kid should not have to press twice because the wifi blinked; a resend reuses the command id, so it can never buy twice. Older presses wait for "Retry safely".
- **The store keeps the whole latest frame (`frame` slice) and a per-company chart series.** Every message is the whole picture, so the screens read one picture; the narrow slices stay for the table, which must not redraw per frame.
- **Lesson sentence and rank live in the web app (`screens/words.ts`, `screens/desk/lesson.ts`).** They choose copy from signs and outcomes the server sent; no money is worked out. Keeping them out of the wire contract kept the server untouched for a copy decision.
- **The frame carries what each company makes (`product`).** The news cards say "RoboPup makes robot pets"; the client has no cast file (the engine is fenced out of the browser), so the frame tells it. Optional on the wire, so old fixtures still parse.
- **Company marks are generated tiles: solid tint plus a glyph, six tints picked to stay clear of mint, coral and sun.** No art this run; the marks from the old desk module were carried over, the palette was not (it reused the profit and cash colours for two companies).
- **The module lab and the module fakes for the deleted screens are gone; the fakes for the connection, the live grid and the order ticket stay** because their kept tests drive them. The two JSON sheets the server tests read moved from the lab to `apps/server/test/fixtures/`.
- **`reference/` is git-ignored** so the prototypes this port was made from never reach the public repository.
- **Fonts are bundled** (`@fontsource-variable/lexend`, `@fontsource-variable/unbounded`), as in v1, so the game works on a school network that blocks font CDNs.
- **Total worth is the big number in the top bar, cash beside it, and no running "minus" against the starting million.** Buying a ticket turns cash into a ticket worth the same; the old red minus read as a loss before anything happened.
- **"Play again" closes and reopens the connection** rather than reloading the page: the final frame already made the feed forget its session, so the next hello starts a fresh game.
