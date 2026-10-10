import { currentReceiptClient, makeLookupClient } from "./lookup-client";

describe("currentReceiptClient", () => {
  it("is null until the lookup queue has been given a key, then signs with that key", () => {
    expect(currentReceiptClient()).toBeNull();
    makeLookupClient("https://example.test", new Uint8Array(32).fill(1));
    const client = currentReceiptClient();
    expect(client).not.toBeNull();
    expect(typeof client?.send).toBe("function");
    expect(typeof client?.awaitAnswer).toBe("function");
  });
});
