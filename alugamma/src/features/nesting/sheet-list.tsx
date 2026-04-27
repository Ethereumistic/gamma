// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Sheet List Panel
// Right sidebar: list of sheet layouts with thumbnails
// ────────────────────────────────────────────────────────────────────────────────

import { Layers, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNesting } from "./context";
import { SHEET_WIDTH, SHEET_HEIGHT } from "./constants";
import type { SheetLayout } from "./types";

export function SheetListPanel() {
  const { job, selectedSheetIndex, setSelectedSheet, exportSheet } = useNesting();

  if (job.layouts.length === 0) {
    return (
      <div className="flex h-full flex-col border-l border-white/[0.06] bg-card/50">
        <div className="border-b border-white/[0.06] px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sheets
          </h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-xs text-muted-foreground/60">
            Run packing to see sheet layouts
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-white/[0.06] bg-card/50">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sheets ({job.layouts.length})
        </h3>
      </div>

      {/* Sheet List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {job.layouts.map((layout, index) => (
            <SheetCard
              key={layout.id}
              layout={layout}
              index={index}
              isSelected={selectedSheetIndex === index}
              onSelect={() => setSelectedSheet(index)}
              onExport={() => exportSheet(index)}
            />
          ))}
        </div>
      </div>

      {/* Footer stats */}
      <div className="border-t border-white/[0.06] px-3 py-2">
        <p className="text-[10px] text-muted-foreground/60">
          {job.totalSheetsToCut} total sheets to cut · Mode {job.mode}
        </p>
      </div>
    </div>
  );
}

// ── Sheet Card ────────────────────────────────────────────────────────────────

function SheetCard({
  layout,
  index,
  isSelected,
  onSelect,
  onExport,
}: {
  layout: SheetLayout;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onExport: () => void;
}) {
  // Compute utilization
  const partArea = layout.placements.reduce(
    (s, pl) => s + pl.packWidth * pl.packHeight,
    0,
  );
  const sheetArea = SHEET_WIDTH * SHEET_HEIGHT;
  const utilization = Math.round((partArea / sheetArea) * 100);

  return (
    <div
      className={`group relative cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
        isSelected
          ? "border-primary/50 bg-primary/[0.08]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
      }`}
      onClick={onSelect}
    >
      {/* Sheet name & repeat */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-muted-foreground/60" />
            <span className="truncate text-xs font-medium text-foreground">
              {layout.sheetName}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            {layout.placements.length} placements · ×{layout.repeatCount} repeat
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge
            variant="outline"
            className={`h-4 px-1.5 text-[9px] ${
              utilization >= 80 ? "border-green-500/30 text-green-400" :
              utilization >= 60 ? "border-yellow-500/30 text-yellow-400" :
              "border-red-500/30 text-red-400"
            }`}
          >
            {utilization}%
          </Badge>
          <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
            Mode {layout.mode}
          </Badge>
        </div>
      </div>

      {/* Export button */}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1.5 h-6 w-full text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onExport();
        }}
      >
        <ArrowDownToLine className="mr-1 h-3 w-3" />
        Export DXF
      </Button>
    </div>
  );
}