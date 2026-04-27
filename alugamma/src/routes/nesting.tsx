// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Route Component
// 3-column layout: parts | canvas | sheet list
// ────────────────────────────────────────────────────────────────────────────────

import { useRef, useState } from "react";
import { Play, Download, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import { NestingProvider, useNesting } from "@/features/nesting/context";
import { NestingHotkeys } from "@/features/nesting/hotkeys";
import { PartListPanel } from "@/features/nesting/part-list";
import { SheetListPanel } from "@/features/nesting/sheet-list";
import { ExportSettingsDialog } from "@/features/nesting/export-dialog";
import { PreviewCanvas, type PreviewCanvasHandle } from "@/features/nesting/preview-canvas";
import type { SheetLayout } from "@/features/nesting/types";

function NestingAppInner() {
  const {
    job,
    setJobName,
    runPacking,
    exportAllSheets,
    clearParts,
    selectedSheetIndex,
    setSelectedSheet,
    totalMaterialUsed,
    totalSheetsToCut,
    productionWarnings,
  } = useNesting();

  const previewCanvasRef = useRef<PreviewCanvasHandle>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const selectedLayout: SheetLayout | null =
    selectedSheetIndex !== null && job.layouts[selectedSheetIndex]
      ? job.layouts[selectedSheetIndex]
      : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full flex-col overflow-hidden">
      <NestingHotkeys
        previewCanvasRef={previewCanvasRef}
        onRunPacking={runPacking}
        onExportAll={() => setExportDialogOpen(true)}
        onNewJob={clearParts}
      />

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-card/60 px-4 py-2">
        <Input
          value={job.name}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="Job name"
          className="h-8 w-48 text-sm"
        />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={runPacking}
            disabled={job.parts.length === 0 || job.status === "packing"}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Pack
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExportDialogOpen(true)}
            disabled={job.layouts.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearParts}
            title="New job (Cmd+N)"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            New
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {job.status === "done" && (
            <>
              <Badge variant="outline" className="text-[10px]">
                {job.layouts.length} layout{job.layouts.length !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {totalSheetsToCut} sheets
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                ~{totalMaterialUsed}% utilization
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px]"
              >
                Mode {job.mode}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* ── 3-Column Layout ── */}
      <div className="grid flex-1 grid-cols-[280px,1fr,260px] overflow-hidden">
        {/* ── Left: Parts List ── */}
        <PartListPanel />

        {/* ── Center: Preview Canvas ── */}
        <div className="relative flex flex-col overflow-hidden rounded-lg m-1">
          {productionWarnings.length > 0 && (
            <div className="border-b border-yellow-500/20 bg-yellow-500/[0.06] px-4 py-1.5">
              {productionWarnings.map((w, i) => (
                <p key={i} className="text-[11px] text-yellow-400/80">⚠ {w}</p>
              ))}
            </div>
          )}
          <div className="relative flex-1 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.04),transparent_60%)]" />
            <div className="absolute inset-0">
              <PreviewCanvas
                ref={previewCanvasRef}
                layout={selectedLayout}
                parts={job.parts}
                className="w-full h-full"
              />
            </div>
          </div>
          {!selectedLayout && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-muted-foreground/50">
                  {job.parts.length === 0
                    ? "Add parts to start nesting"
                    : job.layouts.length === 0
                      ? "Click Pack to arrange parts on sheets"
                      : "Select a sheet layout"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Sheet List ── */}
        <SheetListPanel />
      </div>

      {/* ── Export Dialog ── */}
      <ExportSettingsDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
      />
    </div>
  );
}

export default function NestingApp() {
  return (
    <NestingProvider>
      <NestingAppInner />
    </NestingProvider>
  );
}