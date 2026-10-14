# Demo: End Trip reads the receipt for you

For the Governor, on his phone, at the store (or at home with the receipt and a trip you just finished). This is the last story of the epic "TradeTracker reconciles a trip from a photo of its receipt". Instead of exporting the trip for AI, photographing the receipt and importing a JSON, you tap `Photograph receipt` at End Trip. The factory reads the receipt against the trip's lines, each matched line takes the receipt's price, the Receipt Total fills in by itself, every barcode stays as it was, and any receipt line it could not match is yours to place. When it works for a real trip, say **Looks good**.

**How to read this.** Each numbered step is something to do. The line under it, starting with Right:, is what the screen should show. A word in code font (monospace) is the exact label on the screen. The amounts and item names depend on your receipt; where a figure is given as a rule (for example "the sum of the lines"), check the rule. If a step does not match, say which number and what you saw instead.

**Before you start.**

- Open the app and let any `Update ready, tap to reload` banner finish reloading, so you run the newest build (Settings, `About`, the `Version` row, tells you which one).
- The factory must be open. Tap `Settings` in the bottom bar and look at the `Factory` card: it should say `Key unlocked for today.` and its `Licence` row should say `Held`. If the key is locked, tap `Unlock with fingerprint` (or type your 12 words in the box labelled `12 words` and tap `Unlock`). If the `Licence` row says `None`, the receipt check is switched off until the licence is issued to the key shown on that card; tell the Mayor.
- You need a trip in progress with its lines scanned or added, and the paper receipt in your hand. Items that still show `$0.00` (not yet priced) are fine: the receipt prices them.
- Do not use a trip you want to keep exactly as it is without looking first: the receipt changes the trip's prices at once (there is no review step), though `What changed` lists every move, old price and new.

## The steps

1. Open the trip in progress. Home shows `Resume Trip` when one is open; tap it. Look at the bar at the bottom of the trip screen.
   Right: the store's name as the title, your lines, and a green bar at the bottom with the running total, the line count and the `End Trip` button. Note a few lines and their prices. Then tap `Items` in the bottom bar, note the barcode under two or three of those items' names, and go back to the trip. You will check these again at the end.

2. Tap `End Trip` in the bar.
   Right: a screen titled `End Trip` with the card `Trip Summary` (`Store`, `Date`, `Items`, `Scanned Subtotal`). If the store has a state set, an `Estimated Tax` card follows with an `Estimated Total`. Lines not yet priced show under `Not priced yet`. Note the `Scanned Subtotal`.

3. Scroll to the card `Check against the receipt`.
   Right: the line "Photograph the receipt and the factory updates each line's price and the receipt total. Barcodes are kept." and the buttons `Photograph receipt` and `Choose a photo`. `Photograph receipt` is the blue one; both are tappable. (If they are greyed out, the card above them says why, for example `Locked. Unlock with your fingerprint to read a receipt.` with an `Unlock` button, or `This key holds no TradeTracker licence.`.)

4. Tap `Photograph receipt`. Allow the camera if the phone asks.
   Right: a full-screen camera titled `Receipt` with the line "Fill the screen with the receipt. A long one can be shot in up to 3 parts." and two buttons: `Cancel` and `Take photo`.

5. Hold the phone over the receipt so it fills the screen, flat and in good light, and tap `Take photo`. For a long receipt, take the next part (overlap a little at the top) and tap `Take photo` again; up to three parts.
   Right: after each shot a line under the picture reads `1 photo taken`, then `2 photos taken`. The `Cancel` button now reads `Done`. After the third shot the camera closes by itself.

6. Tap `Done` (if the camera is still open).
   Right: back on End Trip, the card says `1 photo ready` (or `2 photos ready`, `3 photos ready`), and offers `Add another photo`, `Choose a photo`, `Send receipt` and `Clear photos`. (`Clear photos` throws the shots away so you can start again.)

7. Tap `Send receipt`.
   Right: the card says `Waiting for the factory to read your receipt…` with `Sent at` the time and `This can take a minute or two.` The buttons are greyed while it waits. You can leave End Trip and come back; the wait and the result are kept with the trip. If it says the receipt is too large, or the factory has not answered, the card says so in red and your trip is as it was; `Send again` tries once more.

8. Wait for the answer (about a minute).
   Right: the waiting line goes away, the `Receipt Total` box lower on the screen fills in by itself with the receipt's total (you typed nothing), and under the card a divider opens a result with the headings `What changed` and `Not matched: N`. If the receipt was too faded to read in places, an amber line above them says what it could not read.

9. Read `What changed`.
   Right: one row per line whose price moved, the item's name on the left and the move on the right, for example `$1.49 → $1.69`. A line that was a guess reads `Guess $0.00 → $2.99`. If the count changed it adds, for example, `1 → 2 bought`; a per-pound line adds the receipt's weight, for example `1.62 lb`. Check three or four rows against the paper receipt: the new price is the receipt's price for the whole line, divided by the count or the weight. If every price already agreed, it says `Every matched price already agreed with the receipt.`

10. Scroll up to the `Trip Summary` and the `Receipt Total`.
    Right: `Scanned Subtotal` has changed to match the new prices (it is the sum of the line prices on the trip). `Receipt Total` equals the total printed on the receipt. `Difference` shows the receipt total minus the `Estimated Total` (or the `Scanned Subtotal` when there is no tax card), in green when it is under $1, and `Great match! Receipt and scanned totals are very close.` A larger gap (yellow, or red) is worth a look at the lines under `Not matched` and `Trip lines not on the receipt` below.

11. Scroll back to the result and read `Not matched: N`.
    Right: `N` is the number of receipt lines the factory could not tie to a trip line, and each is listed with its printed text and price, with two buttons under it: `Match to a line` and `Add as new item`. `Not matched: 0` means every receipt line found its trip line. Lines you scanned that the receipt does not show are listed under `Trip lines not on the receipt`, each marked `Not on receipt`.

12. On one `Not matched` line whose item you did scan, tap `Match to a line`.
    Right: the question `Which trip line is it?` and a button for each trip line that is not yet matched, written as the item's name and its price, for example `Bananas ($0.23)`, plus `Cancel`. (If every trip line is already matched it says `Every trip line already matches a receipt line.`)

13. Tap the trip line it is.
    Right: that line takes the receipt's price just as a matched one does: it appears in `What changed` with the old and new price, `Not matched` goes down by one, and the line is no longer marked `Not on receipt`. The `Scanned Subtotal` and the `Difference` move to match.

14. On another `Not matched` line that is really a new thing you bought, tap `Add as new item`.
    Right: the line leaves `Not matched`, `Not matched` goes down by one, and a new heading `Added as new items` lists it with its price. (It is a new line on this trip; if you scanned nothing like it, this is the right button.)

15. On End Trip, tap `Save Trip`.
    Right: you land on Home, `Start New Trip` is back (not `Resume Trip`), and the top card under `Recent Trips` shows your store with `Subtotal:` equal to the Scanned Subtotal from step 10 and `Actual:` equal to the receipt's total. Tap the card: the trip's page shows the same `Scanned Subtotal` and `Actual Total`, and the lines carry the receipt's prices.

16. Check the barcodes: tap `Items` in the bottom bar and look at the items you noted in step 1.
    Right: every item has the same name, barcode and category as before; only prices have moved.

**Optional, after the trip is saved.** On that trip's page, the same `Check against the receipt` card is there with `Photograph receipt`, so a receipt you did not photograph in the store can be read later; its answer updates the lines and the `Actual Total` the same way.

If all sixteen steps matched, say **Looks good**. If one did not, give its number and what you saw.
