import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const instructions = readFileSync(
  resolve(process.cwd(), "grinds/form-talk.md"),
  "utf8"
);

// The form fragment is voice-kit's (packages/forms/grind/helping-with-a-form.md),
// copied whole; these are the two bullets of its one optional-field rule.
const ORDER_BULLET =
  "- Ask only about empty required fields, never for what a field already holds: the first empty required field in screen order first, even when an optional field comes before it on the screen. Name the field your question is about in `form_ask`.";
const OPTIONAL_BULLET =
  "- Optional fields: never ask about an optional field. When every required field holds something, say so in one sentence and leave `form_ask` out; you may name the empty optional fields in that same sentence so he can add them if he likes. If `form.command` is present, the app shows a Send button once every required field holds something: tell him to read the form, change anything, and tap Send himself.";

describe("grinds/form-talk.md form fragment", () => {
  it("carries the kit's one optional-field rule", () => {
    expect(instructions).toContain(ORDER_BULLET);
    expect(instructions).toContain(OPTIONAL_BULLET);
  });

  it("no longer tells the tutor to go on to optional fields after the required ones", () => {
    expect(instructions).not.toContain("then optional ones");
  });

  it("says the ready sentence once, not in a second bullet", () => {
    expect(instructions.match(/When every required field holds something/g)).toHaveLength(1);
  });
});
