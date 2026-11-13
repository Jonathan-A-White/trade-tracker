import { Blob } from "node:buffer";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import TripEditPage from "./trip-edit-page";
import { db } from "@/db/database";
import { PendingLookupRepository } from "@/db/repositories/pending-lookup-repository";
import { TripRepository } from "@/db/repositories/trip-repository";
import { TripItemRepository } from "@/db/repositories/trip-item-repository";

const lookups = new PendingLookupRepository();
const tripRepo = new TripRepository();
const tripItemRepo = new TripItemRepository();

describe("TripEditPage Discard", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    URL.createObjectURL = vi.fn(() => "blob:thumb");
    URL.revokeObjectURL = vi.fn();
  });

  it("offers Undo, which puts the pending line back with its photos", async () => {
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
    const trip = await tripRepo.create({ storeId: "s1", startedAt: now });
    const lookup = await lookups.create({
      barcode: "0099887766",
      tripId: trip.id,
      photos: [new Blob(["photo"], { type: "image/jpeg" }) as unknown as globalThis.Blob],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/trips/${trip.id}/edit`]}>
        <Routes>
          <Route path="/trips/:id/edit" element={<TripEditPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /discard/i }));

    await waitFor(() => {
      expect(screen.queryByText("Sending to the factory")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Discarded the photo of 0099887766.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Sending to the factory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect((await lookups.getById(lookup.id))?.photos).toHaveLength(1);
    expect((await tripItemRepo.getByTrip(trip.id)).filter((l) => l.pending)).toHaveLength(1);
  });
});
