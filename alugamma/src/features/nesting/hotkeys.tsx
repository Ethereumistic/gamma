// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Keyboard Shortcuts
// ────────────────────────────────────────────────────────────────────────────────

import { useEffect, type RefObject } from "react";
import type { PreviewCanvasHandle } from "./preview-canvas";

type NestingHotkeysProps = {
  previewCanvasRef: RefObject<PreviewCanvasHandle | null>;
  onRunPacking: () => void;
  onExportAll: () => void;
  onNewJob: () => void;
};

export function NestingHotkeys({
  previewCanvasRef,
  onRunPacking,
  onExportAll,
  onNewJob,
}: NestingHotkeysProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === "p") {
        e.preventDefault();
        onRunPacking();
      }
      if (isMod && e.key === "e") {
        e.preventDefault();
        onExportAll();
      }
      if (isMod && e.key === "n") {
        e.preventDefault();
        onNewJob();
      }

      // Center view
      if (e.key === "c" && !isMod) {
        previewCanvasRef.current?.centerView();
      }
      // Zoom keys
      if (e.key === "+" || e.key === "=") {
        previewCanvasRef.current?.zoomIn();
      }
      if (e.key === "-" || e.key === "_") {
        previewCanvasRef.current?.zoomOut();
      }

      // Sheet selection by number
      if (e.key >= "1" && e.key <= "9" && !isMod) {
        // handled elsewhere if needed
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewCanvasRef, onRunPacking, onExportAll, onNewJob]);

  return null;
}