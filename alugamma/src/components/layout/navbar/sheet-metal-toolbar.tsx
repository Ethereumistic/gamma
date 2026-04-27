import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useHotkey } from "@tanstack/react-hotkeys";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ExportSettingsDialog } from "@/features/sheet-metal/export-settings-dialog";
import { FormulaBar } from "@/features/sheet-metal/formula-bar";
import { type ParseError, parseFormula, serializeFormula } from "@/features/sheet-metal/formula";
import { useSheetMetal } from "@/features/sheet-metal/context";
import { useWorkspace } from "@/features/workspace/context";
import { NavNumberField } from "./nav-number-field";

export function SheetMetalToolbar() {
  const navigate = useNavigate();
  const {
    model,
    designName,
    setDesignName,
    setBaseValue,
    setIncludeName,
    setIncludeArrow,
    setArrowDirection,
    setIncludeMetadata,
    setMetadataCount,
    setInvert,
    setRubberband,
    replaceModel,
    exportDxf,
    saveDesign,
    isSaving,
  } = useSheetMetal();
  const { selectedProject } = useWorkspace();

  // ---------------------------------------------------------------------------
  // Formula bar state — bidirectional sync with model
  // ---------------------------------------------------------------------------

  const formulaInputRef = useRef<HTMLInputElement>(null);
  const skipSyncRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [formulaText, setFormulaText] = useState(() => serializeFormula(model));
  const [formulaErrors, setFormulaErrors] = useState<ParseError[]>([]);

  // Sync: context model → formula string (skip when update originated from formula)
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    // Don't overwrite formula while user is actively editing
    if (document.activeElement === formulaInputRef.current) return;
    setFormulaText(serializeFormula(model));
    setFormulaErrors([]);
  }, [model]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Handler: user types in formula bar (debounced)
  const handleFormulaChange = useCallback((raw: string) => {
    setFormulaText(raw);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const result = parseFormula(raw);
      setFormulaErrors(result.errors);
      if (result.errors.length === 0) {
        skipSyncRef.current = true;
        replaceModel(result.model);
      }
    }, 150);
  }, [replaceModel]);

  // Handler: user selects a recent formula (immediate — no debounce)
  const handleSelectPreset = useCallback((raw: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    setFormulaText(raw);
    const result = parseFormula(raw);
    setFormulaErrors(result.errors);
    if (result.errors.length === 0) {
      skipSyncRef.current = true;
      replaceModel(result.model);
    }
  }, [replaceModel]);

  // Mod+K: focus the formula bar
  useHotkey("Mod+K", (e) => {
    e.preventDefault();
    formulaInputRef.current?.focus();
    formulaInputRef.current?.select();
  });

  // ---------------------------------------------------------------------------
  // Save / Export handlers
  // ---------------------------------------------------------------------------

  async function handleSave() {
    const designId = await saveDesign();
    if (designId) {
      navigate(`/sheet-metal/${designId}`, { replace: true });
    }
  }

  async function handleExport() {
    const designId = await exportDxf();
    if (designId) {
      navigate(`/sheet-metal/${designId}`, { replace: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-1 items-center gap-4 overflow-x-auto">
      {/* Design name */}
      <div className="min-w-[200px] max-w-[280px] flex-1 items-center gap-2 md:flex">
        <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">
          Design
        </span>
        <Input
          value={designName}
          onChange={(event) => setDesignName(event.target.value)}
          onKeyDown={(e) => {
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
              e.stopPropagation();
            }
          }}
          placeholder="e.g. facade-panel-01"
          className="h-8 border-white/10 bg-black/20 text-xs"
        />
      </div>

      {/* Formula bar (replaces preset dropdown) */}
      <div className="min-w-[320px] max-w-[560px] flex-1">
        <FormulaBar
          formula={formulaText}
          errors={formulaErrors}
          onFormulaChange={handleFormulaChange}
          onSelectPreset={handleSelectPreset}
          inputRef={formulaInputRef}
        />
      </div>

      <div className="hidden h-4 w-px bg-white/10 xl:block" />

      {/* Dimension fields */}
      <div className="hidden items-center gap-4 xl:flex">
        <NavNumberField label="W" value={model.baseWidth} onChange={(v) => setBaseValue("baseWidth", v)} />
        <span className="mb-0.5 font-bold text-muted-foreground/30">×</span>
        <NavNumberField label="H" value={model.baseHeight} onChange={(v) => setBaseValue("baseHeight", v)} />
      </div>

      <div className="hidden h-4 w-px bg-white/10 2xl:block" />

      {/* Invert toggles */}
      <div className="hidden items-center gap-4 2xl:flex">
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-white">
          <Checkbox
            checked={model.invertX}
            onCheckedChange={(checked) => setInvert("invertX", !!checked)}
            className="h-3.5 w-3.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
          />
          Invert X
        </label>
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-white">
          <Checkbox
            checked={model.invertY}
            onCheckedChange={(checked) => setInvert("invertY", !!checked)}
            className="h-3.5 w-3.5 border-white/20 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
          />
          Invert Y
        </label>
      </div>

      <div className="h-4 w-px bg-white/10" />

      {/* Actions */}
      <div className="flex items-center gap-2 text-glow-none">
        <ExportSettingsDialog
          model={model}
          onSetIncludeName={setIncludeName}
          onSetIncludeArrow={setIncludeArrow}
          onSetArrowDirection={setArrowDirection}
          onSetIncludeMetadata={setIncludeMetadata}
          onSetMetadataCount={setMetadataCount}
          onSetRubberband={setRubberband}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-4 text-xs"
          onClick={() => void handleSave()}
          disabled={!selectedProject || isSaving}
        >
          Save
        </Button>
        <Button
          size="sm"
          className="h-8 px-4 text-xs shadow-[0_0_15px_rgba(20,180,100,0.15)]"
          onClick={() => void handleExport()}
          disabled={!selectedProject || isSaving}
        >
          {isSaving ? "Saving..." : "Save + Export DXF"}
        </Button>
      </div>
    </div>
  );
}