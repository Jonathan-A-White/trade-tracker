# Demo: TradeTracker after the module splits

For the Governor, on his phone. This is the last story of the epic "split the busiest files so two stories can change two modules at once" (module map R1 to R3: the factory into three hooks behind one facade, Settings as a list of sections, one hook for a trip and its lines). None of that was meant to change what you see. The demo is you using the app as usual and saying whether it works and looks as before. When it does, say **Looks good**.

**How to read this.** Each numbered step is something to do. The line under it, starting with Right:, is what the screen should show. A word in code font (monospace) is the exact label on the screen. Amounts (like $9.26) are what you get if you type the same numbers as here. The amounts also assume the items still have the starter prices from the lists (an item you already had keeps your price, since loading a list never overwrites); if yours differ, the sums still have to agree with the line amounts on the screen. If a step does not match, say which number and what you saw instead.

**Before you start.** Open the app and let any `Update ready, tap to reload` banner finish reloading. If Home shows `Resume Trip` instead of `Start New Trip`, a trip is still open: finish it first (Part 3, steps 24 to 26), then begin.

The demo makes one real trip (about $10) in your history, and loads the three starter lists into your item library if they are not there yet. Both are harmless; leave them or tell the Mayor to take them out.

## Part 1: The factory (unlock, licence state)

1. Tap `Settings` in the bottom bar, then scroll to the card titled `Factory`.
   Right: the card says one of three things. With no key yet: `Make a key for this app.` and a `Make key` button. With a key that is locked: `A key is kept on this device.` and either `Unlock with fingerprint` (only when the phone offers it and a fingerprint is set up) or `Unlock it with your 12 words.` With a key that is open: `Key unlocked for today.` It should be the state it was in the last time you used it.

2. If the card says `A key is kept on this device.`, unlock it: tap `Unlock with fingerprint`, or type your words into the box labelled `12 words` and tap `Unlock`. (If it says `Make key` you have no key on this phone; making one is fine but not needed for this demo.)
   Right: the text changes to `Key unlocked for today.`, the `12 words` box and the `Unlock` button go away, and a fingerprint button appears if the phone supports it: `Use fingerprint` (none set up yet) or `Remove fingerprint` (one is set up). A wrong word shows a red message and leaves the key locked. Do not tap `Remove fingerprint` unless you mean to.

3. With the key open, read the licence under the card: the `Public key` (a long string of letters and numbers), the `Copy` button, and the row `Licence`. Tap `Copy`.
   Right: `Copied.` appears under the button. The `Licence` row shows the same word it showed before the split, which is one of: `Held` (what you should see if you have a licence), `None`, `Revoked`, `On its way`, `Checking` (a moment only, then it changes), or `Could not check` (the phone is offline or the chain is down; the card then says `The chain could not be reached.` and offers `Check again`, which you can tap). Under it: `In the collection trade-tracker.` and, at the bottom of the card, a field labelled `Backend` holding your backend address. Nothing on the rest of the app waits on the licence; with `Could not check` everything below still works.

## Part 2: Settings (every section, a seed list)

4. Scroll the whole Settings screen from the top.
   Right: the title `Settings`, then eleven cards in this order: `Appearance`, `Factory`, `Storage Usage`, `Produce PLU Codes`, `Trader Joe's Barcodes`, `TJ's Receipt (03/14/2026)`, `Export / Import Items`, `Export / Import Trips`, `Import Trip from AI`, `Danger Zone`, `About`. Each is a white (or dark grey) card with its title at the top in small type. None is missing or doubled.

5. In `Appearance`, flip the switch (its name for a screen reader is `Toggle dark mode`), look at the screen, then flip it back.
   Right: the card says `Light mode` or `Dark mode`, the whole app changes between light and dark at once, and the switch slides across. After flipping it back the screen is as you found it. (Leaving the app and coming back keeps your choice.)

6. Read `Storage Usage`.
   Right: a blue bar, and under it two figures, for example `1.2 MB used` on the left and `10.0 GB available` on the right. If the phone cannot say, the card says `Storage estimate not available` instead.

7. In `Produce PLU Codes`, tap `Load PLU Codes`. (This is the seed list the rest of the demo uses. Do the same for the other two lists if you like, in the next two steps.)
   Right: the button turns into a green box, `Added 123 items.`, and, if some were already in your library, "Skipped N already in library." Added plus Skipped is always 123. The button is gone once it has run. Tapping `Items` in the bottom bar later shows the produce (for example `Bananas`).

8. In `Trader Joe's Barcodes`, tap `Load TJ Barcodes`.
   Right: a green box, "Added N items." with "Skipped M already in library." if any; N plus M is 31.

9. In `TJ's Receipt (03/14/2026)`, tap `Load Receipt Items`.
   Right: a green box, "Added N items." with "Skipped M already in library." if any; N plus M is 41. (If you loaded the barcodes list first, a few may be skipped.)

10. In `Export / Import Items`, tap `Export Items`, then tap `Import Items` and pick the file it just saved (named `tradetracker-items-` and today's date).
    Right: exporting saves a `.json` file (the phone may show a download notice). Picking it opens a box titled `Import Items?` with `Cancel` and `Import`. Tap `Import`. A green box says `Added 0 items.` and "Skipped N already in library.", where N is every item you have, since the file is your own library.

11. In `Export / Import Trips`, tap `Export Trips`, then `Import Trips` and pick the file it just saved (named `tradetracker-trips-` and today's date).
    Right: a box titled `Import Trips?` with `Cancel` and `Import`. Tap `Import`: a green box says `Added 0 trips.` and, if you have any trips, "Skipped N already imported." where N is the number of trips you have.

12. Look at `Import Trip from AI`. Do not import anything.
    Right: a short note about importing a trip JSON made by AI, and a dashed purple button `Import AI Trip JSON`. (To try it, you would pick a trip file from the AI workflow; the trip would then appear as a new completed trip with a `View Imported Trip` button. Skip it unless you have a file ready.)

13. In `Danger Zone`, tap `Clear All Data`, read the box, then tap `Cancel`. **Do not tap `Delete Everything`.**
    Right: a box titled `Clear All Data?` that says it will permanently delete all your stores, items, trips and price history, with `Cancel` and `Delete Everything`. After `Cancel` the box is gone and nothing has changed.

14. In `About`, read the rows, then tap `Credits and thanks`, then go back.
    Right: `App` with `TradeTracker`; `Version` with a stamp that ends in a short code, for example `v0.1.29 · 2026-10-10 14:05Z · 35e595d` (it tells you which build you are running); `Storage` with `IndexedDB (Dexie.js)`. The link opens a screen titled `About` listing what the app stands on, and the back arrow returns to Settings, scrolled where you were.

## Part 3: A trip (add items, totals, detail, edit, end, compare)

15. Tap `Home` in the bottom bar.
    Right: the blue header `TradeTracker` with `Track your grocery spending`; four boxes `Trips This Month`, `Spent This Month`, `Items Tracked`, `Avg Trip Total`; the heading `Recent Trips` with `View all`; and a blue `Start New Trip` button. Note the figures in `Trips This Month` and `Spent This Month`, since they change at step 26. `Items Tracked` is higher than before if you loaded the lists.

16. Tap `Start New Trip`, then tap any store in the list. (No store yet? Tap `+ Create New Store`, fill the form and save.)
    Right: a screen titled `Start Trip` with the line `Select a store to begin your shopping trip.` and your stores. Tapping a store moves to a budget screen: `Set a budget for your trip to` that store, `or skip to start without one.`

17. In the field `Trip Budget`, type 20. Watch the button, then tap it.
    Right: the right-hand button reads `Start Trip` once you type a number (it reads `Skip & Start` when the field is empty). Tapping it opens the trip screen: the store's name as the title, `$20.00 budget` and a running clock at the top right, the buttons `Scan` and `Add Manually`, and the line `No items yet. Scan a barcode or add an item manually.` A green bar at the bottom shows `$0.00` and `0 items`, with `Remaining: $20.00`, `Budget: $20.00` and the `End Trip` button.

18. Tap `Add Manually`. In the box with the grey text `Search by item name...`, type Bananas, tap the row named exactly `Bananas` (not `Organic Bananas`), then tap `+` five times to reach 6, then tap `Add to Trip`.
    Right: the screen is titled `Add Item` and has the heading `Search Existing Items`. Two rows come up, `Bananas` and `Organic Bananas`; the row you want shows `Bananas`, `4011 · each` and `$0.23`. Tapping it opens a box with `Bananas`, `$0.23 / each`, the label `Quantity`, and `-` and `+` around the count. After `Add to Trip` you are back on the trip with a `Bananas` line showing `x6` and `$1.38`. The bar shows `$1.38`, `1 item`.

19. Tap `Add Manually` again, type Gala, tap the row named exactly `Apple, Gala` (not `Organic Apple, Gala`), type 2 in `Weight (lbs)`, then tap `Add to Trip`.
    Right: the row says `Apple, Gala`, `4021 · per lb`, `$1.99`. The box has a `Weight (lbs)` field instead of a count, and `Add to Trip` stays greyed out until you type a weight. The new line shows `2.00 lbs` and `$3.98`. The bar shows `$5.36`, `2 items`.

20. Tap `Add Manually` again, type Hass (large), tap the row named exactly `Avocado, Hass (large)` (not the Organic one), tap `+` once to reach 2, then tap `Add to Trip`.
    Right: the line shows `x2` and `$2.98`. The bar shows `$8.34`, `3 items`, `Remaining: $11.66`, `Budget: $20.00`, and the bar under it fills about 42 percent.

21. Check the totals against the lines: $1.38 + $3.98 + $2.98.
    Right: the bar's big figure equals the sum of the three line amounts, $8.34. The bar stays green; it turns yellow at 90 percent of the budget and red (`Over budget by`) past it, but you are well under.

22. Press and hold the `Bananas` line for about half a second until a small menu appears. Tap `Edit Quantity`, change the number in the box labelled `Qty` to 10, and tap `Save`.
    Right: the menu shows `Edit Price` and `Edit Quantity` (a per-pound line shows `Edit Weight` instead). The line becomes `x10` and `$2.30`. The bar shows `$9.26`, still `3 items`, and `Remaining: $10.74`. (`Cancel` in the box leaves the line as it was. Swiping a line left shows a red `Delete`; do not use it here.)

23. Type gala in the box with the grey text `Search items...` (it appears once there are lines), then clear it with the small x.
    Right: only `Apple, Gala` stays in the list while you type. After clearing, all three lines are back. The bar's total does not change while filtering.

24. Tap `End Trip` in the bar.
    Right: a screen titled `End Trip` with the card `Trip Summary`: `Store` (your store), `Date` (today), `Items` `3`, and `Scanned Subtotal` `$9.26`. If the store has a state set you also see an `Estimated Tax` card; produce is tax-exempt, so its `Estimated Total` is also $9.26. Further down: a `Photograph receipt` button (the factory reads a receipt photo; optional here), the heading `Receipt Total` with a big `$` field, and `Difference` showing `--`. At the bottom: `Save Trip` and `Keep Shopping`.

25. In `Receipt Total`, type 9.50.
    Right: `Difference` changes to `+$0.24` in green, with the line `Great match! Receipt and scanned totals are very close.`

26. Tap `Save Trip`.
    Right: you land on Home. `Trips This Month` is one higher, `Spent This Month` is $9.50 higher, `Start New Trip` is back (not `Resume Trip`), and the top card under `Recent Trips` is your store with `Subtotal: $9.26` and `Actual: $9.50`.

27. Tap that card.
    Right: the trip's page, titled with the store's name, `Edit` at the top right, today's long date, `Scanned Subtotal` `$9.26`, `Actual Total` `$9.50`, a `Difference` box with `+$0.24` in green, and the three lines (`Bananas` `x10` `$2.30`, `Apple, Gala` `2.00 lbs` `$3.98`, `Avocado, Hass (large)` `x2` `$2.98`). Near the bottom: `Export for AI` and `Import from AI` (leave both alone).

28. Tap `Edit`. Press and hold the `Apple, Gala` line, tap `Edit Price`, change the number in the box labelled `Price` to 2.49, tap `Save`, then tap `Save Changes`.
    Right: the screen is titled `Edit Trip` with a `+ Add Item` button and a `Save Changes` bar. After `Save`, the Apple line reads `$4.98`. After `Save Changes` you are back on the trip's page, now with `Scanned Subtotal` `$10.26`, `Actual Total` still `$9.50`, and `Difference` `-$0.76` in green.

29. Tap `Reports` in the bottom bar, then the card `Trip Accuracy` ("Compare your scanned subtotals to actual receipts").
    Right: a screen titled `Trip Accuracy` with the boxes `Avg Difference` and `Accuracy` (a percentage), the chart `Difference per Trip`, and one row per finished trip that has a receipt total. Your new trip's row shows today's date, the store, `Estimated: $10.26`, `Actual: $9.50`, `-$0.76` and the word `Under`. (A row with no difference would say `Exact`; one where the receipt was higher, `Over`.)

30. Tap `Trips` in the bottom bar.
    Right: a screen titled `Trip History` with the store filter (`All Stores`) and your trips, newest first, the new one on top showing the same `Subtotal: $10.26` and `Actual: $9.50`.

If all thirty steps matched, say **Looks good**. If one did not, give its number and what you saw.
