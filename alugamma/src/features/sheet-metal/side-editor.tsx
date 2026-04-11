import { useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { sumMeasurements } from "@/features/sheet-metal/geometry";
import { getUnifiedFeatures, type FrezMode, type FrezNotchPosition, type HoleData, type SideConfig, type SideKey } from "@/features/sheet-metal/types";

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
  onAddInnerFrez: () => void;
  onChangeFlange: (index: number, value: number) => void;
  onChangeFrez: (index: number, value: number) => void;
  onChangeInnerFrez: (index: number, value: number) => void;
  onRemoveFlange: (index: number) => void;
  onRemoveFrez: (index: number) => void;
  onRemoveInnerFrez: (index: number) => void;
  onFocusFlange?: (index: number) => void;
  onFocusInnerFrez?: (index: number) => void;
  onFocusHoles?: (parentKind: "flange" | "innerFrez", index: number) => void;
  onSetFrezMode: (mode: FrezMode) => void;
  onSetFrezNotch: (index: number, position: FrezNotchPosition, value: boolean) => void;
  onSetInnerFrezNotch: (index: number, position: FrezNotchPosition, value: boolean) => void;
  onSetInnerFrezSpan: (index: number, position: "start" | "end", value: boolean) => void;
  onSetFlangeRelief: (index: number, position: "start" | "end", value: boolean) => void;
  onSetFlangeFlap: (index: number, position: "start" | "end", value: number) => void;
  onRemoveHoles: (parentKind: "flange" | "innerFrez", index: number) => void;
  onUpdateHoleField: (parentKind: "flange" | "innerFrez", index: number, field: "sideOffset" | "endOffset" | "length" | "placement" | "orientation", value: number | string) => void;
  onSetHoleLineEnabled: (parentKind: "flange" | "innerFrez", index: number, line: "line1Enabled" | "line2Enabled", value: boolean) => void;
  onClearAll: () => void;
  isSelected?: boolean;
  selectedFlangeIndex?: number | null;
  selectedInnerFrezIndex?: number | null;
  selectedHolesIndex?: number | null;
};

/* ------------------------------------------------------------------ */
/*  FlangeChip — horizontal inline chip (top / bottom)                */
/* ------------------------------------------------------------------ */
function FlangeChip({
  index, unifiedPosition, value, side, reliefs, flaps, onChange, onRemove, onFocus, onSetRelief, onSetFlap, inputDataProps, isSelected
}: {
  index: number; unifiedPosition: number; value: number; side: SideKey;
  reliefs: { start: boolean; end: boolean };
  flaps: { start: number; end: number };
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetRelief: (pos: "start" | "end", v: boolean) => void;
  onSetFlap: (pos: "start" | "end", v: number) => void;
  inputDataProps?: { "data-side": SideKey };
  isSelected?: boolean;
}) {
  const baseClass = "group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected
    ? "border-emerald-500/50 bg-emerald-500/15 ring-1 ring-emerald-500/50"
    : "border-white/[0.05] bg-black/15 hover:border-white/10 hover:bg-black/25";

  return (
    <div className={`${baseClass} ${stateClass}`}>
      <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
        F{unifiedPosition}
      </span>
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
      {reliefs.start && (
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          id={`flap-start-${side}-${index}`}
          value={flaps.start === 0 ? "" : flaps.start.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onSetFlap("start", r === "" ? 0 : Number(r)); }}
          placeholder="0"
          className="h-4 w-[24px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[9px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
        />
      )}
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={reliefs.end} onCheckedChange={(c) => onSetRelief("end", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
        {cornerLabels[side].end}
      </label>
      {reliefs.end && (
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          id={`flap-end-${side}-${index}`}
          value={flaps.end === 0 ? "" : flaps.end.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onSetFlap("end", r === "" ? 0 : Number(r)); }}
          placeholder="0"
          className="h-4 w-[24px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[9px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
        />
      )}
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
  index, unifiedPosition, value, side, reliefs, flaps, onChange, onRemove, onFocus, onSetRelief, onSetFlap, inputDataProps, isSelected
}: {
  index: number; unifiedPosition: number; value: number; side: SideKey;
  reliefs: { start: boolean; end: boolean };
  flaps: { start: number; end: number };
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetRelief: (pos: "start" | "end", v: boolean) => void;
  onSetFlap: (pos: "start" | "end", v: number) => void;
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
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">F{unifiedPosition}</span>
      </div>
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
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
              <Checkbox checked={reliefs.start} onCheckedChange={(c) => onSetRelief("start", !!c)}
                className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
              {cornerLabels[side].start}
            </label>
            {reliefs.start && (
              <Input
                type="text" inputMode="numeric" pattern="[0-9]*"
                id={`flap-start-${side}-${index}`}
                value={flaps.start === 0 ? "" : flaps.start.toString()}
                onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onSetFlap("start", r === "" ? 0 : Number(r)); }}
                placeholder="0"
                className="h-4 w-[20px] rounded-sm border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[8px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
              <Checkbox checked={reliefs.end} onCheckedChange={(c) => onSetRelief("end", !!c)}
                className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500" />
              {cornerLabels[side].end}
            </label>
            {reliefs.end && (
              <Input
                type="text" inputMode="numeric" pattern="[0-9]*"
                id={`flap-end-${side}-${index}`}
                value={flaps.end === 0 ? "" : flaps.end.toString()}
                onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onSetFlap("end", r === "" ? 0 : Number(r)); }}
                placeholder="0"
                className="h-4 w-[20px] rounded-sm border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[8px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-emerald-500/50"
              />
            )}
          </div>
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
/*  InnerFrezChip — horizontal inline chip (top / bottom), violet      */
/* ------------------------------------------------------------------ */
function InnerFrezChip({
  index, unifiedPosition, value, side, notches, spanStart, spanEnd, onChange, onRemove, onFocus, onSetNotch, onSetSpan, inputDataProps, isSelected
}: {
  index: number; unifiedPosition: number; value: number; side: SideKey;
  notches: { start: boolean; end: boolean };
  spanStart?: boolean; spanEnd?: boolean;
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetNotch: (pos: FrezNotchPosition, v: boolean) => void;
  onSetSpan: (pos: "start" | "end", v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
  isSelected?: boolean;
}) {
  const baseClass = "group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected
    ? "border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/50"
    : "border-violet-500/20 bg-violet-500/[0.06] hover:border-violet-500/40 hover:bg-violet-500/10";
  return (
    <div className={`${baseClass} ${stateClass}`}>
      <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-400/80">
        Z{unifiedPosition}
      </span>
      {/* Span-start toggle (extend into start-side flange) */}
      <button onClick={() => onSetSpan("start", !spanStart)}
        title={`Extend into ${cornerLabels[side].start} flange (QQ)`}
        className={`rounded px-0.5 text-[10px] font-bold transition-colors ${
          spanStart ? "text-violet-300" : "text-white/20 hover:text-violet-400/60"
        }`}>◄</button>
      <Input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={value === 0 ? "" : value.toString()}
        onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
        onFocus={(e) => { onFocus?.(); e.target.select(); }}
        className="h-5 w-[40px] border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-violet-500/50"
        {...(inputDataProps || {})}
      />
      {/* Span-end toggle (extend into end-side flange) */}
      <button onClick={() => onSetSpan("end", !spanEnd)}
        title={`Extend into ${cornerLabels[side].end} flange (EE)`}
        className={`rounded px-0.5 text-[10px] font-bold transition-colors ${
          spanEnd ? "text-violet-300" : "text-white/20 hover:text-violet-400/60"
        }`}>►</button>
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={notches.start} onCheckedChange={(c) => onSetNotch("start", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-violet-500 data-[state=checked]:bg-violet-500" />
        {cornerLabels[side].start}
      </label>
      <label className="flex cursor-pointer items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-white/90">
        <Checkbox checked={notches.end} onCheckedChange={(c) => onSetNotch("end", !!c)}
          className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-violet-500 data-[state=checked]:bg-violet-500" />
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
/*  InnerFrezBlock — left / right panels, violet                       */
/* ------------------------------------------------------------------ */
function InnerFrezBlock({
  index, unifiedPosition, value, side, notches, spanStart, spanEnd, onChange, onRemove, onFocus, onSetNotch, onSetSpan, inputDataProps, isSelected
}: {
  index: number; unifiedPosition: number; value: number; side: SideKey;
  notches: { start: boolean; end: boolean };
  spanStart?: boolean; spanEnd?: boolean;
  onChange: (v: number) => void; onRemove: () => void;
  onFocus?: () => void;
  onSetNotch: (pos: FrezNotchPosition, v: boolean) => void;
  onSetSpan: (pos: "start" | "end", v: boolean) => void;
  inputDataProps?: { "data-side": SideKey };
  isSelected?: boolean;
}) {
  const baseClass = "group grid grid-cols-[auto,1fr,auto] items-center gap-x-1.5 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected
    ? "border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/50"
    : "border-violet-500/20 bg-violet-500/[0.06] hover:border-violet-500/40 hover:bg-violet-500/10";
  return (
    <div className={`${baseClass} ${stateClass}`}>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400/80">Z{unifiedPosition}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={value === 0 ? "" : value.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onChange(r === "" ? 0 : Number(r)); }}
          onFocus={(e) => { onFocus?.(); e.target.select(); }}
          className="h-5 w-full border-0 bg-white/[0.04] px-1 text-center font-mono text-[11px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-violet-500/50"
          {...(inputDataProps || {})}
        />
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={notches.start} onCheckedChange={(c) => onSetNotch("start", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-violet-500 data-[state=checked]:bg-violet-500" />
            {cornerLabels[side].start}
          </label>
          <label className="flex cursor-pointer items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-white/90">
            <Checkbox checked={notches.end} onCheckedChange={(c) => onSetNotch("end", !!c)}
              className="h-2.5 w-2.5 rounded-[2px] border-white/15 data-[state=checked]:border-violet-500 data-[state=checked]:bg-violet-500" />
            {cornerLabels[side].end}
          </label>
        </div>
        {/* Span toggles — extend frez line into adjacent flanges */}
        <div className="flex items-center gap-1">
          <button onClick={() => onSetSpan("start", !spanStart)}
            title={`Extend into ${cornerLabels[side].start} flange (QQ)`}
            className={`rounded px-1 text-[9px] font-bold transition-colors ${
              spanStart ? "text-violet-300" : "text-white/20 hover:text-violet-400/60"
            }`}>◄◄</button>
          <button onClick={() => onSetSpan("end", !spanEnd)}
            title={`Extend into ${cornerLabels[side].end} flange (EE)`}
            className={`rounded px-1 text-[9px] font-bold transition-colors ${
              spanEnd ? "text-violet-300" : "text-white/20 hover:text-violet-400/60"
            }`}>►►</button>
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
/*  HolesChip — horizontal inline chip (top / bottom), yellow          */
/*  Displays S, E, L inputs + O (inner/outer) + V (horiz/vert) buttons */
/*  Q/E toggle line1/line2 enabled                                      */
/* ------------------------------------------------------------------ */
function HolesChip({
  unifiedPosition, side, holes, parentKind, arrayIndex, onRemove, onUpdateField, onSetLineEnabled, onFocus, isSelected,
}: {
  unifiedPosition: number; side: SideKey; holes: HoleData;
  parentKind: "flange" | "innerFrez"; arrayIndex: number;
  onRemove: () => void;
  onUpdateField: (field: "sideOffset" | "endOffset" | "length" | "placement" | "orientation", value: number | string) => void;
  onSetLineEnabled: (line: "line1Enabled" | "line2Enabled", value: boolean) => void;
  onFocus?: () => void;
  isSelected?: boolean;
}) {
  const baseClass = "group flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected
    ? "border-yellow-500/50 bg-yellow-500/15 ring-1 ring-yellow-500/50"
    : "border-yellow-500/20 bg-yellow-500/[0.06] hover:border-yellow-500/40 hover:bg-yellow-500/10";

  const line1 = holes.line1Enabled !== false;
  const line2 = holes.line2Enabled !== false;

  return (
    <div className={`${baseClass} ${stateClass}`} onClick={onFocus}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/80">H{unifiedPosition}</span>
      {/* Line1 toggle (Q) */}
      <button
        onClick={(e) => { e.stopPropagation(); onSetLineEnabled("line1Enabled", !line1); }}
        title={`Toggle ${cornerLabels[side].start} hole line (Q)`}
        className={`rounded px-0.5 text-[9px] font-bold transition-colors ${
          line1 ? "text-yellow-300" : "text-white/20 hover:text-yellow-400/60"
        }`}>{cornerLabels[side].start}</button>
      {/* S input */}
      <div className="flex items-center gap-0">
        <span className="text-[8px] text-yellow-400/50">S</span>
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          data-side={side}
          data-holes-s={`${parentKind}-${arrayIndex}`}
          value={holes.sideOffset === 0 ? "" : holes.sideOffset.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onUpdateField("sideOffset", r === "" ? 0 : Number(r)); }}
          onFocus={(e) => { onFocus?.(); e.target.select(); }}
          className="h-4 w-[26px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[9px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
        />
      </div>
      {/* E input */}
      <div className="flex items-center gap-0">
        <span className="text-[8px] text-yellow-400/50">E</span>
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          data-side={side}
          value={holes.endOffset === 0 ? "" : holes.endOffset.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onUpdateField("endOffset", r === "" ? 0 : Number(r)); }}
          onFocus={(e) => { onFocus?.(); e.target.select(); }}
          className="h-4 w-[26px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[9px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
        />
      </div>
      {/* L input */}
      <div className="flex items-center gap-0">
        <span className="text-[8px] text-yellow-400/50">L</span>
        <Input
          type="text" inputMode="numeric" pattern="[0-9]*"
          data-side={side}
          value={holes.length === 0 ? "" : holes.length.toString()}
          onChange={(e) => { const r = e.target.value.replace(/[^0-9.]/g, ""); onUpdateField("length", r === "" ? 0 : Number(r)); }}
          onFocus={(e) => { onFocus?.(); e.target.select(); }}
          className="h-4 w-[26px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[9px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
        />
      </div>
      {/* O button: inner/outer toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onUpdateField("placement", holes.placement === "inner" ? "outer" : "inner"); }}
        title="Toggle inner/outer (O)"
        className="rounded px-0.5 text-[9px] font-bold text-yellow-400/70 transition-colors hover:text-yellow-300"
      >{holes.placement === "inner" ? "I" : "O"}</button>
      {/* V button: horizontal/vertical toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onUpdateField("orientation", holes.orientation === "horizontal" ? "vertical" : "horizontal"); }}
        title="Toggle horizontal/vertical (V)"
        className="rounded px-0.5 text-[9px] font-bold text-yellow-400/70 transition-colors hover:text-yellow-300"
      >{holes.orientation === "horizontal" ? "H" : "V"}</button>
      {/* Line2 toggle (E) */}
      <button
        onClick={(e) => { e.stopPropagation(); onSetLineEnabled("line2Enabled", !line2); }}
        title={`Toggle ${cornerLabels[side].end} hole line (E)`}
        className={`rounded px-0.5 text-[9px] font-bold transition-colors ${
          line2 ? "text-yellow-300" : "text-white/20 hover:text-yellow-400/60"
        }`}>{cornerLabels[side].end}</button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-destructive/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HolesBlock — left / right panels, yellow                           */
/* ------------------------------------------------------------------ */
function HolesBlock({
  unifiedPosition, side, holes, parentKind, arrayIndex, onRemove, onUpdateField, onSetLineEnabled, onFocus, isSelected,
}: {
  unifiedPosition: number; side: SideKey; holes: HoleData;
  parentKind: "flange" | "innerFrez"; arrayIndex: number;
  onRemove: () => void;
  onUpdateField: (field: "sideOffset" | "endOffset" | "length" | "placement" | "orientation", value: number | string) => void;
  onSetLineEnabled: (line: "line1Enabled" | "line2Enabled", value: boolean) => void;
  onFocus?: () => void;
  isSelected?: boolean;
}) {
  const baseClass = "group grid grid-cols-[auto,1fr,auto] items-center gap-x-1.5 rounded-lg border px-2 py-1 transition-colors";
  const stateClass = isSelected
    ? "border-yellow-500/50 bg-yellow-500/15 ring-1 ring-yellow-500/50"
    : "border-yellow-500/20 bg-yellow-500/[0.06] hover:border-yellow-500/40 hover:bg-yellow-500/10";

  const line1 = holes.line1Enabled !== false;
  const line2 = holes.line2Enabled !== false;

  return (
    <div className={`${baseClass} ${stateClass}`} onClick={onFocus}>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/80">H{unifiedPosition}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {/* S, E, L inputs row */}
        <div className="flex items-center gap-0.5">
          <div className="flex items-center gap-0">
            <span className="text-[7px] text-yellow-400/50">S</span>
            <Input
              type="text" inputMode="numeric" pattern="[0-9]*"
              data-side={side}
              data-holes-s={`${parentKind}-${arrayIndex}`}
              value={holes.sideOffset === 0 ? "" : holes.sideOffset.toString()}
              onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onUpdateField("sideOffset", r === "" ? 0 : Number(r)); }}
              onFocus={(e) => { onFocus?.(); e.target.select(); }}
              className="h-4 w-[22px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[8px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
            />
          </div>
          <div className="flex items-center gap-0">
            <span className="text-[7px] text-yellow-400/50">E</span>
            <Input
              type="text" inputMode="numeric" pattern="[0-9]*"
              data-side={side}
              value={holes.endOffset === 0 ? "" : holes.endOffset.toString()}
              onChange={(e) => { const r = e.target.value.replace(/[^0-9]/g, ""); onUpdateField("endOffset", r === "" ? 0 : Number(r)); }}
              onFocus={(e) => { onFocus?.(); e.target.select(); }}
              className="h-4 w-[22px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[8px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
            />
          </div>
          <div className="flex items-center gap-0">
            <span className="text-[7px] text-yellow-400/50">L</span>
            <Input
              type="text" inputMode="numeric" pattern="[0-9]*"
              data-side={side}
              value={holes.length === 0 ? "" : holes.length.toString()}
              onChange={(e) => { const r = e.target.value.replace(/[^0-9.]/g, ""); onUpdateField("length", r === "" ? 0 : Number(r)); }}
              onFocus={(e) => { onFocus?.(); e.target.select(); }}
              className="h-4 w-[22px] border-0 bg-white/[0.04] px-0.5 text-center font-mono text-[8px] transition-colors focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-yellow-500/50"
            />
          </div>
        </div>
        {/* O, V buttons + line toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onUpdateField("placement", holes.placement === "inner" ? "outer" : "inner"); }}
            title="Toggle inner/outer (O)"
            className="rounded px-0.5 text-[8px] font-bold text-yellow-400/70 transition-colors hover:text-yellow-300"
          >{holes.placement === "inner" ? "I" : "O"}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onUpdateField("orientation", holes.orientation === "horizontal" ? "vertical" : "horizontal"); }}
            title="Toggle horizontal/vertical (V)"
            className="rounded px-0.5 text-[8px] font-bold text-yellow-400/70 transition-colors hover:text-yellow-300"
          >{holes.orientation === "horizontal" ? "H" : "V"}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onSetLineEnabled("line1Enabled", !line1); }}
            title={`Toggle ${cornerLabels[side].start} hole line (Q)`}
            className={`rounded px-0.5 text-[8px] font-bold transition-colors ${
              line1 ? "text-yellow-300" : "text-white/20 hover:text-yellow-400/60"
            }`}>{cornerLabels[side].start}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onSetLineEnabled("line2Enabled", !line2); }}
            title={`Toggle ${cornerLabels[side].end} hole line (E)`}
            className={`rounded px-0.5 text-[8px] font-bold transition-colors ${
              line2 ? "text-yellow-300" : "text-white/20 hover:text-yellow-400/60"
            }`}>{cornerLabels[side].end}</button>
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
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
  onAddFlange, onAddFrez, onAddInnerFrez, onChangeFlange, onChangeFrez, onChangeInnerFrez,
  onRemoveFlange, onRemoveFrez, onRemoveInnerFrez, onFocusFlange, onFocusInnerFrez, onFocusHoles,
  onSetFrezMode, onSetFrezNotch, onSetInnerFrezNotch, onSetInnerFrezSpan, onSetFlangeRelief, onSetFlangeFlap,
  onRemoveHoles, onUpdateHoleField, onSetHoleLineEnabled,
  onClearAll, isSelected, selectedFlangeIndex, selectedInnerFrezIndex, selectedHolesIndex,
}: SideEditorProps) {
  const [frezOpen, setFrezOpen] = useState(false);

  const frezTotal = sumMeasurements(config.frezLines);
  const frezLimit = config.frezMode === "inner" ? inwardLimit : outwardLimit;
  const hasFrez = config.frezLines.length > 0;
  const hasInnerFrez = config.innerFrezLines.length > 0;
  const isHorizontal = side === "top" || side === "bottom";
  const hasAny = config.flanges.length > 0 || config.frezLines.length > 0 || config.innerFrezLines.length > 0;

  const inputDataProps = {
    "data-side": side,
  };

  /* ── Static header: [label] [+F right-click=Z] [legacy-Z toggle if exists] [🗑] ──
     Left-click +F → add normal flange.
     Right-click +F → add inner frez line (Z1, Z2…).
     The old +Z dropdown is retained only as a badge toggle when a design already
     has legacy frezLines (backward compat) — it is no longer shown as +Z to new users.
  ─────────────────────────────────────────────────────────────────── */
  const header = (
    <div className="flex h-[30px] shrink-0 items-center gap-1 px-2.5">
      <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${accentClass}`}>
        {label}
      </span>
      <button
        onClick={onAddFlange}
        onContextMenu={(e) => { e.preventDefault(); onAddInnerFrez(); }}
        title="Left-click: add flange · Right-click: add inner frez (Z)"
        className="rounded border border-emerald-500/[0.12] px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400/40 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:text-emerald-400">
        +F
      </button>
      {/* Legacy frez toggle — only shown when existing frezLines are present (backward compat) */}
      {hasFrez && (
        <button onClick={() => setFrezOpen(!frezOpen)}
          className="flex items-center gap-0.5 rounded border border-fuchsia-500/25 bg-fuchsia-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] font-bold text-fuchsia-400/80 transition-colors hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 hover:text-fuchsia-300">
          {config.frezLines.length}Z
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${frezOpen ? "rotate-180" : ""}`} />
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

  /* Helper: get holes data for a feature */
  const getHoles = (kind: "flange" | "innerFrez", idx: number): HoleData | undefined => {
    if (kind === "flange") return config.flanges[idx]?.holes;
    return config.innerFrezLines[idx]?.holes;
  };

  /* ══════════════════════════════════════════════════════════════════
     HORIZONTAL — top / bottom
    ══════════════════════════════════════════════════════════════════ */
  if (isHorizontal) {
    return (
      <div className={`side-editor-panel flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-card/70 backdrop-blur-sm ${isSelected ? "ring-1 ring-emerald-500/40" : ""}`}>
        {/* Single row — header + chip scroll area, both h-[30px] */}
        <div className="flex h-[30px] min-w-0 items-stretch">
          {header}
          {(config.flanges.length > 0 || hasInnerFrez) && (
            <div className="my-1 w-px shrink-0 bg-white/[0.06]" />
          )}
          {/* w-0 min-w-0 flex-1: prevents chips from pushing card wider */}
          <div className="w-0 min-w-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full">
              {/* Inner div also h-[30px] so it never makes the row taller */}
              <div className="flex h-[30px] items-center gap-1 px-1.5">
                {getUnifiedFeatures(config).map((feature) => {
                  if (feature.kind === "flange") {
                    const i = feature.arrayIndex;
                    const flange = config.flanges[i];
                    return (
                      <FlangeChip
                        key={flange.id} index={i} unifiedPosition={feature.position} value={flange.amount} side={side}
                        reliefs={flange.reliefs} flaps={flange.flaps}
                        onChange={(v) => onChangeFlange(i, v)}
                        onRemove={() => onRemoveFlange(i)}
                        onFocus={() => onFocusFlange?.(i)}
                        onSetRelief={(pos, v) => onSetFlangeRelief(i, pos, v)}
                        onSetFlap={(pos, v) => onSetFlangeFlap(i, pos, v)}
                        inputDataProps={{ "data-side": side } as any} isSelected={selectedFlangeIndex === i}
                      />
                    );
                  } else if (feature.kind === "innerFrez") {
                    const i = feature.arrayIndex;
                    const frez = config.innerFrezLines[i];
                    return (
                      <InnerFrezChip
                        key={frez.id} index={i} unifiedPosition={feature.position} value={frez.amount} side={side}
                        notches={frez.notches} spanStart={frez.spanStart} spanEnd={frez.spanEnd}
                        onChange={(v) => onChangeInnerFrez(i, v)}
                        onRemove={() => onRemoveInnerFrez(i)}
                        onFocus={() => onFocusInnerFrez?.(i)}
                        onSetNotch={(pos, v) => onSetInnerFrezNotch(i, pos, v)}
                        onSetSpan={(pos, v) => onSetInnerFrezSpan(i, pos, v)}
                        inputDataProps={{ "data-side": side } as any}
                        isSelected={selectedInnerFrezIndex === i}
                      />
                    );
                  } else if (feature.kind === "holes" && feature.parentKind) {
                    const holes = getHoles(feature.parentKind, feature.arrayIndex);
                    if (!holes) return null;
                    const holesKey = `${feature.parentKind}-${feature.arrayIndex}-holes`;
                    const isHolesSelected = selectedHolesIndex === feature.arrayIndex &&
                      ((feature.parentKind === "flange" && selectedFlangeIndex === feature.arrayIndex) ||
                       (feature.parentKind === "innerFrez" && selectedInnerFrezIndex === feature.arrayIndex));
                    return (
                      <HolesChip
                        key={holesKey}
                        unifiedPosition={feature.position}
                        side={side}
                        holes={holes}
                        parentKind={feature.parentKind}
                        arrayIndex={feature.arrayIndex}
                        onRemove={() => onRemoveHoles(feature.parentKind!, feature.arrayIndex)}
                        onUpdateField={(field, value) => onUpdateHoleField(feature.parentKind!, feature.arrayIndex, field, value)}
                        onSetLineEnabled={(line, value) => onSetHoleLineEnabled(feature.parentKind!, feature.arrayIndex, line, value)}
                        onFocus={() => onFocusHoles?.(feature.parentKind!, feature.arrayIndex)}
                        isSelected={isHolesSelected}
                      />
                    );
                  }
                  return null;
                })}
              </div>
              <ScrollBar orientation="horizontal" className="h-1" />
            </ScrollArea>
          </div>
        </div>

        {/* Legacy FREZ panel — only shown for backward compat when hasFrez */}
        {frezOpen && hasFrez && (
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
    ══════════════════════════════════════════════════════════════════ */
  return (
    <div className={`side-editor-panel flex h-full w-[116px] flex-col rounded-xl border border-white/[0.07] bg-card/70 backdrop-blur-sm ${isSelected ? "ring-1 ring-emerald-500/40" : ""}`}>
      {header}

      {/* Horizontal separator — mirrors the vertical one on T/B cards */}
      <div className="mx-1.5 h-px shrink-0 bg-white/[0.06]" />

      {/* Flange + inner-frez list — flex-1 min-h-0 fills remaining height, always scrollable */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 px-1.5 py-1.5">
          {getUnifiedFeatures(config).map((feature) => {
            if (feature.kind === "flange") {
              const i = feature.arrayIndex;
              const flange = config.flanges[i];
              return (
                <FlangeBlock
                  key={flange.id} index={i} unifiedPosition={feature.position} value={flange.amount} side={side}
                  reliefs={flange.reliefs} flaps={flange.flaps}
                  onChange={(v) => onChangeFlange(i, v)}
                  onRemove={() => onRemoveFlange(i)}
                  onFocus={() => onFocusFlange?.(i)}
                  onSetRelief={(pos, v) => onSetFlangeRelief(i, pos, v)}
                  onSetFlap={(pos, v) => onSetFlangeFlap(i, pos, v)}
                  inputDataProps={inputDataProps}
                  isSelected={selectedFlangeIndex === i}
                />
              );
            } else if (feature.kind === "innerFrez") {
              const i = feature.arrayIndex;
              const frez = config.innerFrezLines[i];
              return (
                <InnerFrezBlock
                  key={frez.id} index={i} unifiedPosition={feature.position} value={frez.amount} side={side}
                  notches={frez.notches} spanStart={frez.spanStart} spanEnd={frez.spanEnd}
                  onChange={(v) => onChangeInnerFrez(i, v)}
                  onRemove={() => onRemoveInnerFrez(i)}
                  onFocus={() => onFocusInnerFrez?.(i)}
                  onSetNotch={(pos, v) => onSetInnerFrezNotch(i, pos, v)}
                  onSetSpan={(pos, v) => onSetInnerFrezSpan(i, pos, v)}
                  inputDataProps={inputDataProps}
                  isSelected={selectedInnerFrezIndex === i}
                />
              );
            } else if (feature.kind === "holes" && feature.parentKind) {
              const holes = getHoles(feature.parentKind, feature.arrayIndex);
              if (!holes) return null;
              const holesKey = `${feature.parentKind}-${feature.arrayIndex}-holes`;
              const isHolesSelected = selectedHolesIndex === feature.arrayIndex &&
                ((feature.parentKind === "flange" && selectedFlangeIndex === feature.arrayIndex) ||
                 (feature.parentKind === "innerFrez" && selectedInnerFrezIndex === feature.arrayIndex));
              return (
                <HolesBlock
                  key={holesKey}
                  unifiedPosition={feature.position}
                  side={side}
                  holes={holes}
                  parentKind={feature.parentKind}
                  arrayIndex={feature.arrayIndex}
                  onRemove={() => onRemoveHoles(feature.parentKind!, feature.arrayIndex)}
                  onUpdateField={(field, value) => onUpdateHoleField(feature.parentKind!, feature.arrayIndex, field, value)}
                  onSetLineEnabled={(line, value) => onSetHoleLineEnabled(feature.parentKind!, feature.arrayIndex, line, value)}
                  onFocus={() => onFocusHoles?.(feature.parentKind!, feature.arrayIndex)}
                  isSelected={isHolesSelected}
                />
              );
            }
            return null;
          })}
        </div>
      </ScrollArea>

      {/* Legacy FREZ section — only shown for backward compat when hasFrez */}
      {frezOpen && hasFrez && (
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
