/// <reference types="vitest/globals" />
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

import { configure } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { ASYNC_WAIT_MS } from "pwa-kit/test-preset";

// findBy* and waitFor wait the loaded-host budget, not testing-library's 1 s
configure({ asyncUtilTimeout: ASYNC_WAIT_MS });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
