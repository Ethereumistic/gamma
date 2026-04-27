// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Part List Panel
// Left sidebar: drag-and-drop import, add/remove/configure parts
// ────────────────────────────────────────────────────────────────────────────────

import { useRef, useState, useCallback } from "react";
import { Plus, Trash2, X, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNesting } from "./context";
import { createNestPartFromFile } from "./dxf-reader";
import { createNestPart } from "./types";
import type { NestPart, PartDirection } from "./types";

export function PartListPanel() {
  const { job, addPart, removePart, updatePartCount, clearParts } = useNesting();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragCounterRef = useRef(0);

  // ── File Import Handler ──────────────────────────────────────────────────

  const importFiles = useCallback(async (files: FileList | File[]) => {
    setImporting(true);
    const dxfFiles = Array.from(files).filter(
      (f) => f.name.toLowerCase().endsWith(".dxf"),
    );
    if (dxfFiles.length === 0) {
      setImporting(false);
      return;
    }

    for (const file of dxfFiles) {
      const part = await createNestPartFromFile(file);
      if (part) {
        addPart(part);
      }
    }
    setImporting(false);
  }, [addPart]);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await importFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // ── Drag and Drop ────────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await importFiles(e.dataTransfer.files);
    }
  }, [importFiles]);

  // ── Demo Part ────────────────────────────────────────────────────────────

  const handleAddDemoPart = () => {
    const demoNum = job.parts.length + 1;
    const directions: PartDirection[] = ["T", "B", "L", "R", null];
    const dir = directions[demoNum % directions.length];
    const part = createNestPart({
      name: `Part_${demoNum}`,
      l0Width: 300 + Math.floor(Math.random() * 400),
      l0Height: 150 + Math.floor(Math.random() * 300),
      count: 1 + Math.floor(Math.random() * 10),
      direction: dir,
    });
    addPart(part);
  };

  // ── Direction Display ────────────────────────────────────────────────────

  const directionLabels: Record<string, string> = {
    T: "↑ Top",
    B: "↓ Bot",
    L: "← Left",
    R: "→ Right",
  };

  return (
    <div
      className="flex h-full flex-col border-r border-white/[0.06] bg-card/50"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Parts
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Import DXF files"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleAddDemoPart}
            title="Add demo part"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {job.parts.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={clearParts}
              title="Clear all parts"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      {/* Drag-and-drop zone / part list area */}
      <div className="relative flex-1 overflow-y-auto">
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/10 backdrop-blur-sm">
            <div className="text-center">
              <FileUp className="mx-auto h-10 w-10 text-primary/70" />
              <p className="mt-2 text-sm font-medium text-primary">
                Drop DXF files here
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Supports batch import of 20+ files
              </p>
            </div>
          </div>
        )}

        {importing && !isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-2 text-xs text-muted-foreground">Importing…</p>
            </div>
          </div>
        )}

        {job.parts.length === 0 && !isDragging ? (
          <div
            className="flex h-full cursor-pointer flex-col items-center justify-center p-6 transition-colors hover:bg-white/[0.02]"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="rounded-xl border-2 border-dashed border-white/[0.08] p-6 text-center">
              <FileUp className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground/80">
                Drop DXF files here
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                or click to browse · supports batch import
              </p>
              <p className="mt-3 text-[10px] text-muted-foreground/40">
                Filename patterns: name_B_x50 · name_x8 · name_R · name.dxf
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {job.parts.map((part) => (
              <PartCard
                key={part.id}
                part={part}
                directionLabels={directionLabels}
                onUpdateCount={(count) => updatePartCount(part.id, count)}
                onRemove={() => removePart(part.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      {job.parts.length > 0 && (
        <div className="border-t border-white/[0.06] px-3 py-2">
          <p className="text-[10px] text-muted-foreground/60">
            {job.parts.length} type{job.parts.length !== 1 ? "s" : ""} ·{" "}
            {job.parts.reduce((s, p) => s + p.count, 0)} total instances
          </p>
        </div>
      )}
    </div>
  );
}

// ── Part Card ────────────────────────────────────────────────────────────────

function PartCard({
  part,
  directionLabels,
  onUpdateCount,
  onRemove,
}: {
  part: NestPart;
  directionLabels: Record<string, string>;
  onUpdateCount: (count: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/10 hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">
              {part.name}
            </span>
            {part.direction && (
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {directionLabels[part.direction] ?? part.direction}
              </Badge>
            )}
            {part.source === "custom-dxf" && (
              <Badge variant="outline" className="h-4 bg-blue-500/10 px-1 text-[9px] text-blue-400">
                DXF
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            L0: {part.l0Width.toFixed(0)}×{part.l0Height.toFixed(0)} · CUT: {part.cutWidth.toFixed(0)}×{part.cutHeight.toFixed(0)} mm
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Count control */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50">× </span>
        <Input
          type="number"
          min={1}
          max={9999}
          value={part.count}
          onChange={(e) => onUpdateCount(Math.max(1, parseInt(e.target.value) || 1))}
          className="h-6 w-16 px-1.5 text-xs"
        />
      </div>
    </div>
  );
}