// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Export Settings Dialog
// ────────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useNesting } from "./context";

type ExportSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExportSettingsDialog({ open, onOpenChange }: ExportSettingsDialogProps) {
  const { job, exportAllSheets } = useNesting();
  const [includeLabels, setIncludeLabels] = useState(true);

  const handleExport = async () => {
    await exportAllSheets();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Nesting Layouts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">
            Export {job.layouts.length} sheet layout{job.layouts.length !== 1 ? "s" : ""} as a ZIP archive.
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Layouts:</span>{" "}
                <span className="font-mono">{job.layouts.length}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total sheets:</span>{" "}
                <span className="font-mono">{job.totalSheetsToCut}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Mode:</span>{" "}
                <span className="font-mono">{job.mode === "A" ? "Standard Margin" : "Full Span"}</span>
              </div>
            </div>
          </div>

          {job.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/[0.06] p-3">
              <p className="mb-1 text-xs font-semibold text-yellow-400">Warnings</p>
              <ul className="space-y-0.5">
                {job.warnings.map((w, i) => (
                  <li key={i} className="text-[10px] text-yellow-400/80">{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={job.layouts.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export ZIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}