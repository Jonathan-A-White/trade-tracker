// A fake Postern backend for the alerts routes (docs/protocol.md 26 on the backend), for tests: it answers the door's GET /api/challenge,
// and POST /api/alerts/address, GET /api/alerts?since= and DELETE /api/alerts/{id} for any signed call, as a family of one.
import type { FamilyAlert } from "./alerts-client";

export interface FakeAlertsRequest {
  method: string;
  /** path and query, without the origin: /api/alerts?since=0 */
  path: string;
  authorization: string | null;
}

export interface FakeAlerts {
  fetch: typeof fetch;
  /** every request made, the door's challenges included */
  requests: FakeAlertsRequest[];
  /** the family's alerts, oldest first; a test pushes to it with `receive` */
  feed: FamilyAlert[];
  /** an alert arrives, as the receiver posts it: it gets an id and the next seq */
  receive(alert: Omit<FamilyAlert, "id" | "seq">): FamilyAlert;
  /** while set, every signed call answers this status (401 no_licence, 501, ...) */
  refuse: { status: number; reason?: string } | null;
}

export function fakeAlerts(address = "abcdefg234567@alerts.example.test"): FakeAlerts {
  let seq = 0;
  const fake: FakeAlerts = {
    requests: [],
    feed: [],
    refuse: null,
    receive: (alert) => {
      seq += 1;
      const made: FamilyAlert = { id: `${seq}`.padStart(16, "0"), seq, ...alert };
      fake.feed.push(made);
      return made;
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const authorization = new Headers(init?.headers).get("Authorization");
      fake.requests.push({ method, path: url.pathname + url.search, authorization });
      const reply = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/api/challenge") return reply(200, { nonce: "ab".repeat(16) });
      if (!authorization?.startsWith("Postern2 ")) return reply(401, { reason: "no_licence" });
      if (fake.refuse) return reply(fake.refuse.status, fake.refuse.reason ? { reason: fake.refuse.reason } : { error: "refused" });
      if (url.pathname === "/api/alerts/address" && method === "POST") return reply(200, { address });
      if (url.pathname === "/api/alerts" && method === "GET") {
        const since = Number(url.searchParams.get("since") ?? "0");
        if (!Number.isInteger(since) || since < 0) return reply(400, { error: "bad since" });
        const alerts = fake.feed.filter((a) => a.seq > since);
        return reply(200, { alerts, next: alerts.length > 0 ? alerts[alerts.length - 1]!.seq : since });
      }
      const claim = /^\/api\/alerts\/([0-9a-f]{16})$/.exec(url.pathname);
      if (claim && method === "DELETE") {
        const at = fake.feed.findIndex((a) => a.id === claim[1]);
        if (at < 0) return reply(404, { error: "no such alert" });
        fake.feed.splice(at, 1);
        return reply(204);
      }
      return reply(404, { error: "not found" });
    },
  };
  return fake;
}
