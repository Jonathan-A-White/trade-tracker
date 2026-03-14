import { Outlet } from "react-router";
import { BottomNav } from "./bottom-nav";

export function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="pb-16">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
