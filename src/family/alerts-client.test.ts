import { vault } from "bsv-kit/bsv";
import { fakeAlerts } from "./fake-alerts";
import { makeAlertsClient } from "./alerts-client";

const BACKEND = "https://backend.example.test";
const key = new Uint8Array(32).fill(7);

describe("makeAlertsClient", () => {
  it("asks for the family's address with a signed POST /api/alerts/address", async () => {
    const backend = fakeAlerts("tok234tok234@alerts.example.test");
    const client = makeAlertsClient(BACKEND, key, backend.fetch);
    expect(await client.address()).toBe("tok234tok234@alerts.example.test");
    const call = backend.requests.find((r) => r.path === "/api/alerts/address");
    expect(call?.method).toBe("POST");
    expect(call?.authorization).toMatch(new RegExp(`^Postern2 ${vault.publicKeyHexFromKey(key)}:`));
  });

  it("lists the alerts after a cursor and returns the cursor to ask from next", async () => {
    const backend = fakeAlerts();
    const first = backend.receive({ kind: "charge", amount: "42.17", merchant: "Stop & Shop", last4: "1234" });
    const second = backend.receive({ kind: "forward-confirm", code: "123456" });
    const client = makeAlertsClient(BACKEND, key, backend.fetch);

    const all = await client.list(0);
    expect(all.alerts.map((a) => a.id)).toEqual([first.id, second.id]);
    expect(all.next).toBe(second.seq);

    const none = await client.list(all.next);
    expect(none).toEqual({ alerts: [], next: second.seq });
    expect(backend.requests.some((r) => r.path === `/api/alerts?since=${second.seq}`)).toBe(true);
  });

  it("claims one alert with DELETE /api/alerts/{id}", async () => {
    const backend = fakeAlerts();
    const alert = backend.receive({ kind: "amazon", merchant: "Amazon" });
    const client = makeAlertsClient(BACKEND, key, backend.fetch);
    await client.claim(alert.id);
    expect(backend.feed).toEqual([]);
    expect(backend.requests.some((r) => r.method === "DELETE" && r.path === `/api/alerts/${alert.id}`)).toBe(true);
  });

  it("says in plain words when there is no licence, when the backend has no alerts, and when it fails", async () => {
    const backend = fakeAlerts();
    const client = makeAlertsClient(BACKEND, key, backend.fetch);
    backend.refuse = { status: 401, reason: "no_licence" };
    await expect(client.address()).rejects.toThrow("Licence required");
    backend.refuse = { status: 501 };
    await expect(client.address()).rejects.toThrow("This backend does not keep alerts yet.");
    backend.refuse = { status: 500 };
    await expect(client.list(0)).rejects.toThrow("The backend could not answer (500).");
  });

  it("refuses an answer that is not an address", async () => {
    const odd: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/challenge")) return new Response(JSON.stringify({ nonce: "ab".repeat(16) }));
      return new Response(JSON.stringify({ address: 5 }));
    };
    await expect(makeAlertsClient(BACKEND, key, odd).address()).rejects.toThrow("The backend sent an address this app cannot read.");
  });
});
