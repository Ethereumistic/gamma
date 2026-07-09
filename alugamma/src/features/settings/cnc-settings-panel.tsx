import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { useWorkspace } from "@/features/workspace/context";
import {
  TOOL_DEFAULTS,
  TOOL_NUMERIC_FIELDS,
  TOOL_OPTIONAL_FIELDS,
  LAYER_NUMERIC_FIELDS,
  resolveTools,
  computeOverrides,
  computeLayerToolMapOverrides,
  resolveLayerToolMap,
  LAYER_TOOL_MAP_DEFAULTS,
  DEFAULT_LAYER_CONFIG,
  type ToolConfig,
  type LayerConfig,
} from "@/features/cnc-pipeline/tool-defaults";
import { getLayerColor } from "@/features/cnc-pipeline/components/LayerControls";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, Save, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EMPTY_OVERRIDES: Record<string, any> = {};

/** A single editable numeric field with label, showing default vs. current */
function ToolField({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number | undefined;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const isDirty = defaultValue !== undefined ? value !== defaultValue : false;

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
        {label}
      </label>
      <Input
        type="number"
        step="any"
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (next === "" || next === "-" || next === "." || next === "-.") return;
          const v = parseFloat(next);
          if (!isNaN(v)) onChange(v);
        }}
        onBlur={() => setDraft(String(value))}
        className={cn(
          "h-7 w-24 rounded-md border bg-background/50 px-2 text-xs font-mono text-right tabular-nums",
          isDirty
            ? "border-primary/50 text-primary focus:border-primary"
            : "border-white/10 text-white/80 focus:border-white/20"
        )}
      />
      {isDirty && defaultValue !== undefined && (
        <button
          onClick={() => onChange(defaultValue)}
          className="text-[10px] text-slate-500 hover:text-white transition-colors flex items-center gap-1"
          title={`Reset to default (${defaultValue})`}
        >
          <RotateCcw className="h-3 w-3" />
          {defaultValue}
        </button>
      )}
      {!isDirty && defaultValue !== undefined && (
        <span className="text-[10px] text-slate-600 font-mono">{defaultValue}</span>
      )}
    </div>
  );
}

/** Collapsible section for a single tool */
function ToolSection({
  toolKey,
  config,
  defaultConfig,
  isCustom,
  onUpdateTool,
  onUpdateLayer,
  onAddLayer,
  onRemoveLayer,
  onDeleteTool,
}: {
  toolKey: string;
  config: ToolConfig;
  defaultConfig: ToolConfig | undefined;
  isCustom: boolean;
  onUpdateTool: (field: string, value: number) => void;
  onUpdateLayer: (layerName: string, field: string, value: number) => void;
  onAddLayer: (layerName: string) => void;
  onRemoveLayer: (layerName: string) => void;
  onDeleteTool: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [addingLayer, setAddingLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const layerNames = Object.keys(config.layers);

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden",
      isCustom ? "border-amber-500/30 bg-amber-500/[0.02]" : "border-white/5 bg-white/[0.01]"
    )}>
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
        {isCustom && (
          <span className="text-[9px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
            Custom
          </span>
        )}
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
                  defaultValue={defaultConfig ? (defaultConfig as any)[field] as number : undefined}
                  onChange={(v) => onUpdateTool(field, v)}
                />
              ))}
              {/* Optional fields — show for tapered tools or custom tools */}
              {TOOL_OPTIONAL_FIELDS.map((field) => {
                const val = (config as any)[field];
                const defVal = defaultConfig ? (defaultConfig as any)[field] : undefined;
                // Always show if the tool has these fields (tapered tools) or is custom
                if (val !== undefined || isCustom || (defVal !== undefined && defVal !== null)) {
                  return (
                    <ToolField
                      key={field}
                      label={field.replace(/_/g, " ")}
                      value={val ?? 0}
                      defaultValue={defVal ?? undefined}
                      onChange={(v) => onUpdateTool(field, v)}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>

          {/* Per-layer settings */}
          {layerNames.map((layerName) => (
            <div key={layerName}>
              <Separator className="bg-white/5 mb-3" />
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/80">
                  Layer: {layerName}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-slate-500 hover:text-red-400"
                  onClick={() => onRemoveLayer(layerName)}
                  title={`Remove ${layerName} layer from T${config.number}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-0.5">
                {LAYER_NUMERIC_FIELDS.map((field) => (
                  <ToolField
                    key={`${layerName}-${field}`}
                    label={field}
                    value={(config.layers[layerName] as any)[field] as number}
                    defaultValue={
                      defaultConfig?.layers[layerName]
                        ? (defaultConfig.layers[layerName] as any)[field] as number
                        : (DEFAULT_LAYER_CONFIG as any)[field] as number
                    }
                    onChange={(v) => onUpdateLayer(layerName, field, v)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Add layer button */}
          <div>
            {addingLayer ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newLayerName.trim()) {
                      onAddLayer(newLayerName.trim());
                      setNewLayerName("");
                      setAddingLayer(false);
                    }
                    if (e.key === "Escape") {
                      setAddingLayer(false);
                      setNewLayerName("");
                    }
                  }}
                  placeholder="LAYER_NAME"
                  className="h-7 text-xs font-mono uppercase"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
                  onClick={() => {
                    if (newLayerName.trim()) {
                      onAddLayer(newLayerName.trim());
                      setNewLayerName("");
                      setAddingLayer(false);
                    }
                  }}
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-slate-400 hover:text-white"
                  onClick={() => {
                    setAddingLayer(false);
                    setNewLayerName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-slate-400 hover:text-white"
                onClick={() => setAddingLayer(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Layer
              </Button>
            )}
          </div>

          {/* Delete custom tool button */}
          {isCustom && (
            <>
              <Separator className="bg-white/5" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={onDeleteTool}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete Tool T{config.number}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline editable field for tool id and name */
function InlineEdit({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-40 rounded-md border border-white/10 bg-background/50 px-2 text-xs font-mono text-white/80 focus:border-white/20"
      />
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

  // Build the resolved tools config (defaults + overrides + custom tools)
  const storedOverrides = settingsDoc?.toolOverrides ?? EMPTY_OVERRIDES;
  const storedCustomTools = settingsDoc?.customTools ?? undefined;
  const storedLayerToolMap = settingsDoc?.layerToolMap ?? undefined;

  const resolved = useMemo(
    () => resolveTools(TOOL_DEFAULTS, storedOverrides, storedCustomTools),
    [storedOverrides, storedCustomTools]
  );

  // Resolve layer tool map — needs resolved tools for migration
  const resolvedLayerToolMap = useMemo(
    () => resolveLayerToolMap(LAYER_TOOL_MAP_DEFAULTS, storedLayerToolMap ?? null, resolved),
    [storedLayerToolMap, resolved]
  );

  // Local editing state — initialized from resolved config
  const [localTools, setLocalTools] = useState<Record<string, ToolConfig>>(resolved);
  const [localLayerToolMap, setLocalLayerToolMap] = useState<Record<string, string>>(resolvedLayerToolMap);
  const [isSaving, setIsSaving] = useState(false);
  const [showNewTool, setShowNewTool] = useState(false);
  const [newToolNumber, setNewToolNumber] = useState<string>("");
  const [newToolId, setNewToolId] = useState<string>("");
  const [newToolName, setNewToolName] = useState<string>("");

  // Sync local state when Convex data changes
  useEffect(() => {
    setLocalTools(resolved);
    setLocalLayerToolMap(resolvedLayerToolMap);
  }, [resolved, resolvedLayerToolMap]);

  // Extract custom tools (not in defaults) from local state
  const getCustomToolsFromLocal = (tools: Record<string, ToolConfig>): Record<string, ToolConfig> => {
    const custom: Record<string, ToolConfig> = {};
    for (const [key, config] of Object.entries(tools)) {
      if (!(key in TOOL_DEFAULTS)) {
        custom[key] = config;
      }
    }
    return custom;
  };

  const hasChanges = useMemo(() => {
    const currentOverrides = computeOverrides(localTools, TOOL_DEFAULTS);
    const storedKeys = Object.keys(storedOverrides);
    const localKeys = Object.keys(currentOverrides);
    if (storedKeys.length !== localKeys.length) return true;
    if (JSON.stringify(currentOverrides) !== JSON.stringify(storedOverrides)) return true;

    // Check layerToolMap changes
    const currentLayerToolOverrides = computeLayerToolMapOverrides(localLayerToolMap, LAYER_TOOL_MAP_DEFAULTS);
    const storedLayerToolMapObj = storedLayerToolMap ?? {};
    if (JSON.stringify(currentLayerToolOverrides) !== JSON.stringify(storedLayerToolMapObj)) return true;

    // Check customTools changes
    const currentCustomTools = getCustomToolsFromLocal(localTools);
    if (JSON.stringify(currentCustomTools) !== JSON.stringify(storedCustomTools ?? {})) return true;

    return false;
  }, [localTools, localLayerToolMap, storedOverrides, storedLayerToolMap, storedCustomTools]);

  const handleUpdateTool = useCallback(
    (toolKey: string, field: string, value: number) => {
      setLocalTools((prev) => ({
        ...prev,
        [toolKey]: {
          ...prev[toolKey],
          [field]: value,
        },
      }));
    },
    []
  );

  const handleUpdateToolId = useCallback(
    (toolKey: string, value: string) => {
      setLocalTools((prev) => ({
        ...prev,
        [toolKey]: {
          ...prev[toolKey],
          id: value,
        },
      }));
    },
    []
  );

  const handleUpdateToolName = useCallback(
    (toolKey: string, value: string) => {
      setLocalTools((prev) => ({
        ...prev,
        [toolKey]: {
          ...prev[toolKey],
          name: value,
        },
      }));
    },
    []
  );

  const handleUpdateLayer = useCallback(
    (toolKey: string, layerName: string, field: string, value: number) => {
      setLocalTools((prev) => {
        const tool = prev[toolKey];
        return {
          ...prev,
          [toolKey]: {
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

  const handleAddLayer = useCallback(
    (toolKey: string, layerName: string) => {
      setLocalTools((prev) => {
        const tool = prev[toolKey];
        if (tool.layers[layerName]) return prev; // already exists
        return {
          ...prev,
          [toolKey]: {
            ...tool,
            layers: {
              ...tool.layers,
              [layerName]: { ...DEFAULT_LAYER_CONFIG },
            },
          },
        };
      });
    },
    []
  );

  const handleRemoveLayer = useCallback(
    (toolKey: string, layerName: string) => {
      setLocalTools((prev) => {
        const tool = prev[toolKey];
        const { [layerName]: _, ...restLayers } = tool.layers;
        return {
          ...prev,
          [toolKey]: {
            ...tool,
            layers: restLayers,
          },
        };
      });
      // Also remove from layer tool map if this tool was assigned
      setLocalLayerToolMap((prev) => {
        if (prev[layerName] === toolKey) {
          const { [layerName]: _, ...rest } = prev;
          return rest;
        }
        return prev;
      });
    },
    []
  );

  const handleAddTool = useCallback(() => {
    const num = parseInt(newToolNumber, 10);
    if (isNaN(num) || num <= 0) {
      toast.error("Invalid tool number");
      return;
    }
    const id = newToolId.trim() || `tool_${num}`;
    if (id in localTools) {
      toast.error(`Tool ID "${id}" already exists`);
      return;
    }
    const name = newToolName.trim() || `Tool T${num}`;
    setLocalTools((prev) => ({
      ...prev,
      [id]: {
        id,
        name,
        number: num,
        diameter: 6.0,
        gauge_length: 25.0,
        flutes: 1,
        spindle_rpm: 24000,
        feed_cut: 5500,
        feed_plunge: 550,
        layers: {},
      },
    }));
    setShowNewTool(false);
    setNewToolNumber("");
    setNewToolId("");
    setNewToolName("");
  }, [newToolNumber, newToolId, newToolName, localTools]);

  const handleDeleteTool = useCallback(
    (toolKey: string) => {
      setLocalTools((prev) => {
        const { [toolKey]: _, ...rest } = prev;
        return rest;
      });
      // Also remove from layer tool map
      setLocalLayerToolMap((prev) => {
        const updated = { ...prev };
        for (const [layer, tid] of Object.entries(updated)) {
          if (tid === toolKey) {
            delete updated[layer];
          }
        }
        return updated;
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!organizationId) return;
    const overrides = computeOverrides(localTools, TOOL_DEFAULTS);
    const customTools = getCustomToolsFromLocal(localTools);
    const layerToolMapOverrides = computeLayerToolMapOverrides(localLayerToolMap, LAYER_TOOL_MAP_DEFAULTS);
    setIsSaving(true);
    try {
      await upsertSettings({
        organizationId,
        toolOverrides: overrides,
        customTools: Object.keys(customTools).length > 0 ? customTools : undefined,
        layerToolMap: Object.keys(layerToolMapOverrides).length > 0 ? layerToolMapOverrides : undefined,
      });
      toast.success("CNC settings saved");
    } catch (e: any) {
      toast.error("Failed to save settings: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  }, [organizationId, localTools, localLayerToolMap, upsertSettings]);

  const handleReset = useCallback(async () => {
    if (!organizationId) return;
    setIsSaving(true);
    try {
      await resetSettings({ organizationId });
      setLocalTools(TOOL_DEFAULTS);
      setLocalLayerToolMap({ ...LAYER_TOOL_MAP_DEFAULTS });
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

  // Sort tool keys by pocket number, then by id for stable ordering
  const sortedToolKeys = Object.keys(localTools).sort((a, b) => {
    const numDiff = localTools[a].number - localTools[b].number;
    if (numDiff !== 0) return numDiff;
    return a.localeCompare(b);
  });

  return (
    <ScrollArea className="h-[520px] pr-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
              Tool Configuration
            </h3>
            <p className="text-[10px] text-slate-500 mt-1">
              Override default tool parameters or create custom tools. Changes apply to all future NC program generation.
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

        {/* ── Add New Tool ── */}
        {showNewTool ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
              New Custom Tool
            </h4>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
                Pocket #
              </label>
              <Input
                type="number"
                value={newToolNumber}
                onChange={(e) => setNewToolNumber(e.target.value)}
                className="h-7 w-24 rounded-md border border-amber-500/30 bg-background/50 px-2 text-xs font-mono text-right tabular-nums focus:border-amber-500"
                placeholder="7"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
                Tool ID
              </label>
              <Input
                value={newToolId}
                onChange={(e) => setNewToolId(e.target.value)}
                className="h-7 w-40 rounded-md border border-amber-500/30 bg-background/50 px-2 text-xs font-mono focus:border-amber-500"
                placeholder="e.g. end_mill_8mm"
              />
              {newToolId.trim() && newToolId.trim() in localTools && (
                <span className="text-[10px] text-red-400">ID already used</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider w-[100px] shrink-0">
                Display Name
              </label>
              <Input
                value={newToolName}
                onChange={(e) => setNewToolName(e.target.value)}
                className="h-7 w-40 rounded-md border border-amber-500/30 bg-background/50 px-2 text-xs font-mono focus:border-amber-500"
                placeholder="e.g. 8mm End Mill"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-black"
                onClick={handleAddTool}
                disabled={!newToolNumber || parseInt(newToolNumber) <= 0 || (newToolId.trim() !== "" && newToolId.trim() in localTools)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create T{newToolNumber || "?"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-slate-400 hover:text-white"
                onClick={() => {
                  setShowNewTool(false);
                  setNewToolNumber("");
                  setNewToolId("");
                  setNewToolName("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
            onClick={() => setShowNewTool(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Custom Tool
          </Button>
        )}

        {/* ── Tool sections ── */}
        {sortedToolKeys.map((toolKey) => {
          const config = localTools[toolKey];
          const isCustom = !(toolKey in TOOL_DEFAULTS);
          const defaultConfig = isCustom ? undefined : TOOL_DEFAULTS[toolKey];
          return (
            <ToolSection
              key={toolKey}
              toolKey={toolKey}
              config={config}
              defaultConfig={defaultConfig}
              isCustom={isCustom}
              onUpdateTool={(field, value) => handleUpdateTool(toolKey, field, value)}
              onUpdateLayer={(layer, field, value) => handleUpdateLayer(toolKey, layer, field, value)}
              onAddLayer={(layerName) => handleAddLayer(toolKey, layerName)}
              onRemoveLayer={(layerName) => handleRemoveLayer(toolKey, layerName)}
              onDeleteTool={() => handleDeleteTool(toolKey)}
            />
          );
        })}

        {/* ── Layer-Tool Mapping ── */}
        <Separator className="bg-white/5" />
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            Layer → Tool Assignment
          </h3>
          <p className="text-[10px] text-slate-500 mb-3">
            Assign which tool cuts each layer. Custom layers (like CUSTOM1) need a tool assignment to participate in CNC toolpath generation.
          </p>
          <div className="space-y-1.5">
            {Object.entries(localLayerToolMap)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([layer, toolId]) => {
                const isBuiltIn = layer in LAYER_TOOL_MAP_DEFAULTS;
                const tool = localTools[toolId];
                return (
                  <div
                    key={layer}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2",
                      isBuiltIn ? "border-white/5 bg-white/[0.02]" : "border-amber-500/20 bg-amber-500/[0.03]"
                    )}
                  >
                    <span
                      className="text-xs font-bold uppercase tracking-wider w-24 shrink-0"
                      style={{ color: getLayerColor(layer) }}
                    >
                      {layer}
                    </span>
                    <span className="text-[10px] text-slate-600">→</span>
                    <select
                      value={toolId}
                      onChange={(e) => {
                        const newToolId = e.target.value;
                        setLocalLayerToolMap((prev) => ({
                          ...prev,
                          [layer]: newToolId,
                        }));
                      }}
                      className="h-7 rounded-md border border-white/10 bg-background/50 px-2 text-xs font-mono"
                    >
                      {sortedToolKeys.map((tk) => {
                        const tc = localTools[tk];
                        return (
                          <option key={tk} value={tk}>
                            T{tc.number} — {tc.name}
                          </option>
                        );
                      })}
                    </select>
                    {!isBuiltIn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-slate-500 hover:text-red-400 ml-auto"
                        onClick={() => {
                          setLocalLayerToolMap((prev) => {
                            const { [layer]: _, ...rest } = prev;
                            return rest;
                          });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Add custom layer mapping */}
          <AddLayerMapping
            existingLayers={Object.keys(localLayerToolMap)}
            toolOptions={sortedToolKeys.map((tk) => ({ key: tk, number: localTools[tk].number, name: localTools[tk].name }))}
            onAdd={(layer, toolKey) => {
              setLocalLayerToolMap((prev) => ({
                ...prev,
                [layer]: toolKey,
              }));
            }}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

/** Component to add a new layer → tool mapping */
function AddLayerMapping({
  existingLayers,
  toolOptions,
  onAdd,
}: {
  existingLayers: string[];
  toolOptions: { key: string; number: number; name: string }[];
  onAdd: (layer: string, toolKey: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [layerName, setLayerName] = useState("");
  const [selectedToolKey, setSelectedToolKey] = useState(toolOptions[0]?.key ?? "prav");

  if (!adding) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 mt-2"
        onClick={() => setAdding(true)}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add Layer Mapping
      </Button>
    );
  }

  const isDuplicate = existingLayers.includes(layerName.toUpperCase().trim());

  return (
    <div className="flex items-center gap-2 mt-2 p-2 rounded-md border border-amber-500/20 bg-amber-500/[0.03]">
      <Input
        value={layerName}
        onChange={(e) => setLayerName(e.target.value.toUpperCase())}
        placeholder="LAYER_NAME"
        className="h-7 w-32 text-xs font-mono uppercase"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && layerName.trim() && !isDuplicate) {
            onAdd(layerName.trim(), selectedToolKey);
            setLayerName("");
            setAdding(false);
          }
          if (e.key === "Escape") {
            setAdding(false);
            setLayerName("");
          }
        }}
      />
      <span className="text-[10px] text-slate-600">→</span>
      <select
        value={selectedToolKey}
        onChange={(e) => setSelectedToolKey(e.target.value)}
        className="h-7 rounded-md border border-white/10 bg-background/50 px-2 text-xs font-mono"
      >
        {toolOptions.map((t) => (
          <option key={t.key} value={t.key}>
            T{t.number} — {t.name}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px] text-emerald-400 hover:text-emerald-300"
        onClick={() => {
          if (layerName.trim() && !isDuplicate) {
            onAdd(layerName.trim(), selectedToolKey);
            setLayerName("");
            setAdding(false);
          }
        }}
        disabled={!layerName.trim() || isDuplicate}
      >
        Add
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-[11px] text-slate-400 hover:text-white"
        onClick={() => {
          setAdding(false);
          setLayerName("");
        }}
      >
        Cancel
      </Button>
      {isDuplicate && layerName && (
        <span className="text-[10px] text-red-400">Already mapped</span>
      )}
    </div>
  );
}

