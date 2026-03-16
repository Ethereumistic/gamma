import { useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { sumMeasurements } from "@/features/sheet-metal/geometry";
import type { FrezMode, FrezNotchPosition, SideConfig, SideKey } from "@/features/sheet-metal/types";

const cornerLabels: Record<SideKey, { start: string; end: string }> = {
  top: { start: "L", end: "R" },
  bottom: { start: "L", end: "R" },
  left: { start: "T", end: "B" },
  right: { start: "T", end: "B" },
};

type SideEditorProps = {
  side: SideKey;
  label: string;
  accentClass: string;
  config: SideConfig;
  inwardLimit: number;
  outwardLimit: number;
  onAddFlange: () => void;
  onAddFrez: () => void;
  onChangeFlange: (index: number, value: number) => void;
  onChangeFrez: (index: number, value: number) => void;
  onRemoveFlange: (index: number) => void;
  onRemoveFrez: (index: number) => void;
  onFocusFlange?: (index: number) => void;
  onSetFrezMode: (mode: FrezMode) => void;
  onSetFrezNotch: (index: number, position: FrezNotchPosition, value: boolean) => void;
  onSetFlangeRelief: (index: number, position: "start" | "end", value: boolean) => void;
  onClearAll: () => void;
  isSelected?: boolean;
  selectedFlangeIndex?: number | null;
};

/* ------------------------------------------------------------------ */
/*  FlangeChip — horizontal inline chip (top / bottom)                */
/* ------------------------------------------------------------------ */
function FlangeChip({
  index, value, side, reliefs, onChange, onRemove, onFocus, onSetRelief, inputDataProps, isSelected,
}: {
  index: number; value: number; side: SideKey;
  reliefs: { start: boolean; end: boolean };
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetRelief: (pos: "start" | "end", v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
  isSelected?: boolean;
}) {
  const baseClass = "group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected 
    ? "border-emerald-500/50 bg-emerald-500/15 ring-1 ring-emerald-500/50"
    : "border-white/[0.05] bg-black/15 hover:border-white/10 hover:bg-black/25";

  return (
    <div className={`${baseClass} ${stateClass}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">F{index + 1}</span>
      <Input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={value === 0 ? "" : value.toString()}
        onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
        onFocus={(e) => {
           onFocus?.();
           e.target.select();
        }}
        className="h-5 w-[40px] border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
        {...(inputDataProps || {})}
      />
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={reliefs.start} onCheckedChange={(c) => onSetRelief("start", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
        {cornerLabels[side].start}
      </label>
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={reliefs.end} onCheckedChange={(c) => onSetRelief("end", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
        {cornerLabels[side].end}
      </label>
      <button onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-destructive/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FlangeBlock — left / right panels                                 */
/*  3-col grid: [F#  centered] [input / checkboxes stacked] [× centered] */
/* ------------------------------------------------------------------ */
function FlangeBlock({
  index, value, side, reliefs, onChange, onRemove, onFocus, onSetRelief, inputDataProps, isSelected,
}: {
  index: number; value: number; side: SideKey;
  reliefs: { start: boolean; end: boolean };
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetRelief: (pos: "start" | "end", v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
  isSelected?: boolean;
}) {
  const baseClass = "group grid grid-cols-[auto,1fr,auto] items-center gap-x-1.5 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected 
    ? "border-emerald-500/50 bg-emerald-500/15 ring-1 ring-emerald-500/50"
    : "border-white/[0.05] bg-black/15 hover:border-white/10 hover:bg-black/25";

  return (
    <div className={`${baseClass} ${stateClass}`}>
      {/* Col 1: label — grid items-center keeps it vertically centered */}
      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">F{index + 1}</span>
      {/* Col 2: input + checkboxes stacked */}
      <div className="flex flex-col gap-0.5">
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={value === 0 ? "" : value.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
          onFocus={(e) => {
             onFocus?.();
             e.target.select();
          }}
          className="h-5 w-full border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
          {...(inputDataProps || {})}
        />
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={reliefs.start} onCheckedChange={(c) => onSetRelief("start", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
            {cornerLabels[side].start}
          </label>
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={reliefs.end} onCheckedChange={(c) => onSetRelief("end", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
            {cornerLabels[side].end}
          </label>
        </div>
      </div>
      {/* Col 3: × — grid items-center keeps it vertically centered */}
      <button onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-destructive/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FrezChip — horizontal (top / bottom)                              */
/* ------------------------------------------------------------------ */
function FrezChip({
  index, value, side, notches, onChange, onRemove, onSetNotch, inputDataProps,
}: {
  index: number; value: number; side: SideKey;
  notches: { start: boolean; end: boolean };
  onChange: (v: number) => void; onRemove: () => void;
  onSetNotch: (pos: FrezNotchPosition, v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
}) {
  return (
    <div className="group flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.05] bg-black/15 px-2 py-1 transition-colors hover:border-fuchsia-500/20 hover:bg-black/25">
      <span className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-400/80">Z{index + 1}</span>
      <Input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={value === 0 ? "" : value.toString()}
        onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
        className="h-5 w-[40px] border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-fuchsia-500/50"
        {...(inputDataProps || {})}
      />
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={notches.start} onCheckedChange={(c) => onSetNotch("start", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-500" />
        {cornerLabels[side].start}
      </label>
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={notches.end} onCheckedChange={(c) => onSetNotch("end", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-500" />
        {cornerLabels[side].end}
      </label>
      <button onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-destructive/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FrezBlock — left / right panels                                   */
/* ------------------------------------------------------------------ */
function FrezBlock({
  index, value, side, notches, onChange, onRemove, onSetNotch, inputDataProps,
}: {
  index: number; value: number; side: SideKey;
  notches: { start: boolean; end: boolean };
  onChange: (v: number) => void; onRemove: () => void;
  onSetNotch: (pos: FrezNotchPosition, v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
}) {
  return (
    <div className="group grid grid-cols-[auto,1fr,auto] items-center gap-x-1.5 rounded-lg border border-white/[0.05] bg-black/15 px-2 py-1 transition-colors hover:border-fuchsia-500/20 hover:bg-black/25">
      <span className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-400/80">Z{index + 1}</span>
      <div className="flex flex-col gap-0.5">
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={value === 0 ? "" : value.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
          className="h-5 w-full border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-fuchsia-500/50"
          {...(inputDataProps || {})}
        />
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={notches.start} onCheckedChange={(c) => onSetNotch("start", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-500" />
            {cornerLabels[side].start}
          </label>
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={notches.end} onCheckedChange={(c) => onSetNotch("end", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-500" />
            {cornerLabels[side].end}
          </label>
        </div>
      </div>
      <button onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-destructive/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main SideEditor                                                    */
/* ------------------------------------------------------------------ */
export function SideEditor({
  side, label, accentClass, config, inwardLimit, outwardLimit,
  onAddFlange, onAddFrez, onChangeFlange, onChangeFrez,
  onRemoveFlange, onRemoveFrez, onFocusFlange, onSetFrezMode, onSetFrezNotch, onSetFlangeRelief,
  onClearAll, isSelected, selectedFlangeIndex,
}: SideEditorProps) {
  const [frezOpen, setFrezOpen] = useState(false);

  const frezTotal = sumMeasurements(config.frezLines);
  const frezLimit = config.frezMode === "inner" ? inwardLimit : outwardLimit;
  const hasFrez = config.frezLines.length > 0;
  const isHorizontal = side === "top" || side === "bottom";
  const hasAny = config.flanges.length > 0 || config.frezLines.length > 0;

  const inputDataProps = {
    "data-side": side,
  };

  /* ── Static header: [label] [+F] [+Z] [🗑] ──────────────────────
     Fixed height h-[30px] on BOTH sides so that the horizontal card never
     shifts height when the first chip appears next to it.
     The h-[30px] equals: py-1 (4px top + 4px bottom) + content ~22px.
     We use h-[30px] explicitly so both zero-flange and n-flange states
     render the exact same header box height.
  ─────────────────────────────────────────────────────────────────── */
  const header = (
    <div className="flex h-[30px] shrink-0 items-center gap-1 px-2.5">
      <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${accentClass}`}>
        {label}
      </span>
      <button onClick={onAddFlange}
        className="rounded border border-emerald-500/[0.12] px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400/40 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:text-emerald-400">
        +F
      </button>
      {hasFrez || frezOpen ? (
        <button onClick={() => setFrezOpen(!frezOpen)}
          className="flex items-center gap-0.5 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] font-bold text-fuchsia-400/80 transition-colors hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 hover:text-fuchsia-300">
          {config.frezLines.length}Z
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${frezOpen ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <button onClick={() => { onAddFrez(); setFrezOpen(true); }}
          className="rounded border border-fuchsia-500/[0.12] px-1.5 py-0.5 font-mono text-[9px] font-bold text-fuchsia-400/40 transition-colors hover:border-fuchsia-500/40 hover:bg-fuchsia-500/[0.08] hover:text-fuchsia-400">
          +Z
        </button>
      )}
      {/* Trash — clears all flanges + frez for this side */}
      {hasAny && (
        <button onClick={onClearAll}
          className="flex h-5 w-5 items-center justify-center rounded border border-destructive/[0.12] text-destructive/40 transition-colors hover:border-destructive/40 hover:bg-destructive/[0.08] hover:text-destructive">
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════════
     HORIZONTAL — top / bottom
     ┌──────────────┬─────────── h-[30px] scroll area ────────────┐
     │ T [+F][+Z][🗑]│  F1  │  F2  │  F3  │ ...                   │
     └──────────────┴────────────────────────────────────────────-──┘
     The outer row has no padding — height comes purely from h-[30px]
     on both the header and the chip row inner div. Height is constant.
    ══════════════════════════════════════════════════════════════════ */
  if (isHorizontal) {
    return (
      <div className={`side-editor-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-card/70 backdrop-blur-sm ${isSelected ? "ring-1 ring-emerald-500/40" : ""}`}>
        {/* Single row — header + chip scroll area, both h-[30px] */}
        <div className="flex h-[30px] min-w-0 items-stretch">
          {header}
          {config.flanges.length > 0 && (
            <div className="my-1 w-px shrink-0 bg-white/[0.06]" />
          )}
          {/* w-0 min-w-0 flex-1: prevents chips from pushing card wider */}
          <div className="w-0 min-w-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full">
              {/* Inner div also h-[30px] so it never makes the row taller */}
              <div className="flex h-[30px] items-center gap-1 px-1.5">
                {config.flanges.map((flange, i) => (
                  <FlangeChip
                    key={flange.id} index={i} value={flange.amount} side={side}
                    reliefs={flange.reliefs}
                    onChange={(v) => onChangeFlange(i, v)}
                    onRemove={() => onRemoveFlange(i)}
                    onFocus={() => onFocusFlange?.(i)}
                    onSetRelief={(pos, v) => onSetFlangeRelief(i, pos, v)}
                    inputDataProps={inputDataProps}
                    isSelected={selectedFlangeIndex === i}
                  />
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="h-1" />
            </ScrollArea>
          </div>
        </div>

        {/* FREZ — only thing that adds height to T/B cards */}
        {frezOpen && (
          <div className="border-t border-white/[0.04] px-2 pb-2 pt-1.5">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center rounded-full border border-white/[0.06] bg-black/15 p-0.5">
                <button type="button" onClick={() => onSetFrezMode("inner")}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${config.frezMode === "inner" ? "bg-white/10 text-white" : "text-muted-foreground/60 hover:text-white/80"}`}>
                  Inner
                </button>
                <button type="button" onClick={() => onSetFrezMode("outer")}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${config.frezMode === "outer" ? "bg-white/10 text-white" : "text-muted-foreground/60 hover:text-white/80"}`}>
                  Outer
                </button>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/60">{frezTotal}/{frezLimit}</span>
            </div>
            <ScrollArea>
              <div className="flex gap-1 pb-1">
                {config.frezLines.map((frez, i) => (
                  <FrezChip
                    key={frez.id} index={i} value={frez.amount} side={side}
                    notches={frez.notches}
                    onChange={(v) => onChangeFrez(i, v)}
                    onRemove={() => onRemoveFrez(i)}
                    onSetNotch={(pos, v) => onSetFrezNotch(i, pos, v)}
                    inputDataProps={inputDataProps}
                  />
                ))}
                <button onClick={onAddFrez}
                  className="flex shrink-0 items-center gap-1 self-center rounded-lg border border-dashed border-white/[0.06] px-2 py-1 text-[10px] font-semibold text-muted-foreground/50 transition-all hover:border-fuchsia-500/30 hover:bg-fuchsia-500/[0.04] hover:text-fuchsia-400">
                  <Plus className="h-3 w-3" />
                  FREZ
                </button>
              </div>
              <ScrollBar orientation="horizontal" className="h-1" />
            </ScrollArea>
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     VERTICAL — left / right
     Card is w-[116px] fixed — never shifts width.
     Flange list uses ScrollArea that fills remaining height (flex-1
     min-h-0) so it always occupies the full preview height and scrolls
     at any count. No >15 threshold — always in ScrollArea.

       ┌──────────────┐  ← h-[30px] header
       ├──────────────┤  ← 1px separator
       │ F1  [25]   × │  ↑
       │  []T   []B   │  │ flex-1 ScrollArea
       ├──────────────┤  │ fills remaining
       │ F2  [20]   × │  │ grid row height
       │  []T   []B   │  ↓
       └──────────────┘
    ══════════════════════════════════════════════════════════════════ */
  return (
    <div className={`side-editor-panel flex h-full w-[116px] flex-col rounded-xl border border-white/[0.07] bg-card/70 backdrop-blur-sm ${isSelected ? "ring-1 ring-emerald-500/40" : ""}`}>
      {header}

      {/* Horizontal separator — mirrors the vertical one on T/B cards */}
      <div className="mx-1.5 h-px shrink-0 bg-white/[0.06]" />

      {/* Flange list — flex-1 min-h-0 fills remaining height, always scrollable */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 px-1.5 py-1.5">
          {config.flanges.map((flange, i) => (
            <FlangeBlock
              key={flange.id} index={i} value={flange.amount} side={side}
              reliefs={flange.reliefs}
              onChange={(v) => onChangeFlange(i, v)}
              onRemove={() => onRemoveFlange(i)}
              onFocus={() => onFocusFlange?.(i)}
              onSetRelief={(pos, v) => onSetFlangeRelief(i, pos, v)}
              inputDataProps={inputDataProps}
              isSelected={selectedFlangeIndex === i}
            />
          ))}
        </div>
      </ScrollArea>

      {/* FREZ section */}
      {frezOpen && (
        <div className="shrink-0 border-t border-white/[0.04] px-1.5 pb-1.5 pt-1.5">
          <div className="mb-1 flex items-center justify-between gap-1">
            <div className="flex items-center rounded-full border border-white/[0.06] bg-black/15 p-0.5">
              <button type="button" onClick={() => onSetFrezMode("inner")}
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${config.frezMode === "inner" ? "bg-white/10 text-white" : "text-muted-foreground/60 hover:text-white/80"}`}>
                In
              </button>
              <button type="button" onClick={() => onSetFrezMode("outer")}
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${config.frezMode === "outer" ? "bg-white/10 text-white" : "text-muted-foreground/60 hover:text-white/80"}`}>
                Out
              </button>
            </div>
            <span className="font-mono text-[9px] text-muted-foreground/60">{frezTotal}/{frezLimit}</span>
          </div>
          <div className="flex flex-col gap-1">
            {config.frezLines.map((frez, i) => (
              <FrezBlock
                key={frez.id} index={i} value={frez.amount} side={side}
                notches={frez.notches}
                onChange={(v) => onChangeFrez(i, v)}
                onRemove={() => onRemoveFrez(i)}
                onSetNotch={(pos, v) => onSetFrezNotch(i, pos, v)}
                inputDataProps={inputDataProps}
              />
            ))}
            <button onClick={onAddFrez}
              className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.06] py-1 text-[9px] font-semibold text-muted-foreground/50 transition-all hover:border-fuchsia-500/30 hover:bg-fuchsia-500/[0.04] hover:text-fuchsia-400">
              <Plus className="h-2.5 w-2.5" />
              FREZ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}