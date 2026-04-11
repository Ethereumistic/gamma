import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const isMac = () => {
  if (typeof window === "undefined") return false;
  return window.navigator.platform.toUpperCase().indexOf("MAC") >= 0;
};

const getPlatformSymbol = () => (isMac() ? "⌘" : "Ctrl");
const getShiftSymbol = () => (isMac() ? "⇧" : "Shift");

function HotkeyRow({ shortcut, action }: { shortcut: React.ReactNode; action: string }) {
  return (
    <div className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-all hover:bg-white/5">
      <span className="text-base font-medium text-foreground/80 group-hover:text-foreground">{action}</span>
      <div className="flex items-center gap-1.5">
        {shortcut}
      </div>
    </div>
  );
}

function EnhancedKbd({ children, className }: React.ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      className={cn(
        "h-6 min-w-6 border border-border/50 bg-background/50 px-1.5  font-medium shadow-[0_1px_0_0_rgba(0,0,0,0.1)] transition-all hover:border-border/80 hover:bg-background hover:shadow-[0_2px_0_0_rgba(0,0,0,0.1)]",
        className
      )}
    >
      {children}
    </Kbd>
  );
}

function EnhancedKbdGroup({ children, className }: React.ComponentProps<typeof KbdGroup>) {
  return (
    <KbdGroup className={cn("gap-1.5", className)}>
      {children}
    </KbdGroup>
  );
}

function PlusSeparator() {
  return <span className="mx-1 text-xs text-muted-foreground/40">+</span>;
}

function ArrowSeparator() {
  return <span className="mx-1 text-xs text-muted-foreground/40">→</span>;
}

export function HotkeysPanel() {
  const [platformSymbol, setPlatformSymbol] = useState(() => getPlatformSymbol());
  const [shiftSymbol, setShiftSymbol] = useState(() => getShiftSymbol());

  useEffect(() => {
    setPlatformSymbol(getPlatformSymbol());
    setShiftSymbol(getShiftSymbol());
  }, []);

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-6">
        <div>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-primary">Traditional</h3>
          <div className="space-y-1">
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>S</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Save design"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>S</EnhancedKbd>
                  <ArrowSeparator />
                  <EnhancedKbd>D</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Save + Duplicate"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>S</EnhancedKbd>
                  <ArrowSeparator />
                  <EnhancedKbd>E</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Save + Export DXF"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>N</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="New design"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>Delete</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Delete design (confirm)"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>{shiftSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>Delete</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Delete design (no confirm)"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>F</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Center/focus preview"
            />
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>R</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Toggle rubberband"
            />
          </div>
        </div>

        <Separator className="bg-white/10" />

        <div>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-accent">Power User (Sheet Metal)</h3>
          <p className="mb-3 text-xs text-muted-foreground/60">
            Side selection hotkeys only work when not typing in an input field.
          </p>
          <div className="space-y-1">
            <HotkeyRow
              shortcut={
                <EnhancedKbdGroup>
                  <EnhancedKbd>{platformSymbol}</EnhancedKbd>
                  <PlusSeparator />
                  <EnhancedKbd>1</EnhancedKbd>
                  <span className="mx-1 text-xs text-muted-foreground/40">to</span>
                  <EnhancedKbd>9</EnhancedKbd>
                </EnhancedKbdGroup>
              }
              action="Select feature #1..9 (F or Z)"
            />
            <HotkeyRow shortcut={<EnhancedKbd>W</EnhancedKbd>} action="Select Top side" />
            <HotkeyRow shortcut={<EnhancedKbd>A</EnhancedKbd>} action="Select Left side" />
            <HotkeyRow shortcut={<EnhancedKbd>S</EnhancedKbd>} action="Select Bottom side" />
            <HotkeyRow shortcut={<EnhancedKbd>D</EnhancedKbd>} action="Select Right side" />
            <HotkeyRow shortcut={<EnhancedKbd>F</EnhancedKbd>} action="Add Flange (side selected)" />
            <HotkeyRow shortcut={<EnhancedKbd>Z</EnhancedKbd>} action="Add Frez (side selected)" />
            <HotkeyRow shortcut={<EnhancedKbd>Q</EnhancedKbd>} action="Toggle L checkbox (side selected)" />
            <HotkeyRow shortcut={<EnhancedKbd>E</EnhancedKbd>} action="Toggle R checkbox (side selected)" />
            <HotkeyRow shortcut={<EnhancedKbd>Esc</EnhancedKbd>} action="Deselect side" />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
