export type { TaxModule, TaxEstimate, TaxLineItem } from "./types";
export { registerTaxModule, getTaxModule, getRegisteredStates } from "./registry";

// Auto-register built-in tax modules
import { connecticutTaxModule } from "./modules/connecticut";
import { registerTaxModule } from "./registry";

registerTaxModule(connecticutTaxModule);
