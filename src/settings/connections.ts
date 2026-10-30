import { createConnections, createSettingsStore } from "pwa-kit/settings";
import type { SectionId } from "./registry";

// The app's connections (pwa-kit/settings, the connection kind): a service the app can talk to, behind one switch that is Off for a stranger.
// The switch is kept on this device; what a connection holds (a token, a cache) is kept by the connection itself.

const PREFIX = "tradetracker-setting-";

export const settingsStore = createSettingsStore({
  read: (key) => localStorage.getItem(PREFIX + key) ?? undefined,
  write: (key, value) => localStorage.setItem(PREFIX + key, value),
});

export const connections = createConnections<SectionId>(settingsStore);

/** YNAB is On only once a token was accepted and a budget chosen. */
export const ynabConnection = connections.register({
  key: "ynab",
  name: "YNAB",
  section: "ynab",
  hint: "Connect your YNAB budget so this app can fit around it.",
  fields: [],
});

/** Whether YNAB is On, live: false until read, and as soon as it is turned Off. Draw nothing of YNAB while it is false. */
export function useYnabOn(): boolean {
  return connections.useConnectionOn(ynabConnection.key);
}

export function setYnabOn(on: boolean): Promise<void> {
  return settingsStore.set(ynabConnection.switch, on ? "on" : "off");
}

/** Family is On once the family's alert address was asked and answered. */
export const familyConnection = connections.register({
  key: "family",
  name: "Family",
  section: "family",
  hint: "Share one mail address so the family's card alerts come here.",
  fields: [],
});

/** Whether Family is On, live: false until read, and as soon as it is turned Off. Draw nothing of the family while it is false. */
export function useFamilyOn(): boolean {
  return connections.useConnectionOn(familyConnection.key);
}

export function setFamilyOn(on: boolean): Promise<void> {
  return settingsStore.set(familyConnection.switch, on ? "on" : "off");
}
