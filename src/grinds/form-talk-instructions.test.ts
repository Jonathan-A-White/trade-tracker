import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const instructions = readFileSync(
  resolve(process.cwd(), "grinds/form-talk.md"),
  "utf8"
);

// The form fragment is voice-kit's (packages/forms/grind/helping-with-a-form.md),
// copied whole; these are the two bullets of its one optional-field rule.
const ORDER_BULLET =
  "- Never ask for what a field already holds. Go through the fields in screen order, required ones first. Name the field your question is about in `form_ask`.";
const OPTIONAL_BULLET =
  "- Optional fields: ask about one (once at most) only while a required field is still empty and he has answered past it. When every required field holds something, say so in one sentence and leave `form_ask` out, even if optional fields are empty; you may name those empty optional fields in that same sentence so he can add them if he likes. If `form.command` is present, the app shows a Send button once every required field holds something: tell him to read the form, change anything, and tap Send himself.";

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
