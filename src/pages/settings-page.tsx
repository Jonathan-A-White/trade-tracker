import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Found, SettingsSearch, link, visibleRows } from "pwa-kit/settings";
import type { SettingsRow } from "pwa-kit/settings";
import { PageHeader } from "@/components/layout/page-header";
import { GROUPS, ROWS, SETTINGS_PATH } from "@/settings/registry";
import type { SectionId } from "@/settings/registry";
import { LinkedSettingContext } from "@/settings/linked-setting";
import { SettingRow } from "@/settings/setting-row";
import { SETTINGS_SECTIONS } from "@/settings/sections";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const asked = params.get("setting");
  const linked = ROWS.some((r) => r.key === asked) ? asked : null;
  const searching = query.trim() !== "";

  function openRow(row: SettingsRow<SectionId>) {
    setQuery("");
    navigate(link(row.key, SETTINGS_PATH));
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Settings" />

      <div className="flex-1 p-4 space-y-6">
        <div className="bk-settings">
          <SettingsSearch query={query} onChange={setQuery} />
          {searching && <Found rows={visibleRows(ROWS, {}, query)} query={query} groups={GROUPS} onOpen={openRow} />}
        </div>

        {/* Hidden, not removed, while searching: a recovery phrase shown once or a half-typed field survives the search. */}
        <div hidden={searching} className="space-y-6">
          <LinkedSettingContext value={linked}>
            {SETTINGS_SECTIONS.map(({ id, Component }) => (
              <SettingRow key={id} settingKey={id}>
                <Component />
              </SettingRow>
            ))}
          </LinkedSettingContext>
        </div>
      </div>
    </div>
  );
}
