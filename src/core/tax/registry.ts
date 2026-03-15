import type { TaxModule } from "./types";

const modules = new Map<string, TaxModule>();

/**
 * Register a tax module for a state code.
 */
export function registerTaxModule(mod: TaxModule): void {
  modules.set(mod.stateCode.toUpperCase(), mod);
}

/**
 * Look up a tax module by state code. Returns undefined if none registered.
 */
export function getTaxModule(stateCode: string): TaxModule | undefined {
  return modules.get(stateCode.toUpperCase());
}

/**
 * Returns all registered state codes.
 */
export function getRegisteredStates(): string[] {
  return Array.from(modules.keys());
}
