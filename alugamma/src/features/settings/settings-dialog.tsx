import { useSettings } from "./context";
import { HotkeysPanel } from "./hotkeys-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useSettings();

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="max-w-2xl border-white/10 bg-background text-white">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-6 pt-2">
          <nav className="w-[180px] shrink-0 border-r border-white/5 pr-6">
            <button className="flex w-full items-center gap-2 rounded-lg bg-primary px-4 py-2 text-left text-xs font-bold uppercase tracking-widest text-black transition-all shadow-neon-green-sm">
              <div className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" />
              Hotkeys
            </button>
          </nav>
          <div className="flex-1">
            <HotkeysPanel />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
