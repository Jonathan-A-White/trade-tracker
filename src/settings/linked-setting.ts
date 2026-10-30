import { createContext } from "react";

/** The key of the row a link asked for ('/settings?setting=factory'); the Settings page provides it, SettingRow reads it. */
export const LinkedSettingContext = createContext<string | null>(null);
