import { getConfig } from "@testing-library/react";
import { getCurrentTest } from "vitest/suite";
import { ASYNC_WAIT_MS, vitestTimeouts } from "pwa-kit/test-preset";

// The loaded-host budgets come from pwa-kit/test-preset (mw-31qug1.13): a findBy*/waitFor with no
// timeout of its own waits ASYNC_WAIT_MS, not testing-library's 1 s, and a test gets the preset's timeout.
describe("the test preset", () => {
  it("gives testing-library's findBy* and waitFor the preset's wait", () => {
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_WAIT_MS);
  });

  it("gives a test the preset's timeout, not vitest's 5 s", () => {
    expect(getCurrentTest()?.timeout).toBe(vitestTimeouts.testTimeout);
  });
});
