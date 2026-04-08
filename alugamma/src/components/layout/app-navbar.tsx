import { SidebarTrigger } from "@/components/ui/sidebar";
import { NavbarContent } from "./navbar/navbar-content";
import { NotificationBell } from "./navbar/notification-bell";

export function AppNavbar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center gap-4 border-b border-white/5 bg-card/60 px-6 backdrop-blur">
      <SidebarTrigger className="text-muted-foreground hover:text-white" />
      <NavbarContent />
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
      </div>
    </header>
  );
}
