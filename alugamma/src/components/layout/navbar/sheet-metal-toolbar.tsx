import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExportSettingsDialog } from "@/features/sheet-metal/export-settings-dialog";
import { presetLibrary } from "@/features/sheet-metal/presets";
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
    setInvert,
    setRubberband,
    loadPreset,
    exportDxf,
    saveDesign,
    isSaving,
  } = useSheetMetal();
  const { selectedProject } = useWorkspace();

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

  return (
    <div className="flex flex-1 items-center gap-4 overflow-x-auto">
      {/* Design name */}
      <div className="min-w-[240px] max-w-[340px] flex-1 items-center gap-2 md:flex">
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

      {/* Preset selector */}
      <div className="hidden items-center gap-2 lg:flex">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Preset
        </span>
        <Select
          onValueChange={(value) => {
            loadPreset(Number(value));
            navigate("/sheet-metal");
          }}
        >
          <SelectTrigger className="h-8 w-[170px] border-white/10 bg-black/20 text-xs hover:bg-white/5 focus:ring-1 focus:ring-emerald-500">
            <SelectValue placeholder="Select preset..." />
          </SelectTrigger>
          <SelectContent>
            {presetLibrary.map((preset, index) => (
              <SelectItem key={preset.name} value={index.toString()}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden h-4 w-px bg-white/10 lg:block" />

      {/* Dimension fields */}
      <div className="hidden items-center gap-4 xl:flex">
        <NavNumberField label="W" value={model.baseWidth} onChange={(v) => setBaseValue("baseWidth", v)} />
        <span className="mb-0.5 font-bold text-muted-foreground/30">×</span>
        <NavNumberField label="H" value={model.baseHeight} onChange={(v) => setBaseValue("baseHeight", v)} />
      </div>

      <div className="hidden h-4 w-px bg-white/10 xl:block" />

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
