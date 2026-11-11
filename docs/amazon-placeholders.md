# Amazon placeholders in YNAB

Research for mw-6ww.148.6 (stage 2 of the YNAB map, R3). There is no code here. The question: an Amazon order is
spent money the day it is placed, yet Amazon bills it later and often in slices. How can trade-tracker put the order
into YNAB at order time and still end up matching what the card was actually charged?

Sources, read 2026-11-11, with no YNAB token and no authenticated call:

- YNAB's OpenAPI file, `version: 1.90.0`: https://api.ynab.com/papi/open_api_spec.yaml. It is called "the spec"
  below. Every path in it is `/plans/{plan_id}/...`. trade-tracker's client still calls `/budgets/...`
  (`src/ynab/api.ts`).
- YNAB's API documentation home: https://api.ynab.com/
- YNAB's help centre (support.ynab.com). Its articles are drawn by JavaScript, so neither a fetch nor curl got
  their text. Where this file leans on one, it says so and gives only what was readable: the page's own meta
  description, or a web-search summary of it. Neither is a quote of the article body.
- Amazon's help pages on www.amazon.com answered every automated fetch with HTTP 503. The Amazon Pay FAQ on
  pay.amazon.com could be read. It covers Amazon Pay, not amazon.com retail orders, and is marked as such wherever
  it is used.
- postern at `~/postern`: `server/internal/alertsmail/parse.go`, its tests and `testdata/`, and the Laptop's
  `~/.local/state/postern/alerts.json` (kinds, amounts and times only; the addresses were not read).
- A probe: the Amazon total parser run on 14 hand-made mail shapes, on a copy of postern in /tmp. postern itself
  was not changed. The results are in [Why seq 50 says 0.00](#3-why-seq-50-says-000).

<!-- toc -->

- [1. What YNAB's API allows](#1-what-ynabs-api-allows)
  - [(a) An API transaction and a later bank import: when they match](#a-an-api-transaction-and-a-later-bank-import-when-they-match)
  - [(b) Splits](#b-splits)
  - [(c) Delete; an imported transaction's category, memo and approval](#c-delete-an-imported-transactions-category-memo-and-approval)
  - [(d) The rate limit](#d-the-rate-limit)
  - [(e) Does an uncleared, approved API transaction lower its category at once?](#e-does-an-uncleared-approved-api-transaction-lower-its-category-at-once)
- [2. How Amazon bills, and what links a charge to an order](#2-how-amazon-bills-and-what-links-a-charge-to-an-order)
- [3. Why seq 50 says 0.00](#3-why-seq-50-says-000)
- [4. Designs: from a placeholder to the real charges](#4-designs-from-a-placeholder-to-the-real-charges)
  - [Design 1: cut a slice at each card alert and let YNAB's matching close it](#design-1-cut-a-slice-at-each-card-alert-and-let-ynabs-matching-close-it)
  - [Design 2: categorise each import and shrink the placeholder](#design-2-categorise-each-import-and-shrink-the-placeholder)
  - [Design 3: keep the placeholder whole and swap once at the end](#design-3-keep-the-placeholder-whole-and-swap-once-at-the-end)
- [Recommendation](#recommendation)

<!-- /toc -->

## 1. What YNAB's API allows

### (a) An API transaction and a later bank import: when they match

- **The rule as documented.** Spec, `NewTransaction.import_id`:
  > "If specified, a new transaction will be assigned this `import_id` and considered "imported". We will also
  > attempt to match this imported transaction to an existing "user-entered" transaction on the same account, with
  > the same amount, and with a date +/-10 days from the imported transaction date."

  The same field:
  > "If import_id is omitted or specified as null, the transaction will be treated as a "user-entered" transaction.
  > As such, it will be eligible to be matched against transactions later being imported (via DI, FBI, or API)."

  So a placeholder made through the API with no `import_id` (trade-tracker already sends none:
  `src/ynab/api.ts`, rig memory) is matched by a bank import only when all three hold: **same account, same
  amount, date within ±10 days.**
- **The import_id format**, spec, same field:
  > "Transactions imported through File Based Import or Direct Import (not through the API) are assigned an
  > import_id in the format: 'YNAB:[milliunit_amount]:[iso_date]:[occurrence]'."

  The import's id is built from its own amount and date. It cannot be predicted at order time, and an existing
  transaction's `import_id` cannot be changed. Spec, `SaveTransactionWithIdOrImportId.import_id`:
  > "You may not provide both an `id` and an `import_id` and updating an `import_id` on an existing transaction is
  > not allowed."
- **What a match leaves behind.** Spec, `TransactionSummaryBase.matched_transaction_id`:
  > "If transaction is matched, the id of the matched transaction"
- **The help centre, as seen only through a web-search summary** of
  https://support.ynab.com/en_us/formatting-a-csv-file-an-overview-BJvczkuRq (not a quote of the page):
  > "YNAB will match the imported transactions with the ones you manually entered, as long as the amounts are
  > exactly the same and the dates are within ten days of each other."
- **When the import's amount differs from the placeholder's: not documented.** The spec states only the
  same-amount rule. Read literally, a $20.00 charge does not match a $42.17 placeholder: both stay, and the order is
  counted twice until something removes the placeholder.
- **When one order arrives as two or three charges: not documented.** Nothing says one user-entered transaction
  can match several imports. Under the same-amount rule none of them would match a whole-order placeholder, unless
  one slice happens to equal the whole total.
- **Pending transactions.** The help page's meta description
  (https://support.ynab.com/en_us/pending-transactions-an-overview-Bk0WoOcA5) is the only readable text:
  > "YNAB now imports pending transactions from your linked account."

  The spec, `GET /plans/{plan_id}/transactions`:
  > "Returns plan transactions, excluding any pending transactions"

  So the API cannot see a pending authorisation. **Not documented:** whether a pending authorisation for the
  order's full amount (the "full authorization" Amazon describes, section 2) can match the placeholder and then
  vanish when it drops.
- **The throwaway budget test that settles the rest.** No bank link is needed: an API "import" (a POST with an
  `import_id`) is matched the same way ("via DI, FBI, or API").
  1. Make a throwaway budget with one unlinked credit-card account.
  2. POST a user-entered split of -42.17, approved, uncleared, memo `TT:test`, with categories A and B.
  3. POST an "import" of -42.17 dated +3 days with `import_id` `YNAB:-42170:<date>:1`. Read back: is there one
     transaction or two? Which category, split, memo, cleared and approved survive, and what is
     `matched_transaction_id`?
  4. Repeat with an import of -20.00, and then -20.00 and -22.17. Expect no match; confirm it.
  5. Repeat with the import dated +11 days. Expect no match.

  The pending-authorisation question cannot be settled in a throwaway budget. It needs one real Amazon order
  watched on a linked card.

### (b) Splits

- **Making a split: documented, at creation.** Spec, `SaveTransactionWithOptionalFields.subtransactions`:
  > "An array of subtransactions to configure a transaction as a split."

  `category_id`:
  > "To configure a split transaction, you can specify null for `category_id` and provide a `subtransactions` array
  > as part of the transaction object."
- **Changing a split the API made: not allowed.** Spec, the same `subtransactions` field:
  > "Updating `subtransactions` on an existing split transaction is not supported and will return an error."

  `amount`:
  > "Split transaction amounts cannot be changed and if a different amount is supplied it will be ignored."

  `category_id`:
  > "If an existing transaction is a split, the `category_id` cannot be changed."

  So a split placeholder cannot be shrunk in place. Shrinking means **DELETE it and POST a new one.**
- **Turning an existing non-split transaction, or an imported one, into a split: not documented.** PUT
  (`ExistingTransaction`) and PATCH (`SaveTransactionWithIdOrImportId`) both carry the `subtransactions` field.
  The only stated limits are on transactions that are *already* splits, and nothing says an imported transaction
  is refused. This is R3, and it stays open. Throwaway budget test: POST an "import" (with `import_id`) of -42.17
  with one category, then PUT it with `category_id: null` and two subtransactions summing to -42.17. Read back
  whether it is now a split, or what error comes back. Do the same with PATCH by `import_id`.
- **Scheduled transactions cannot be splits.** Spec, `SaveScheduledTransaction.category_id`:
  > "Creating a split scheduled transaction is not currently supported."
- **YNAB's own help for big-box orders** (https://www.ynab.com/whats-new/an-easier-way-to-categorize-big-box-orders,
  dated April 29, 2025): imported transactions from Amazon and others get "a link to your order history" in the
  phone apps. It does not split anything; the splitting is still done by hand.

### (c) Delete; an imported transaction's category, memo and approval

- **Delete: documented.** Spec, `DELETE /plans/{plan_id}/transactions/{transaction_id}`:
  > summary "Delete a transaction", description "Deletes a transaction", 200 "The transaction was successfully
  > deleted".

  **Not documented:** whether a *deleted imported* transaction comes back on the next import. The placeholder
  designs below never delete an import.
- **Category, memo, approval: documented as updatable fields.**
  - `PUT /plans/{plan_id}/transactions/{transaction_id}` ("Update a transaction") takes `ExistingTransaction`.
  - `PATCH /plans/{plan_id}/transactions` ("Updates multiple transactions, by `id` or `import_id`.") takes
    `SaveTransactionWithIdOrImportId`.
  - Both are `SaveTransactionWithOptionalFields`, whose fields are `account_id`, `date`, `amount`, `payee_id`,
    `payee_name`, `category_id`, `memo` (maxLength 500), `cleared`, `approved`, `flag_color` and
    `subtransactions`.
  - `approved`: "Whether or not the transaction is approved. If not supplied, transaction will be unapproved by
    default."
  - Nothing in the spec excludes imported transactions from these updates; the only stated exceptions are splits
    (above).

  Throwaway budget test: an API "import", then PATCH by `import_id` with `category_id`, `memo` and
  `approved: true`, then read it back.

### (d) The rate limit

https://api.ynab.com/ (section "Rate Limiting"):
> "An access token may be used for up to 200 requests per hour. The limit is enforced within a rolling window."

Going over returns `HTTP/1.1 429 Too Many Requests` (`too_many_requests`). trade-tracker already turns that into
`YnabRateLimitedError` (`src/ynab/api.ts`). Every design below spends at most about four calls per Amazon charge,
far under the limit.

### (e) Does an uncleared, approved API transaction lower its category at once?

- **The API docs: not documented.** The spec defines `cleared` as `cleared | uncleared | reconciled` and a
  category's `activity` as "Activity amount in milliunits format" and `balance` as "Available balance in milliunits
  format". It never says whether an uncleared or unapproved transaction counts toward them.
- **The help centre, as seen only through a web-search summary** of
  https://support.ynab.com/en_us/finding-your-cleared-balance-to-reconcile-an-overview-BkH27l_A9 (not a quote of
  the page):
  > "The Working Balance is the total of all transactions, both cleared and uncleared. This is what your plan is
  > based on."

  This points to yes, but it is not YNAB's own words read from the page.
- **Throwaway budget test that settles it:**
  1. Assign $100 to category A.
  2. POST -10.00 to A, `cleared: uncleared`, `approved: true`, dated today.
  3. GET `/plans/{id}/categories/{A}`: expect `activity` -10000 and `balance` 90000.
  4. Repeat with `approved: false`, to learn whether a silent, unapproved placeholder (design answer B) also
     counts.

## 2. How Amazon bills, and what links a charge to an order

| Fact | Source |
|---|---|
| **When a card is charged:** at shipment, not at order. "Because we charge for items when they are shipped, this can result in multiple charges" | Amazon Pay FAQ, https://pay.amazon.com/help/69871. This is Amazon Pay, not amazon.com retail. The amazon.com pages (https://www.amazon.com/gp/help/customer/display.html?nodeId=GCSEVDU4VHLPD4VX "Authorization Charges on Amazon", nodeId=GSNBBJP63SM65UDB "Identify an Amazon Charge") returned 503. A web-search summary of the first (not a quote, unverified) says the full amount is charged "after all items have shipped or five days after the order date, whichever occurs first". **For amazon.com retail: not known from what we hold.** |
| **At order time:** an authorisation, not a charge. "This request is communicated as a full authorization for the amount of the purchase to your issuing bank." "However, we do not actually proceed with the charge at that time." "Some banks may hold these authorizations for up to 7-10 business days." | https://pay.amazon.com/help/69871 (Amazon Pay) |
| **One order, several charges:** "your purchase may be split into multiple shipments or even multiple orders." "the total amount charged will add up to the amount displayed when you placed your order." | https://pay.amazon.com/help/69871 (Amazon Pay). **Not shown by any fixture**: postern holds no split order. |
| **Where Amazon shows the slices:** the order summary "will show you the amount charged for each shipment, as well as the total charged per order." | https://pay.amazon.com/help/69871. Not readable by us: it is behind his Amazon login. |
| **Gift-card balance, promotional credit, refunds of cancelled items** | **Not known from what we hold.** No Amazon page about them was readable. |
| **The order mail carries the order number, the items and a total.** "Order # 111-0000000-0000000", "3 items: 2 Widgets, 1 Kitchen Gadgets", "Grand Total:" in one cell and "$42.17" in the next. Its subject is "Ordered 3 items: Widgets, Kitchen Gadgets". | shown by fixture `server/internal/alertsmail/testdata/amazon-order.eml`. That fixture was built by hand from a *printed* real mail. Its HTML structure was "written to look right" (parse_test.go:19-23), so the real HTML is not known. It has **no price for each item and no card**. |
| **The shipment mail carries the order number, and no amount and no items in the body.** Its subject is "Shipped: "Widget, blue..." and 1 more item". | shown by an inline test mail in parse_test.go `TestAnAmazonShipmentYieldsItsOrderID`, not a testdata file. Whether a real shipment mail names a shipment amount: **not known from what we hold.** |
| **A Chase charge alert for Amazon carries the amount, the merchant text, the card's last four and the date and time.** "You made a $42.17 transaction with AMAZON MKTPLACE PMTS", "Prime Visa (...1234)", "Oct 21, 2026 at 3:12 AM ET". **No order number.** | shown by fixture `testdata/chase-amazon.eml`. Its merchant text is made up (parse_test.go:19-21), so Amazon's real descriptor on a Chase alert is **not known from what we hold**. |
| **A Citi charge alert carries the same four facts** (amount, merchant, card ending, date and time) and no order number. | shown by fixture `testdata/citi.eml` and by fixture `testdata/citi-costco.eml`. Neither is an Amazon charge, so **a Citi Amazon alert is not known from what we hold**. |
| **What reaches trade-tracker today:** for kind amazon, only `amount`, `merchant` ("Amazon") and `when`. The order number and items are read and then dropped. | parse.go:30-32: "OrderID and Items are an Amazon mail's; §26 has no field for them, so Alert leaves them out"; parse_test.go `TestTheAlertPostedHoldsOnlyTheFieldsTheBackendKeeps`. trade-tracker ignores the kind anyway: `src/sort/waiting.ts` keeps only `kind === "charge"`. |

**So, which facts can link a charge alert to an order.** A charge alert and an order mail share no identifier:
the alert has no order number, and the order mail has no card. The links are:

1. **Amount.**
   - A single-shipment order is charged its whole total.
   - A split order's charges sum to its total ("the total amount charged will add up to the amount displayed",
     Amazon Pay).
   - So a charge equal to an open order's remainder, or no greater than it, is a candidate.
2. **Merchant text.** It starts with an Amazon name. The exact descriptor is not known from what we hold.
3. **Time.** The charge comes after the order mail, and near a shipment mail for the same order number. Shipment
   mails and charges are not tied by amount (no fixture shows one).
4. **Card.** The order mail does not say which card paid. A charge on a card that is not the expected one is still
   a candidate.

When two orders are open at once and a charge fits both, the facts cannot decide. Design answer A asks him;
answer B assigns it to the oldest order (Amazon ships in order more often than not; this is a guess).

Before any design can use the order number or items, postern's §26 alert needs `orderId` and `items` fields.
That is a postern story; it is not part of this one.

## 3. Why seq 50 says 0.00

**The stored 0.00 is a read zero, not a missing total.**

- `alerts.Alert.Amount` is `json:"amount,omitempty"` (`server/internal/alerts/store.go:102`). No code in postern
  writes "0.00" (a grep of `server/` for `0.00`, `%.2f` and `FormatFloat` outside tests finds nothing).
- So an Amazon mail whose total was not found would be stored with **no** `amount` at all. "0.00" means the
  parser found a line matching `(?i)^(?:Grand|Order) Total:?\s*(\$?[0-9,]+\.\d{2})?$` (parse.go:321), and either
  that line or the line after a bare label was a zero amount.
- All three Amazon alerts on the Laptop say 0.00: seq 5 (2026-11-04), seq 10 (2026-11-07) and seq 50 (2026-11-11).
  Three out of three points to the shape of Amazon's mail, not a one-off gift-card order.

**What the parser and its tests cover.** The test is `TestAnAmazonOrderYieldsItsOrderIDItemsAndTotal` with
`amazon-order.eml`. The probe ran the same parser on a copy of postern; the results:

| Shape (after the HTML is cut into one line per block) | Read as |
|---|---|
| "Grand Total:" cell, then a "$42.17" cell (the fixture) | 42.17 ✔ |
| "Grand Total: $42.17" on one line | 42.17 ✔ |
| "Order Total: $42.17" on one line | 42.17 ✔ |
| "**Order Total:** $42.17" (bold label, same cell) | 42.17 ✔ |
| "Grand Total:", an empty cell, then "$42.17" | 42.17 ✔ (an empty cell becomes no line) |
| "Total" then "$42.17" (no Grand or Order) | missed: no amount |
| "Estimated total" then "$42.17" | missed: no amount |
| "Order Total: USD 42.17" | missed: no amount |
| "Order Total", then "$" "42" with the cents in a `<sup>` "17" | missed: no amount |
| "$42.17" before its label | missed: no amount |
| A column of labels, then a column of amounts: "Item(s) Subtotal:", "Shipping & Handling:", "Grand Total:", then "$40.00", "$0.00", "$42.17" | **wrong: 40.00** |
| "Order Total", then a "$0.00" cell, then "$42.17" | **0.00** |
| "Grand Total:" "$0.00" after a gift card paid it all | **0.00** |

**The likeliest shapes behind seq 50. These are guesses; the real mail is not known:**

1. **Guess 1 (likeliest).** The label "Order Total" or "Grand Total" is followed, in reading order, by a zero
   cell before the real amount. Examples: a "$0.00" shipping, savings or promotion cell laid out after the label,
   or the label row closed before its amount. The parser takes the line right after a bare label, and the first
   match only, so it never sees the real total.
2. **Guess 2.** A summary block where a "Grand Total"-type line literally reads $0.00 and the charged total is
   named another way ("Total", "Estimated total", "Amount charged"). For example, a mail that says the order is
   paid later at shipment.
3. **Guess 3 (least likely for three of three).** Each order was paid wholly by gift card, points or a promotion,
   so "Grand Total: $0.00" was true.

**One way to learn the real shape without keeping the mail. Proposed, not built; it would be a postern story.**

When `parseAmazon` reads no amount, or reads 0.00, the receiver logs one **masked shape line**:

- It covers the lines from three before to three after each line that contains "total" (case-insensitive).
- Every digit becomes `9`.
- Every word not in a fixed list becomes `w`. The list: Total, Grand, Order, Subtotal, Item(s), Shipping,
  Handling, Tax, Estimated, Before, Gift, Card, Amount, Promotion, Savings, Points, Charged, USD.

For example:
```
alerts-mail: amazon total shape: [-1]"Shipping & Handling: $9.99" [0]"Order Total:" [+1]"$9.99" [+2]"$99.99"
```

This keeps no amount, item, name or address. postern's `miss` rule already allows fixed words. It shows exactly
which line the parser took and where the real total sits, and his next Amazon order fills it in. It is safer than
asking him to forward a mail, and needs nothing from him.

## 4. Designs: from a placeholder to the real charges

**What every design shares:**

- trade-tracker learns of the order from the kind-amazon alert. That needs §26's `orderId` and `items` (section 2)
  and a total that is read right (section 3).
- The categories come from the items, by the rig's existing category guessing, or from his own split.
- The placeholder:
  - goes on the YNAB account of his Amazon card (a setting; the order mail does not name the card);
  - is dated the order date, uncleared and approved;
  - has the memo tail `TT:amazon:<order number>`, matching the existing `TT:<local id>` idempotency rule.
- No placeholder carries an `import_id`, so it stays "user-entered" and matchable (1a).
- "On order" below means the placeholder's memo says so.

**Answer A, ping with one tap:** at order time his phone shows "Amazon order: $42.17. Groceries $30.00,
Household $12.17", with **Add to YNAB** and **Change**. Nothing goes to YNAB until he taps.

**Answer B, silent:** the same placeholder is posted without asking. He sees it the next time he opens YNAB, and
he is pinged only when something below goes wrong.

### Design 1: cut a slice at each card alert and let YNAB's matching close it

**API calls**

| When | Calls |
|---|---|
| Order | 1 POST: the placeholder, a split when there are two or more categories. |
| Each Amazon charge alert (Chase or Citi, minutes after the charge, a day before the bank import) | 1 DELETE of the placeholder, then 1 POST with two transactions: (i) a **slice** equal to the charge, on the account of the alert's card, dated the charge date, split pro rata over the placeholder's categories; (ii) the **remainder** placeholder, if anything is left. |
| Next day | The bank import of that charge has the slice's exact amount, account and nearby date, so YNAB matches it with no call from us. A GET `transactions?since_date=` (or a delta) confirms `matched_transaction_id`. |

- Splits are made only by POST, which is documented. R3 (splitting an import) is not needed.
- Pro rata is needed because the order mail has no price for each item (section 2). A shipment mail's items could
  tell which categories shipped, but only once postern sends items.

**What he sees**

| When | Answer A (ping) | Answer B (silent) |
|---|---|---|
| Order | The ping. After his tap, YNAB shows "Amazon -$42.17", split, uncleared, "on order". Groceries and Household drop at once (if 1e holds). | The same placeholder, with no ping. |
| Each charge | Nothing to do. In YNAB the placeholder becomes "-$20.00 (1st charge)" plus "-$22.17 on order". The next day the slice turns cleared (matched). | The same. |
| Last slice | The remainder is gone. Every Amazon line is cleared and the card reconciles. | The same. |

**How it fails**

- **A cancelled item.** The remainder is never billed. After N days with no charge (14 is suggested), A pings
  "$12.17 of order 111-… was never charged: drop it?" with one tap to DELETE. B deletes it silently and logs a
  line. A cancellation mail would come through as another kind-amazon alert today. postern must mark it as
  cancelled, not as a new order, or it would make a second placeholder.
- **A refund.** It arrives later as an inflow import, matched to nothing. A pings to pick the category, defaulting
  to the order's category. B gives it the order's largest category. The placeholder is untouched.
- **A gift-card balance.** The charges sum to less than the total, so it is handled the same way as a cancelled
  item. If he keeps an Amazon gift-card account in YNAB, the leftover could move there instead.
- **A price change, or tax recalculated at shipment.**
  - A charge larger than the remainder: the slice takes the whole charge, and the remainder goes to 0.
  - A remainder within $1 when no shipment is still due: closed silently in both A and B.
  - Anything larger: A pings, B leaves it "on order" until the N-day rule.
- **The bank import lands before the alert is handled** (the app was closed for a day). The import does not
  match, and the slice would double it. Before cutting, the app looks for an unmatched Amazon import of the same
  amount within ±10 days, and if one is there it categorises that import instead (PATCH, 1c). That way is not
  proven until the throwaway budget runs.
- **Two open orders fit one charge.** A asks him which order it was; B takes the oldest.

### Design 2: categorise each import and shrink the placeholder

**API calls**

| When | Calls |
|---|---|
| Order | 1 POST: the placeholder, as in Design 1. |
| Each import (seen by a delta GET of transactions) | 1 PATCH giving the import its category, memo `TT:amazon:<order>` and `approved: true`. A split needs R3, which is not documented. Then 1 DELETE and 1 POST for the smaller remainder. |
| Last slice | 1 DELETE of the placeholder. |

**What he sees**

| When | Answer A (ping) | Answer B (silent) |
|---|---|---|
| Order | As in Design 1. | As in Design 1. |
| Each charge | For a day or so (the import's lag) the slice is counted twice: once in the bank's uncategorised import and once in the placeholder. Then the import is categorised and the placeholder shrinks. | The same. |
| Last slice | The placeholder is gone. | The same. |

**How it fails**

- It has the same cases as Design 1, handled the same way.
- It also hangs on R3. If an import cannot be made a split, a slice that spans categories gets one category: its
  largest.
- It works when no card alert arrives (a card with no alerts set), which is its one advantage over Design 1.

### Design 3: keep the placeholder whole and swap once at the end

**API calls**

| When | Calls |
|---|---|
| Order | 1 POST: the placeholder. |
| Each charge | No call. The imports sit uncategorised and unapproved. |
| When the imports sum to the total (within $1), or N days pass | 1 PATCH categorising every import, then 1 DELETE of the placeholder. |

**What he sees**

| When | Answer A (ping) | Answer B (silent) |
|---|---|---|
| Order | As in Design 1. | As in Design 1. |
| Between the first and last charge | Imports pile up as uncategorised, and the order counts twice in his totals. | The same. |
| At the end | A ping: "Order 111-… fully charged: tidy YNAB?" with one tap. | It is tidied silently. |

**How it fails**

- A cancelled item or a gift card means the sum never reaches the total, so everything waits for the N-day rule.
- A refund is handled as in Design 1.
- A price change breaks the sum test, so it falls back to N days.
- It is the simplest design, but the double count can last weeks, which is the thing he asked to avoid.

## Recommendation

**Design 1, with answer A at order time.**

Cutting the slice from the card alert means YNAB's own documented matching (same account, same amount, ±10 days)
turns each real charge into the slice we already split. It never needs to edit an import, never needs R3, and
never counts a slice twice. The ping lets him fix the guessed categories once, at the moment he still remembers
the order. Every later step is silent unless the money does not add up.

Before the epic is written, the throwaway budget must answer four things:

1. Does a matched import keep the user-entered split, categories and memo? (1a step 3)
2. Do uncleared, approved transactions count in a category's balance? Do unapproved ones? (1e)
3. Can PATCH categorise an API "import"? (1c) This is Design 1's fallback.
4. Can an existing import be made a split? (1b, R3) This is only for Design 2.

The biggest unknown that no throwaway budget can settle: whether the bank's *pending* authorisation for the whole
order, imported at order time, matches the placeholder before the real slices arrive.
