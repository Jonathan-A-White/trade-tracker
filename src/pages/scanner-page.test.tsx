import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import ScannerPage from "./scanner-page";
import { db } from "@/db/database";
import { ItemRepository } from "@/db/repositories/item-repository";
import { TripRepository } from "@/db/repositories/trip-repository";

// the viewfinder owns the camera; here a button stands in for a barcode being read
vi.mock("@/components/scanner/scanner-viewfinder", () => ({
  ScannerViewfinder: ({
    onBarcodeDetected,
    isActive,
  }: {
    onBarcodeDetected: (barcode: string) => void;
    isActive: boolean;
  }) =>
    isActive ? (
      <>
        <button onClick={() => onBarcodeDetected("111")}>read known</button>
        <button onClick={() => onBarcodeDetected("0099887766")}>read unknown</button>
      </>
    ) : null,
}));

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderScanner() {
  return render(
    <MemoryRouter initialEntries={["/trips/active/scan"]}>
      <Routes>
        <Route path="/trips/active/scan" element={<ScannerPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ScannerPage", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    const now = Date.now();
    await db.stores.put({ id: "s1", name: "Corner Shop", createdAt: now, updatedAt: now });
    await new TripRepository().create({ storeId: "s1", startedAt: now });
    await new ItemRepository().create({
      barcode: "111",
      name: "Milk",
      currentPrice: 3,
      unitType: "each",
    });
  });

  it("sends an unknown barcode to the photo screen", async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByText("read unknown"));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/trips/active/photo?barcode=0099887766",
      ),
    );
  });

  it("shows a known barcode's item as before", async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByText("read known"));
    expect(await screen.findByText("Milk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Trip" })).toBeInTheDocument();
  });
});
