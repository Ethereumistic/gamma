import { useSettings, type SettingsTab } from "./context";
import { HotkeysPanel } from "./hotkeys-panel";
import { CNCSettingsPanel } from "./cnc-settings-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "cnc", label: "CNC Tools", icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "hotkeys", label: "Hotkeys", icon: <Keyboard className="h-3.5 w-3.5" /> },
];

export function SettingsDialog() {
  const { settingsOpen, closeSettings, activeTab, openSettings } = useSettings();

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="max-w-3xl border-white/10 bg-background text-white">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-6 pt-2">
          <nav className="w-[180px] shrink-0 border-r border-white/5 pr-6 space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => openSettings(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-4 py-2 text-left text-xs font-bold uppercase tracking-widest transition-all",
                  activeTab === tab.id
                    ? "bg-primary text-black shadow-neon-green-sm"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                {activeTab === tab.id && (
                  <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
                )}
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 min-w-0">
            {activeTab === "hotkeys" && <HotkeysPanel />}
            {activeTab === "cnc" && <CNCSettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
