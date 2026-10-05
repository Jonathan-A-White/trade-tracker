# Changelog

## Unreleased

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
