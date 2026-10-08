import { askDoorLicence } from "@/services/door-licence";

const KEY = new Uint8Array(32).fill(7);
const NONCE = "ab".repeat(16);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake backend: /challenge always answers, /me answers `me`. */
function fakeFetch(me: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/challenge")) return json(200, { nonce: NONCE });
    if (url.endsWith("/api/me")) return me();
    return json(404, {});
  };
  return { impl, calls };
}

describe("askDoorLicence", () => {
  it("is held when /api/me lists trade-tracker in apps", async () => {
    const { impl, calls } = fakeFetch(() => json(200, { pubkey: "02ab", apps: ["trade-tracker"] }));
    expect(await askDoorLicence("https://door.test/", KEY, impl)).toBe("held");
    expect(calls).toEqual(["https://door.test/api/challenge", "https://door.test/api/me"]);
  });

  it("is none when /api/me answers 200 without trade-tracker in apps", async () => {
    const other = fakeFetch(() => json(200, { apps: ["postern"] }));
    expect(await askDoorLicence("https://door.test", KEY, other.impl)).toBe("none");
    const missing = fakeFetch(() => json(200, { pubkey: "02ab" }));
    expect(await askDoorLicence("https://door.test", KEY, missing.impl)).toBe("none");
  });

  it("is none on a 401 whose reason is no_licence", async () => {
    const { impl } = fakeFetch(() => json(401, { reason: "no_licence" }));
    expect(await askDoorLicence("https://door.test", KEY, impl)).toBe("none");
  });

  it("is unreachable when the backend cannot be reached, errors, or refuses the proof", async () => {
    const down: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await askDoorLicence("https://door.test", KEY, down)).toBe("unreachable");
    const five = fakeFetch(() => json(503, {}));
    expect(await askDoorLicence("https://door.test", KEY, five.impl)).toBe("unreachable");
    const old = fakeFetch(() => json(404, {}));
    expect(await askDoorLicence("https://door.test", KEY, old.impl)).toBe("unreachable");
    const badProof = fakeFetch(() => json(401, { reason: "signature" }));
    expect(await askDoorLicence("https://door.test", KEY, badProof.impl)).toBe("unreachable");
  });

  it("signs the request with the v2 scheme: a Postern2 header, never the v1 'Postern' one", async () => {
    const headers: string[] = [];
    const impl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/challenge")) return json(200, { nonce: NONCE });
      headers.push(new Headers(init?.headers).get("Authorization") ?? "");
      return json(200, { apps: ["trade-tracker"] });
    };
    await askDoorLicence("https://door.test", KEY, impl);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatch(/^Postern2 [0-9a-f]{66}:[0-9a-f]+:[0-9a-f]+$/);
  });
});
