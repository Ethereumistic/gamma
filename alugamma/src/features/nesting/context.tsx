// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Context Provider
// Manages all nesting state: job, parts, layouts, export
//
// Plan refs: PLAN_0 §6
// ────────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";

import type { NestPart, NestJob, SheetLayout, NestJobStatus } from "./types";
import { createEmptyNestJob, detectPackingMode } from "./types";
import { packAllParts } from "./packer";
import { writeNestSheetDxf, downloadDxf, exportAllSheetsAsZip } from "./dxf-writer";

// ── Context Type ────────────────────────────────────────────────────────────

type NestingContextType = {
  // Job state
  job: NestJob;
  setJobName: (name: string) => void;

  // Part management
  addPart: (part: NestPart) => void;
  removePart: (partId: string) => void;
  updatePartCount: (partId: string, count: number) => void;
  clearParts: () => void;

  // Packing
  runPacking: () => void;

  // Export
  exportSheet: (layoutIndex: number) => void;
  exportAllSheets: () => void;

  // Sheet selection
  selectedSheetIndex: number | null;
  setSelectedSheet: (index: number | null) => void;

  // Computed
  totalMaterialUsed: number; // percentage
  totalSheetsToCut: number;
  productionWarnings: string[];
};

const NestingContext = createContext<NestingContextType | null>(null);

export function useNesting() {
  const context = useContext(NestingContext);
  if (!context) {
    throw new Error("useNesting must be used within a NestingProvider");
  }
  return context;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function NestingProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<NestJob>(createEmptyNestJob());
  const [selectedSheetIndex, setSelectedSheetIndex] = useState<number | null>(null);

  // ── Job Name ──────────────────────────────────────────────────────────────

  const setJobName = useCallback((name: string) => {
    setJob((prev) => ({ ...prev, name, updatedAt: Date.now() }));
  }, []);

  // ── Part Management ──────────────────────────────────────────────────────

  const addPart = useCallback((part: NestPart) => {
    setJob((prev) => {
      // Check for duplicate ID
      if (prev.parts.some((p) => p.id === part.id)) {
        // Update count instead
        return {
          ...prev,
          parts: prev.parts.map((p) =>
            p.id === part.id ? { ...p, count: p.count + part.count } : p,
          ),
          updatedAt: Date.now(),
        };
      }
      return {
        ...prev,
        parts: [...prev.parts, part],
        updatedAt: Date.now(),
      };
    });
  }, []);

  const removePart = useCallback((partId: string) => {
    setJob((prev) => ({
      ...prev,
      parts: prev.parts.filter((p) => p.id !== partId),
      updatedAt: Date.now(),
    }));
  }, []);

  const updatePartCount = useCallback((partId: string, count: number) => {
    setJob((prev) => ({
      ...prev,
      parts: prev.parts.map((p) =>
        p.id === partId ? { ...p, count: Math.max(1, Math.round(count)) } : p,
      ),
      updatedAt: Date.now(),
    }));
  }, []);

  const clearParts = useCallback(() => {
    setJob((prev) => ({
      ...prev,
      parts: [],
      layouts: [],
      warnings: [],
      totalSheetsToCut: 0,
      status: "idle",
      updatedAt: Date.now(),
    }));
  }, []);

  // ── Packing ────────────────────────────────────────────────────────────────

  const runPacking = useCallback(() => {
    setJob((prev) => {
      if (prev.parts.length === 0) {
        toast.error("No parts to pack. Add parts first.");
        return prev;
      }

      try {
        const { layouts, mode, warnings } = packAllParts(prev.parts);

        const totalSheetsToCut = layouts.reduce((sum, l) => sum + l.repeatCount, 0);

        toast.success(
          `Packed into ${layouts.length} layout${layouts.length !== 1 ? "s" : ""} (${totalSheetsToCut} sheets total)`,
        );

        return {
          ...prev,
          layouts,
          mode,
          warnings,
          totalSheetsToCut,
          status: "done" as NestJobStatus,
          updatedAt: Date.now(),
        };
      } catch (error) {
        console.error("Packing error:", error);
        toast.error("Packing failed. Check parts configuration.");
        return {
          ...prev,
          status: "error" as NestJobStatus,
          warnings: [error instanceof Error ? error.message : "Unknown packing error"],
          updatedAt: Date.now(),
        };
      }
    });
  }, []);

  // ── Export ──────────────────────────────────────────────────────────────────

  const exportSheet = useCallback(
    (layoutIndex: number) => {
      const layout = job.layouts[layoutIndex];
      if (!layout) {
        toast.error("Sheet layout not found.");
        return;
      }

      try {
        const dxfContent = writeNestSheetDxf(layout, job.parts);
        const filename = `${layout.sheetName}_x${layout.repeatCount}`;
        downloadDxf(dxfContent, filename);
        toast.success(`Exported ${filename}.dxf`);
      } catch (error) {
        console.error("Export error:", error);
        toast.error("Failed to export DXF.");
      }
    },
    [job],
  );

  const exportAllSheets = useCallback(async () => {
    if (job.layouts.length === 0) {
      toast.error("No layouts to export. Run packing first.");
      return;
    }

    try {
      await exportAllSheetsAsZip(job.layouts, job.parts);
      toast.success(`Exported ${job.layouts.length} sheet layout(s) as ZIP.`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export ZIP.");
    }
  }, [job]);

  // ── Computed Values ────────────────────────────────────────────────────────

  const SHEET_AREA = 1250 * 3200; // mm²

  const totalMaterialUsed = job.layouts.length > 0
    ? Math.round(
        job.layouts.reduce((sum, layout) => {
          const partArea = layout.placements.reduce(
            (s, pl) => s + pl.packWidth * pl.packHeight,
            0,
          );
          return sum + (partArea / SHEET_AREA) * 100;
        }, 0) / job.layouts.length,
      )
    : 0;

  const totalSheetsToCut = job.totalSheetsToCut;

  const productionWarnings = job.warnings;

  // ── Context Value ──────────────────────────────────────────────────────────

  const value: NestingContextType = {
    job,
    setJobName,
    addPart,
    removePart,
    updatePartCount,
    clearParts,
    runPacking,
    exportSheet,
    exportAllSheets,
    selectedSheetIndex,
    setSelectedSheet: setSelectedSheetIndex,
    totalMaterialUsed,
    totalSheetsToCut,
    productionWarnings,
  };

  return (
    <NestingContext.Provider value={value}>
      {children}
    </NestingContext.Provider>
  );
}