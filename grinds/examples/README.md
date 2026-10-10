# Grind examples

Each grind in `grinds/<kind>.json` keeps one or more scenarios, BDD-style, under
`grinds/examples/<kind>/<name>.json`. A scenario is what a shopper does (the request
and its photos) and what the answer must show (`expect`). `mw grist smoke` sends the
request to the real grist and checks the answer against `expect`; the app's unit test
(`src/grinds/examples.test.ts`) checks every scenario's shape without a network.

```json
{
  "description": "One plain sentence: the situation and what must come back.",
  "schemaVersion": "1.0",
  "request": { "barcode": "0123456789012", "mode": "new-item" },
  "photos": ["shelf-tag-butter.jpg"],
  "expect": {
    "price": { "equals": 4.99 },
    "confidence": { "one_of": ["high", "medium"] }
  }
}
```

- `schemaVersion`: one of the grind's `versions`; names the input and answer schema
  (`schemas/<kind>-input-<version>.schema.json`).
- `request`: the grind's input exactly as the app sends it; valid against the input schema.
- `photos`: file names beside the scenario (`.jpg`, `.jpeg` or `.webp`), as many as the
  grind's `attachments` allow. Public-safe only: no people, no personal data, a synthetic
  or staged picture, under 200 KB. Scenarios may share a photo.
- `expect`: answer path (a field name; dots for nested fields) to a check: a bare value
  (the field equals it), or an object of the checks below, every one of which must hold.
  The names are the ones `mw grist smoke` knows, in snake_case; a camelCase name
  (`isNull`, `oneOf`) is refused by the unit test, as a key or as a bare string:
  - `equals`: the value is exactly this
  - `is_null`: `true` the value is null, `false` it is not
  - `one_of`: the value is one of these
  - `contains`: a string field includes this text
  - `matches`: a string field matches this regular expression
  - `present`: `true` the field is in the answer, `false` it is left out

Every `expect` path must be a field of the grind's answer schema, and every `equals` or
`one_of` value must be one the schema allows.

A story that changes a grind's behaviour updates or adds its scenarios in the same story.
A new grind needs at least one scenario or the unit test fails.

`grinds/<kind>.example.json` beside a grind is a bare request, as the app sends it, for a
reader to copy. It is not a grind (the checker skips it) and not a scenario; its
scenario under `grinds/examples/<kind>/` must carry the same request.
