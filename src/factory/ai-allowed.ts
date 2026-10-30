import { useFactory } from "./factory-context";

/** Whether the AI features may be used: only while the door is licensed (a key made and unlocked, and the licence held). */
export function useAiAllowed(): boolean {
  return useFactory().door === "licensed";
}
