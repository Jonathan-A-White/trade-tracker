import { useCardListSync } from "./notify";

/** Draws nothing; keeps the backend's list of this phone's cards right from wherever the app is open. */
export function CardListSync() {
  useCardListSync();
  return null;
}
