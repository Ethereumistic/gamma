import { useSettings } from "./context";
import { HotkeysPanel } from "./hotkeys-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useSettings();

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="max-w-2xl border-white/10 bg-[#090d16] text-white">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-6 pt-2">
          <nav className="w-36 shrink-0">
            <button className="w-full rounded-lg bg-white/10 px-3 py-2 text-left text-sm font-medium text-white transition-colors hover:bg-white/15">
              Keyboard Shortcuts
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
