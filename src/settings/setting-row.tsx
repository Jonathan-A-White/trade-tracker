import { useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { LinkedSettingContext } from "./linked-setting";

/** Draws one registered row (src/settings/registry.ts): findable by key, and marked and scrolled to when a link asked for it. */
export function SettingRow({ settingKey, children }: { settingKey: string; children: ReactNode }) {
  const linked = useContext(LinkedSettingContext) === settingKey;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView
    if (linked) ref.current?.scrollIntoView?.({ block: "start" });
  }, [linked]);
  return (
    <div
      ref={ref}
      id={`setting-${settingKey}`}
      data-setting={settingKey}
      aria-current={linked ? "location" : undefined}
      className={`scroll-mt-16 ${linked ? "rounded-lg ring-2 ring-blue-500" : ""}`}
    >
      {children}
    </div>
  );
}
