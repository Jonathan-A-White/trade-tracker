# Changelog

## Unreleased

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

Settings > **Factory** holds the app's key: **Make key** (with a passphrase) shows a
12-word recovery phrase once and the public key to **Copy**; the key's **Licence**
(read from the chain, collection `trade-tracker`) must be *held* before anything is
sent. **Use fingerprint** adds a passkey-wrapped second copy so **Unlock with
fingerprint** opens the key for the day; the passphrase stays as the fallback and
**Remove fingerprint** deletes only the fingerprint copy.

Offline-first is unchanged: without a key or licence, scans, trips and items work as
before, and waiting lookups simply wait.
