# What's new

## 0.1.32
_2026-10-10_
- New: Settings shows this phone's key as a QR code for Postern to scan.

### The phone's key as a QR code

Settings shows this phone's key as a QR code for Postern to scan, above the key text and Copy. The key text now draws its zero with a slash, so a 0 cannot be read as an o.

## 0.1.31
_2026-10-10_
- No visible change

## 0.1.30
_2026-10-10_
- No visible change

## 0.1.29
_2026-10-10_
- No visible change

## 0.1.28
_2026-10-10_
- No visible change

## 0.1.27
_2026-10-10_
- Fixed: A photo the factory could not read a price from no longer leaves the item at $0.00; it gets the best guess marked Guess.

## 0.1.26
_2026-10-10_
- New: preview each photo with Retake, and a clear Package / Price tag camera.

## 0.1.25
_2026-10-10_
- New: The photo camera is sharper and works like a normal camera: pinch to zoom and tap to focus on the price tag.

## 0.1.24
_2026-10-10_
- No visible change

## 0.1.23
_2026-10-10_
- No visible change

## 0.1.22
_2026-10-10_
- No visible change

## 0.1.21
_2026-10-10_
- No visible change

## 0.1.20
_2026-10-10_
- No visible change

## 0.1.19
_2026-10-10_
- Fixed: Sending a receipt photo to the factory now keeps working if you leave the trip page, and the answer is applied when it arrives.

## 0.1.18
_2026-10-10_
- Fixed: The receipt card now tells you whether the factory is locked or the key has no licence, and lets you unlock it with your fingerprint right there.

## 0.1.17
_2026-10-10_
- Fixed: The Licence line in Settings now tries the chain again on its own, has a Check again button, and counts a licence issued from Postern while the key is locked.

## 0.1.16
_2026-10-10_
- Fixed: Send receipt no longer fails on a normal-sized trip, and a trip too big for one request now tells you how many lines it can check.

## 0.1.15
_2026-10-10_
- No visible change

## 0.1.14
_2026-10-10_
- Fixed: The title bar at the top of each screen now stays flush at the top instead of floating below a gap that the page scrolled through.

## 0.1.13
_2026-10-09_
- No visible change

## 0.1.12
_2026-10-09_
- Fixed: the 'Update ready' banner is now amber with dark text, so it stands out from the app's blue bars.

## 0.1.11
_2026-10-09_
- New: The bar at the bottom of a trip now says how many prices are guesses, so you can see why the subtotal is lower than what the receipt says.

## 0.1.10
_2026-10-09_
- New: A finished trip can now take a photo of its receipt, which fixes the prices and fills in the Actual Total.

## 0.1.9
_2026-10-09_
- New: When TradeTracker cannot find a price for a scanned item it now fills in a best guess, marks it 'Guess' and counts it in your trip total until the receipt or you give the real price.

## 0.1.8
_2026-10-09_
- New: End Trip now lets you place the receipt lines it could not match, either on a trip line or as a new item, and marks trip lines that are not on the receipt.

## 0.1.7
_2026-10-09_
- Fixed: tapping Update no longer hangs on 'Updating…'.

## 0.1.6
_2026-10-09_
- New: End Trip can read a photo of your receipt and fix each line's price and the receipt total for you, keeping the barcodes and listing what changed.

## 0.1.5
_2026-10-09_
- New: Per-pound items can now have a fractional weight like 2.03 lb, and a photo of a weighed label fills in both the price per pound and the weight so the total comes out right.

## 0.1.4
_2026-10-09_
- No visible change

## 0.1.3
_2026-10-09_
- New: You can now set how many of a brand-new item you are buying while it is still waiting on the factory, and it keeps that number when it fills in.

## 0.1.2
_2026-10-09_
- No visible change

## 0.1.1
_2026-10-09_
- No visible change

## 0.1.0
_2026-10-05_

### Credits and thanks

Settings > About now has a **Credits and thanks** link to a new About screen. It opens with
Newton's line ("If I have seen further it is by standing on the shoulders of Giants.") and
credits every library, tool, data source, service and borrowed idea the app stands on, each
with its name as the link, what it is used for, its licence and what we changed. The README
has the same list, and a test fails if a runtime dependency is missing from it.

### The licence is read from the Postern door

With the key unlocked, Settings > Factory now asks the Postern door whether the key is
licensed for TradeTracker, so an issued licence shows **Held** and photo lookups are sent
(it used to say **Could not check**, because the chain check only reads the holder's own
address history). If the door cannot be reached the chain check's answer stands; locked,
nothing is asked of the door. Offline use is unchanged.

### Photo lookups through the factory

An unknown barcode no longer ends at a blank form. The scanner opens a photo screen:
take a **Package** photo, optionally a **Shelf tag** photo, then **Done** (or **Skip**
the tag; **Type it instead** keeps the old manual form). The item joins the trip at
once as a pending line ("Waiting on the factory") that counts for nothing until it is
filled in, and fills itself in (name, category, unit, price from the tag) when the
factory's answer lands, usually within minutes. A filled price carries a **Check price**
badge (or **Add price** when the tag gave none); tapping it, or editing the line,
clears it. A failed lookup shows why, with **Retry**.

A known item's price can also be refreshed from its shelf tag: **Photo price** on the
trip row or the item page takes one photo and, when the answer lands, updates the
price (flagged **Check price**) and adds a price-history entry. An unreadable tag says
**No price read** and leaves the old price alone.

Pending lines show as pending on the trip detail, edit and end-trip pages, and stay out
of the CSV and JSON exports and the AI trip export.

Settings > **Factory** holds the app's key, with no passphrase: **Make key** shows a
12-word recovery phrase once and the public key to **Copy**, and where the device can do
WebAuthn it asks for your fingerprint at once and keeps a fingerprint-wrapped copy; the
key's **Licence** (read from the chain, collection `trade-tracker`) must be *held* before
anything is sent. **Unlock with fingerprint** opens the key for the day; the **12 words**
field is the fallback, and the only unlock on a device with no WebAuthn. **Use fingerprint**
adds the fingerprint later and **Remove fingerprint** deletes only that copy, so the 12
words still open the key. A key made earlier with a passphrase still opens with it.

Offline-first is unchanged: without a key or licence, scans, trips and items work as
before, and waiting lookups simply wait.
