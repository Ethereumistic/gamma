import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { useWorkspace } from "@/features/workspace/context";
import {
  TOOL_DEFAULTS,
  TOOL_NUMERIC_FIELDS,
  LAYER_NUMERIC_FIELDS,
  resolveTools,
  computeOverrides,
  type ToolConfig,
  type LayerConfig,
} from "@/features/cnc-pipeline/tool-defaults";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RotateCcw, Save, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** A single editable numeric field with label, showing default vs. current */
function ToolField({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  const isDirty = value !== defaultValue;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
        {label}
      </label>
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className={cn(
          "h-7 w-24 rounded-md border bg-background/50 px-2 text-xs font-mono text-right tabular-nums",
          isDirty
            ? "border-primary/50 text-primary focus:border-primary"
            : "border-white/10 text-white/80 focus:border-white/20"
        )}
      />
      {isDirty && (
        <button
          onClick={() => onChange(defaultValue)}
          className="text-[10px] text-slate-500 hover:text-white transition-colors flex items-center gap-1"
          title={`Reset to default (${defaultValue})`}
        >
          <RotateCcw className="h-3 w-3" />
          {defaultValue}
        </button>
      )}
      {!isDirty && (
        <span className="text-[10px] text-slate-600 font-mono">{defaultValue}</span>
      )}
    </div>
  );
}

/** Collapsible section for a single tool */
function ToolSection({
  toolNum,
  config,
  defaultConfig,
  onUpdateTool,
  onUpdateLayer,
}: {
  toolNum: number;
  config: ToolConfig;
  defaultConfig: ToolConfig;
  onUpdateTool: (field: string, value: number) => void;
  onUpdateLayer: (layerName: string, field: string, value: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const layerNames = Object.keys(config.layers);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.01] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        )}
        <span className="text-xs font-bold uppercase tracking-widest text-white">
          T{config.number}
        </span>
        <span className="text-[11px] text-slate-500">—</span>
        <span className="text-[11px] text-slate-400">{config.name}</span>
        <span className="text-[11px] text-slate-500">({config.id})</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Tool-level numeric fields */}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 mb-2">
              Tool Parameters
            </h4>
            <div className="space-y-0.5">
              {TOOL_NUMERIC_FIELDS.map((field) => (
                <ToolField
                  key={field}
                  label={field.replace(/_/g, " ")}
                  value={(config as any)[field] as number}
                  defaultValue={(defaultConfig as any)[field] as number}
                  onChange={(v) => onUpdateTool(field, v)}
                />
              ))}
            </div>
          </div>

          {/* Per-layer settings */}
          {layerNames.map((layerName) => (
            <div key={layerName}>
              <Separator className="bg-white/5 mb-3" />
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/80 mb-2">
                Layer: {layerName}
              </h4>
              <div className="space-y-0.5">
                {LAYER_NUMERIC_FIELDS.map((field) => (
                  <ToolField
                    key={`${layerName}-${field}`}
                    label={field}
                    value={(config.layers[layerName] as any)[field] as number}
                    defaultValue={(defaultConfig.layers[layerName] as any)[field] as number}
                    onChange={(v) => onUpdateLayer(layerName, field, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CNCSettingsPanel() {
  const { selectedOrganization } = useWorkspace();
  const organizationId = selectedOrganization?.id ?? null;

  // Fetch stored overrides from Convex
  const settingsDoc = useQuery(
    api.cnc_settings.getByOrganization,
    organizationId ? { organizationId } : "skip"
  );

  const upsertSettings = useMutation(api.cnc_settings.upsert);
  const resetSettings = useMutation(api.cnc_settings.resetToDefaults);

  // Build the resolved tools config (defaults + overrides)
  const storedOverrides = settingsDoc?.toolOverrides ?? {};
  const resolved = useMemo(
    () => resolveTools(TOOL_DEFAULTS, storedOverrides),
    [storedOverrides]
  );

  // Local editing state — initialized from resolved config
  const [localTools, setLocalTools] = useState<Record<number, ToolConfig>>(resolved);
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when Convex data changes
  useEffect(() => {
    setLocalTools(resolved);
  }, [resolved]);

  const hasChanges = useMemo(() => {
    const currentOverrides = computeOverrides(localTools, TOOL_DEFAULTS);
    const storedKeys = Object.keys(storedOverrides);
    const localKeys = Object.keys(currentOverrides);
    if (storedKeys.length !== localKeys.length) return true;
    return JSON.stringify(currentOverrides) !== JSON.stringify(storedOverrides);
  }, [localTools, storedOverrides]);

  const handleUpdateTool = useCallback(
    (toolNum: number, field: string, value: number) => {
      setLocalTools((prev) => ({
        ...prev,
        [toolNum]: {
          ...prev[toolNum],
          [field]: value,
        },
      }));
    },
    []
  );

  const handleUpdateLayer = useCallback(
    (toolNum: number, layerName: string, field: string, value: number) => {
      setLocalTools((prev) => {
        const tool = prev[toolNum];
        return {
          ...prev,
          [toolNum]: {
            ...tool,
            layers: {
              ...tool.layers,
              [layerName]: {
                ...(tool.layers[layerName] as LayerConfig),
                [field]: value,
              },
            },
          },
        };
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!organizationId) return;
    const overrides = computeOverrides(localTools, TOOL_DEFAULTS);
    setIsSaving(true);
    try {
      await upsertSettings({ organizationId, toolOverrides: overrides });
      toast.success("CNC settings saved");
    } catch (e: any) {
      toast.error("Failed to save settings: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  }, [organizationId, localTools, upsertSettings]);

  const handleReset = useCallback(async () => {
    if (!organizationId) return;
    setIsSaving(true);
    try {
      await resetSettings({ organizationId });
      setLocalTools(TOOL_DEFAULTS);
      toast.success("Settings reset to defaults");
    } catch (e: any) {
      toast.error("Failed to reset: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  }, [organizationId, resetSettings]);

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-500">
        Select an organization to manage CNC settings.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[520px] pr-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
              Tool Configuration
            </h3>
            <p className="text-[10px] text-slate-500 mt-1">
              Override default tool parameters. Changes apply to all future NC program generation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={isSaving}
              className="h-7 text-[11px] text-slate-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset All
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="h-7 text-[11px] font-bold"
            >
              <Save className="h-3 w-3 mr-1" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <Separator className="bg-white/5" />

        {Object.keys(TOOL_DEFAULTS)
          .map(Number)
          .sort((a, b) => a - b)
          .map((toolNum) => (
            <ToolSection
              key={toolNum}
              toolNum={toolNum}
              config={localTools[toolNum]}
              defaultConfig={TOOL_DEFAULTS[toolNum]}
              onUpdateTool={(field, value) => handleUpdateTool(toolNum, field, value)}
              onUpdateLayer={(layer, field, value) =>
                handleUpdateLayer(toolNum, layer, field, value)
              }
            />
          ))}
      </div>
    </ScrollArea>
  );
}
