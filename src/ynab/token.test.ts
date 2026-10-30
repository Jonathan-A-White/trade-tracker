import { vault } from "bsv-kit/bsv";
import { YNAB_TOKEN_KEY, forgetToken, hasSealedToken, openToken, sealToken } from "./token";

const key = new Uint8Array(32).map((_, i) => i + 1);
const otherKey = new Uint8Array(32).map((_, i) => 200 - i);
const TOKEN = "ynab-pat-0123456789abcdef";

describe("the YNAB token sealed under the key", () => {
  it("opens with the key it was sealed under", async () => {
    const storage = new vault.MemoryStorage();
    await sealToken(storage, key, TOKEN);
    expect(await openToken(storage, key)).toBe(TOKEN);
    expect(await hasSealedToken(storage)).toBe(true);
  });

  it("keeps nothing readable: the token is not in what is stored", async () => {
    const storage = new vault.MemoryStorage();
    await sealToken(storage, key, TOKEN);
    const stored = storage.get(YNAB_TOKEN_KEY);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(btoa(TOKEN));
  });

  it("seals the same token differently each time", async () => {
    const a = new vault.MemoryStorage();
    const b = new vault.MemoryStorage();
    await sealToken(a, key, TOKEN);
    await sealToken(b, key, TOKEN);
    expect(a.get(YNAB_TOKEN_KEY)).not.toBe(b.get(YNAB_TOKEN_KEY));
  });

  it("does not open under another key", async () => {
    const storage = new vault.MemoryStorage();
    await sealToken(storage, key, TOKEN);
    expect(await openToken(storage, otherKey)).toBeNull();
  });

  it("has nothing to open before one is sealed, and after it is forgotten", async () => {
    const storage = new vault.MemoryStorage();
    expect(await openToken(storage, key)).toBeNull();
    expect(await hasSealedToken(storage)).toBe(false);
    await sealToken(storage, key, TOKEN);
    await forgetToken(storage);
    expect(await openToken(storage, key)).toBeNull();
    expect(await hasSealedToken(storage)).toBe(false);
  });

  it("reads damaged storage as no token", async () => {
    const storage = new vault.MemoryStorage();
    storage.set(YNAB_TOKEN_KEY, "not json");
    expect(await openToken(storage, key)).toBeNull();
  });
});
