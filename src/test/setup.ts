/// <reference types="vitest/globals" />
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";

import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
