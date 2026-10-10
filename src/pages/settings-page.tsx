import { PageHeader } from "@/components/layout/page-header";
import { SETTINGS_SECTIONS } from "@/settings/sections";

export default function SettingsPage() {
  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Settings" />

      <div className="flex-1 p-4 space-y-6">
        {SETTINGS_SECTIONS.map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </div>
    </div>
  );
}
