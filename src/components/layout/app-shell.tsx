import { Outlet } from "react-router";
import { BottomNav } from "./bottom-nav";
import { UpdateBanner } from "@/components/feedback/update-banner";

export function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <UpdateBanner />
      <div className="pb-16">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
