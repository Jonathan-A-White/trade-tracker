import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FORM_START } from "voice-kit/forms";
import { FixUnknownItemModal } from "@/components/forms/fix-unknown-item-modal";
import { ItemForm } from "@/components/forms/item-form";
import { StoreForm } from "@/components/forms/store-form";
import type { FormTalkAnswer, FormTalkAsk, FormTalkRequest } from "./form-talk";
import { FormTutorContext } from "./tutor-context";

/** A faked grind: answers in turn, and keeps the requests it was sent. */
function fakeGrind(answers: Array<FormTalkAnswer | Error>) {
  const requests: FormTalkRequest[] = [];
  const ask: FormTalkAsk = async (request) => {
    requests.push(request);
    const next = answers[requests.length - 1];
    if (!next) throw new Error("the fake grind has no more answers");
    if (next instanceof Error) throw next;
    return next;
  };
  return { ask, requests };
}

function withTutor(ask: FormTalkAsk | null, children: ReactNode) {
  return <FormTutorContext value={ask}>{children}</FormTutorContext>;
}

const OPEN = { name: "Let the tutor do it" };

describe("Let the tutor do it on ItemForm", () => {
  it("asks, fills, and ends with Send, which passes what the form's Save passes", async () => {
    const user = userEvent.setup();
    const { ask, requests } = fakeGrind([
      { answer: "What is the item called?", form_ask: "name" },
      { answer: "How much is it?", form_values: [{ field: "name", value: "Organic Bananas" }], form_ask: "price" },
      {
        answer: "Is it sold by the pound?",
        form_values: [{ field: "price", value: "$0.79" }],
        form_ask: "unitType",
      },
      {
        answer: "That is everything required.",
        form_values: [{ field: "unitType", value: "Per Pound" }],
      },
    ]);
    const onSubmit = vi.fn();
    render(withTutor(ask, <ItemForm onSubmit={onSubmit} onCancel={vi.fn()} />));

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", OPEN));

    expect(await screen.findByText("What is the item called?")).toBeInTheDocument();
    expect(requests[0].question).toBe(FORM_START);
    expect(requests[0].form.name).toBe("Item");
    expect(requests[0].form.command).toBe("item-save");
    expect(requests[0].form.fields).toHaveLength(5);

    await user.type(screen.getByLabelText("Your answer"), "organic bananas");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("How much is it?")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Organic Bananas");
    expect(requests[1].question).toBe("organic bananas");
    expect(requests[1].history).toEqual([{ q: FORM_START, a: "What is the item called?" }]);
    expect(requests[1].form.fields.find((f) => f.name === "name")?.value).toBe("");
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Your answer"), "79 cents");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Is it sold by the pound?")).toBeInTheDocument();
    // a price with a dollar sign is read as the number
    expect(screen.getByLabelText("Price")).toHaveValue(0.79);
    expect(requests[2].form.fields.find((f) => f.name === "name")?.value).toBe("Organic Bananas");

    await user.type(screen.getByLabelText("Your answer"), "yes");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("That is everything required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit Type")).toHaveValue("per_lb");

    // nothing has been sent yet: only his tap sends
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const byDoor = onSubmit.mock.calls[0][0];
    expect(byDoor).toEqual({
      barcode: "",
      name: "Organic Bananas",
      currentPrice: 0.79,
      unitType: "per_lb",
      category: "",
    });

    // the same values by hand
    const bySave = vi.fn();
    const { container } = render(<ItemForm onSubmit={bySave} onCancel={vi.fn()} />);
    const scope = container.querySelector("form") as HTMLElement;
    const field = (id: string) => scope.querySelector(`#${id}`) as HTMLInputElement;
    await user.type(field("item-name"), "Organic Bananas");
    await user.clear(field("item-price"));
    await user.type(field("item-price"), "0.79");
    await user.selectOptions(field("item-unit-type"), "per_lb");
    await user.click(Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLElement);
    expect(bySave).toHaveBeenCalledTimes(1);
    expect(bySave).toHaveBeenCalledWith(byDoor);
  });

  it("does not take a value for a Unit Type that is not an option, or a price that is not a number", async () => {
    const user = userEvent.setup();
    const { ask } = fakeGrind([
      {
        answer: "Anything else?",
        form_values: [
          { field: "unitType", value: "Dozen" },
          { field: "price", value: "cheap" },
          { field: "colour", value: "red" },
        ],
      },
    ]);
    render(withTutor(ask, <ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await user.click(screen.getByRole("button", OPEN));
    expect(await screen.findByText("Anything else?")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit Type")).toHaveValue("each");
    expect(screen.getByLabelText("Price")).toHaveValue(0);
  });

  it("names a failure and asks again on Retry", async () => {
    const user = userEvent.setup();
    const { ask, requests } = fakeGrind([new Error("The factory is not answering."), { answer: "What is it called?", form_ask: "name" }]);
    render(withTutor(ask, <ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} />));
    await user.click(screen.getByRole("button", OPEN));
    expect(await screen.findByRole("alert")).toHaveTextContent("The factory is not answering.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("What is it called?")).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[1].question).toBe(FORM_START);
  });

  it("says plainly that the tutor needs the factory when there is none, and the form still works", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withTutor(null, <ItemForm onSubmit={onSubmit} onCancel={vi.fn()} />));
    await user.click(screen.getByRole("button", OPEN));
    expect(await screen.findByRole("alert")).toHaveTextContent(/factory/i);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", OPEN)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Milk");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("works with no provider at all, so a page that never heard of the factory still renders", () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", OPEN)).toBeInTheDocument();
  });
});

describe("Let the tutor do it on StoreForm", () => {
  it("asks, fills, and ends with Send, which passes what the form's Save passes", async () => {
    const user = userEvent.setup();
    const { ask, requests } = fakeGrind([
      { answer: "What is the store called?", form_ask: "name" },
      {
        answer: "That is everything required.",
        form_values: [
          { field: "name", value: "Stop & Shop" },
          { field: "city", value: "Danbury" },
          { field: "state", value: "CT" },
          { field: "notes", value: "Open late" },
        ],
      },
    ]);
    const onSubmit = vi.fn();
    render(withTutor(ask, <StoreForm onSubmit={onSubmit} onCancel={vi.fn()} />));
    await user.click(screen.getByRole("button", OPEN));
    expect(await screen.findByText("What is the store called?")).toBeInTheDocument();
    expect(requests[0].form.name).toBe("Store");
    expect(requests[0].form.command).toBe("store-save");
    expect(requests[0].form.fields.map((f) => f.label)).toEqual(["Store Name", "City", "State", "Notes"]);

    await user.type(screen.getByLabelText("Your answer"), "stop and shop in danbury, connecticut");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("State")).toHaveValue("CT");

    const bySave = vi.fn();
    const { container } = render(<StoreForm onSubmit={bySave} onCancel={vi.fn()} />);
    const scope = container.querySelector("form") as HTMLElement;
    const field = (id: string) => scope.querySelector(`#${id}`) as HTMLElement;
    await user.type(field("store-name"), "Stop & Shop");
    await user.type(field("store-city"), "Danbury");
    await user.selectOptions(field("store-state"), "CT");
    await user.type(field("store-notes"), "Open late");
    await user.click(Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLElement);
    expect(bySave).toHaveBeenCalledWith(onSubmit.mock.calls[0][0]);
  });
});

describe("Let the tutor do it on Identify Item", () => {
  it("fills the modal and Send runs the modal's own save", async () => {
    const user = userEvent.setup();
    const { ask, requests } = fakeGrind([
      {
        answer: "That is everything required.",
        form_values: [
          { field: "name", value: "Organic Coleslaw" },
          { field: "category", value: "Produce" },
        ],
      },
    ]);
    const onSave = vi.fn();
    render(
      withTutor(
        ask,
        <FixUnknownItemModal itemId="item-1" currentPrice={2.49} onSave={onSave} onCancel={vi.fn()} />,
      ),
    );
    await user.click(screen.getByRole("button", OPEN));
    expect(await screen.findByText("That is everything required.")).toBeInTheDocument();
    expect(requests[0].form.name).toBe("Identify item");
    expect(requests[0].form.command).toBe("identify-item");
    expect(screen.getByLabelText("Name")).toHaveValue("Organic Coleslaw");
    expect(onSave).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      itemId: "item-1",
      name: "Organic Coleslaw",
      barcode: expect.stringMatching(/^manual-/),
      currentPrice: 2.49,
      unitType: "each",
      category: "Produce",
    });
  });

  it("shows why when the modal's save refuses, as a barcode already used", async () => {
    const user = userEvent.setup();
    const { db } = await import("@/db/database");
    await db.items.put({
      id: "other",
      name: "Existing Coleslaw",
      barcode: "00558242",
      currentPrice: 1.99,
      unitType: "each",
      createdAt: 0,
      updatedAt: 0,
    });
    const { ask } = fakeGrind([
      {
        answer: "That is everything required.",
        form_values: [
          { field: "name", value: "Coleslaw" },
          { field: "barcode", value: "00558242" },
        ],
      },
    ]);
    const onSave = vi.fn();
    render(withTutor(ask, <FixUnknownItemModal itemId="item-1" currentPrice={2.49} onSave={onSave} onCancel={vi.fn()} />));
    await user.click(screen.getByRole("button", OPEN));
    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findAllByText(/already used by "Existing Coleslaw"/)).not.toHaveLength(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});
