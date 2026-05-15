// src/features/cnc-pipeline/tool-defaults.ts
// TypeScript mirror of the Python TOOLS dict in cnc_pipeline/config.py
// Used by the frontend to know what fields exist and what the defaults are.
//
// Tools are uniquely identified by their `id` string (e.g. "prav", "trapec_105").
// The `number` field is the CNC pocket number — multiple tools CAN share the same
// pocket number (they represent different physical tools loaded at different times).

export interface LayerConfig {
  depth: number;
  offset: number;
}

export interface ToolConfig {
  id: string;
  name: string;
  number: number;
  diameter: number;
  gauge_length: number;
  flutes: number;
  spindle_rpm: number;
  feed_cut: number;
  feed_plunge: number;
  tip_radius?: number;
  taper_angle?: number;
  taper_height?: number;
  layers: Record<string, LayerConfig>;
}

/** Hardcoded defaults — keyed by unique tool `id`. Must stay in sync with cnc_pipeline/config.py. */
export const TOOL_DEFAULTS: Record<string, ToolConfig> = {
  prav: {
    id: "prav",
    name: "End Mill",
    number: 7,
    diameter: 6.0,
    gauge_length: 25.0,
    flutes: 1,
    spindle_rpm: 24000,
    feed_cut: 5500,
    feed_plunge: 550,
    layers: {
      CUT: { depth: -4.1, offset: 3.0 },
      HOLES: { depth: -4.11, offset: 0.0 },
    },
  },
  trapec_105: {
    id: "trapec_105",
    name: "Tapered Tipped",
    number: 9,
    diameter: 13.0,
    tip_radius: 0.0,
    taper_angle: 47.5,
    taper_height: 3.15,
    gauge_length: 50.0,
    flutes: 4,
    spindle_rpm: 13000,
    feed_cut: 5500,
    feed_plunge: 550,
    layers: {
      FREZ: { depth: -3.0, offset: 0.0 },
    },
  },
  trapec_135: {
    id: "trapec_135",
    name: "Tapered Tipped",
    number: 11,
    diameter: 13.0,
    tip_radius: 0.0,
    taper_angle: 47.5,
    taper_height: 3.15,
    gauge_length: 50.0,
    flutes: 4,
    spindle_rpm: 13000,
    feed_cut: 5500,
    feed_plunge: 550,
    layers: {
      FREZ_135: { depth: -3.0, offset: 0.0 },
    },
  },
};

/** Tool-level numeric fields that can be overridden */
export const TOOL_NUMERIC_FIELDS = [
  "diameter",
  "gauge_length",
  "flutes",
  "spindle_rpm",
  "feed_cut",
  "feed_plunge",
] as const;

/** Optional numeric fields (for tapered tools) */
export const TOOL_OPTIONAL_FIELDS = [
  "tip_radius",
  "taper_angle",
  "taper_height",
] as const;

/** Layer-level numeric fields that can be overridden */
export const LAYER_NUMERIC_FIELDS = ["depth", "offset"] as const;

/** Default layer config for new layers */
export const DEFAULT_LAYER_CONFIG: LayerConfig = { depth: -3.0, offset: 0.0 };

/** Default values for a new custom tool */
export const DEFAULT_NEW_TOOL: Omit<ToolConfig, "number" | "id" | "name" | "layers"> & { id: string; name: string } = {
  id: "",
  name: "",
  diameter: 6.0,
  gauge_length: 25.0,
  flutes: 1,
  spindle_rpm: 24000,
  feed_cut: 5500,
  feed_plunge: 550,
};

/** Fixed default layer → tool assignment (keyed by tool `id`) */
export const LAYER_TOOL_MAP_DEFAULTS: Record<string, string> = {
  CUT: "prav",
  HOLES: "prav",
  FREZ: "trapec_105",
  FREZ_135: "trapec_135",
};

// ── Migration helpers (old number-keyed → new id-keyed) ──────────────────────

/** Migrate an old number-keyed override/customTool key to the new id-based key. */
function migrateKey(key: string, defaults: Record<string, ToolConfig>): string {
  // Already a valid id in defaults
  if (key in defaults) return key;
  // Try to match by pocket number
  const num = Number(key);
  if (!isNaN(num)) {
    const match = Object.entries(defaults).find(([, t]) => t.number === num);
    if (match) return match[0];
  }
  return key;
}

// ── Resolved tools and overrides ────────────────────────────────────────────

/**
 * Deep-merge sparse overrides onto the hardcoded defaults, plus add custom tools.
 * - For built-in tools: merge overrides onto defaults
 * - For custom tools: use the full tool definition from customTools (or overrides)
 * - For layer configs: allow custom layers to be added (not just existing ones)
 *
 * Handles migration from old number-keyed format to new id-keyed format.
 * Returns a new object (does not mutate defaults).
 */
export function resolveTools(
  defaults: Record<string, ToolConfig>,
  overrides: Record<string, any> | null | undefined,
  customTools?: Record<string, ToolConfig> | null,
): Record<string, ToolConfig> {
  const result: Record<string, ToolConfig> = {};

  // Migrate old number-keyed overrides to id-keyed
  const migratedOverrides: Record<string, any> = {};
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      const newKey = migrateKey(key, defaults);
      // If the new key already exists (e.g. two old number keys mapping to same id),
      // merge the overrides
      if (newKey in migratedOverrides && typeof migratedOverrides[newKey] === "object" && typeof val === "object") {
        migratedOverrides[newKey] = { ...migratedOverrides[newKey], ...val };
      } else {
        migratedOverrides[newKey] = val;
      }
    }
  }

  // Migrate old number-keyed custom tools to id-keyed
  const migratedCustomTools: Record<string, ToolConfig> = {};
  if (customTools) {
    for (const [key, val] of Object.entries(customTools)) {
      const newKey = val.id || migrateKey(key, defaults);
      // Skip if this is actually a built-in tool (shouldn't be in customTools)
      if (newKey in defaults) continue;
      migratedCustomTools[newKey] = val;
    }
  }

  // 1. Merge built-in tools with overrides
  for (const [toolId, base] of Object.entries(defaults)) {
    const toolOverride = migratedOverrides[toolId];

    if (!toolOverride || typeof toolOverride !== "object") {
      result[toolId] = { ...base, layers: { ...base.layers } };
      continue;
    }

    const merged = { ...base };

    // Merge top-level numeric fields
    for (const field of TOOL_NUMERIC_FIELDS) {
      if (field in toolOverride && typeof toolOverride[field] === "number") {
        (merged as any)[field] = toolOverride[field];
      }
    }
    // Merge optional numeric fields
    for (const field of TOOL_OPTIONAL_FIELDS) {
      if (field in toolOverride && typeof toolOverride[field] === "number") {
        (merged as any)[field] = toolOverride[field];
      }
    }

    // Merge layers — SUPPORT custom layers on built-in tools
    const mergedLayers: Record<string, LayerConfig> = { ...base.layers };
    // Copy existing layers with overrides
    for (const layerName of Object.keys(base.layers)) {
      if (mergedLayers[layerName]) {
        mergedLayers[layerName] = { ...mergedLayers[layerName] };
      }
    }
    if (toolOverride.layers && typeof toolOverride.layers === "object") {
      for (const layerName of Object.keys(toolOverride.layers)) {
        const layerOverride = toolOverride.layers[layerName];
        if (!layerOverride || typeof layerOverride !== "object") continue;
        const baseLayer = base.layers[layerName];
        if (baseLayer) {
          // Override existing layer
          const ml = { ...baseLayer };
          for (const field of LAYER_NUMERIC_FIELDS) {
            if (field in layerOverride && typeof layerOverride[field] === "number") {
              (ml as any)[field] = layerOverride[field];
            }
          }
          mergedLayers[layerName] = ml;
        } else {
          // New custom layer on built-in tool (e.g. CUSTOM1 on T7)
          const newLayer: LayerConfig = { ...DEFAULT_LAYER_CONFIG };
          for (const field of LAYER_NUMERIC_FIELDS) {
            if (field in layerOverride && typeof layerOverride[field] === "number") {
              (newLayer as any)[field] = layerOverride[field];
            }
          }
          mergedLayers[layerName] = newLayer;
        }
      }
    }
    merged.layers = mergedLayers;

    result[toolId] = merged;
  }

  // 2. Add custom tools (tools that are not in defaults)
  for (const [toolId, ct] of Object.entries(migratedCustomTools)) {
    if (toolId in result) continue; // don't overwrite built-in tools
    // Apply overrides if they exist for this custom tool key
    const toolOverride = migratedOverrides[toolId];
    if (toolOverride && typeof toolOverride === "object") {
      const merged = { ...ct, layers: { ...ct.layers } };
      for (const field of TOOL_NUMERIC_FIELDS) {
        if (field in toolOverride && typeof toolOverride[field] === "number") {
          (merged as any)[field] = toolOverride[field];
        }
      }
      for (const field of TOOL_OPTIONAL_FIELDS) {
        if (field in toolOverride && typeof toolOverride[field] === "number") {
          (merged as any)[field] = toolOverride[field];
        }
      }
      // Merge layers
      if (toolOverride.layers && typeof toolOverride.layers === "object") {
        for (const layerName of Object.keys(toolOverride.layers)) {
          const layerOverride = toolOverride.layers[layerName];
          if (!layerOverride || typeof layerOverride !== "object") continue;
          const baseLayer = ct.layers[layerName];
          if (baseLayer) {
            const ml = { ...baseLayer };
            for (const field of LAYER_NUMERIC_FIELDS) {
              if (field in layerOverride && typeof layerOverride[field] === "number") {
                (ml as any)[field] = layerOverride[field];
              }
            }
            merged.layers[layerName] = ml;
          } else {
            const newLayer: LayerConfig = { ...DEFAULT_LAYER_CONFIG };
            for (const field of LAYER_NUMERIC_FIELDS) {
              if (field in layerOverride && typeof layerOverride[field] === "number") {
                (newLayer as any)[field] = layerOverride[field];
              }
            }
            merged.layers[layerName] = newLayer;
          }
        }
      }
      result[toolId] = merged;
    } else {
      result[toolId] = { ...ct, layers: { ...ct.layers } };
    }
  }

  // 3. Also check overrides for any keys that aren't in defaults or migratedCustomTools
  //    (handles cases where overrides contain full tool defs for unknown tools)
  for (const [toolId, toolOverride] of Object.entries(migratedOverrides)) {
    if (toolId in result) continue;
    if (toolOverride && typeof toolOverride === "object" && toolOverride.number !== undefined) {
      // This is a full custom tool definition stored as an override
      result[toolId] = toolOverride as ToolConfig;
    }
  }

  return result;
}

/**
 * Resolve the full layer → tool map, merging defaults with custom overrides.
 * Handles migration from old number-valued format to new id-valued format.
 */
export function resolveLayerToolMap(
  defaults: Record<string, string>,
  customMap: Record<string, number | string> | null | undefined,
  allTools?: Record<string, ToolConfig> | null,
): Record<string, string> {
  const result: Record<string, string> = { ...defaults };
  if (customMap) {
    for (const [layer, toolRef] of Object.entries(customMap)) {
      if (typeof toolRef === "string") {
        // New format or already a string id
        result[layer] = toolRef;
      } else if (typeof toolRef === "number") {
        // Old format: tool number → migrate to id
        if (allTools) {
          const match = Object.entries(allTools).find(([, t]) => t.number === toolRef);
          result[layer] = match ? match[0] : String(toolRef);
        } else {
          // Fallback: check defaults for matching number
          const match = Object.entries(defaults).find(([, id]) => {
            // Can't resolve without allTools — try defaults tool lookup
            return false;
          });
          result[layer] = String(toolRef);
        }
      }
    }
  }
  return result;
}

/**
 * Compare a resolved tool against defaults to find which fields differ.
 * Returns a sparse overrides object suitable for saving to Convex.
 * For built-in tools: only saves changed fields (sparse override).
 * For custom tools: saves the entire tool definition.
 */
export function computeOverrides(
  resolved: Record<string, ToolConfig>,
  defaults: Record<string, ToolConfig>,
): Record<string, any> {
  const overrides: Record<string, any> = {};

  for (const toolId of Object.keys(resolved)) {
    const current = resolved[toolId];
    if (!current) continue;

    const base = defaults[toolId];

    // Custom tool — save the full definition
    if (!base) {
      overrides[toolId] = { ...current, layers: { ...current.layers } };
      continue;
    }

    // Built-in tool — compute sparse diff
    const toolDiff: Record<string, any> = {};
    let toolChanged = false;

    for (const field of TOOL_NUMERIC_FIELDS) {
      if ((current as any)[field] !== (base as any)[field]) {
        toolDiff[field] = (current as any)[field];
        toolChanged = true;
      }
    }
    for (const field of TOOL_OPTIONAL_FIELDS) {
      const currentVal = (current as any)[field];
      const baseVal = (base as any)[field];
      if (currentVal !== baseVal) {
        toolDiff[field] = currentVal;
        toolChanged = true;
      }
    }

    // Check layers — including NEW layers not in defaults
    const allLayerNames = new Set([...Object.keys(base.layers), ...Object.keys(current.layers)]);
    for (const layerName of allLayerNames) {
      const baseLayer = base.layers[layerName];
      const currentLayer = current.layers[layerName];

      if (!baseLayer && currentLayer) {
        // New custom layer on built-in tool
        const layerDiff: Record<string, any> = {};
        for (const field of LAYER_NUMERIC_FIELDS) {
          layerDiff[field] = (currentLayer as any)[field];
        }
        if (!toolDiff.layers) toolDiff.layers = {};
        toolDiff.layers[layerName] = layerDiff;
        toolChanged = true;
      } else if (baseLayer && currentLayer) {
        // Existing layer — check for diffs
        const layerDiff: Record<string, any> = {};
        let layerChanged = false;
        for (const field of LAYER_NUMERIC_FIELDS) {
          if ((currentLayer as any)[field] !== (baseLayer as any)[field]) {
            layerDiff[field] = (currentLayer as any)[field];
            layerChanged = true;
          }
        }
        if (layerChanged) {
          if (!toolDiff.layers) toolDiff.layers = {};
          toolDiff.layers[layerName] = layerDiff;
          toolChanged = true;
        }
      }
    }

    if (toolChanged) {
      overrides[toolId] = toolDiff;
    }
  }

  return overrides;
}

/**
 * Compute the custom layer-tool map by comparing resolved against defaults.
 * Returns only entries that differ from or are not in the defaults.
 */
export function computeLayerToolMapOverrides(
  resolved: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [layer, toolId] of Object.entries(resolved)) {
    if (defaults[layer] !== toolId) {
      overrides[layer] = toolId;
    }
  }
  return overrides;
}

// ── Layer Sequence Configuration ────────────────────────────────────────────────

/** Frontend mirror of Python SCENARIOS dict in cnc_pipeline/config.py */
export const SCENARIOS: Record<string, [string, string][]> = {
  most_common: [
    ["FREZ", "trapec_105"],
    ["CUT", "prav"],
  ],
  common: [
    ["HOLES", "prav"],
    ["FREZ", "trapec_105"],
    ["CUT", "prav"],
  ],
  rare: [
    ["FREZ", "trapec_105"],
    ["FREZ_135", "trapec_135"],
    ["CUT", "prav"],
  ],
  very_rare: [
    ["HOLES", "prav"],
    ["FREZ", "trapec_105"],
    ["FREZ_135", "trapec_135"],
    ["CUT", "prav"],
  ],
  cut_only: [
    ["CUT", "prav"],
  ],
  custom: [], // Fully custom — populated from layer-tool map + detected layers
};

/** Built-in CNC layer names */
export const BUILTIN_CNC_LAYERS = ["HOLES", "FREZ", "FREZ_135", "CUT"] as const;

/**
 * Given a detected scenario, the set of layers detected in the DXF,
 * and the resolved layer-tool map, derive the default layer sequence.
 * Returns [layerName, toolId][] using tool ids (not numbers).
 */
export function deriveDefaultSequence(
  scenario: string,
  detectedLayers: string[],
  layerToolMap?: Record<string, string>,
): [string, string][] {
  const resolvedMap = layerToolMap
    ? { ...LAYER_TOOL_MAP_DEFAULTS, ...layerToolMap }
    : { ...LAYER_TOOL_MAP_DEFAULTS };

  if (scenario === "custom") {
    const detected = new Set(detectedLayers);
    const result: [string, string][] = [];
    const builtInOrder = ["HOLES", "FREZ", "FREZ_135", "CUT"];
    for (const layer of builtInOrder) {
      if (detected.has(layer) && resolvedMap[layer] !== undefined) {
        result.push([layer, resolvedMap[layer]]);
      }
    }
    for (const layer of detectedLayers) {
      if (!builtInOrder.includes(layer) && resolvedMap[layer] !== undefined) {
        result.push([layer, resolvedMap[layer]]);
      }
    }
    return result;
  }

  const scenarioSeq = SCENARIOS[scenario];
  if (!scenarioSeq) return [];

  const detected = new Set(detectedLayers);
  const result: [string, string][] = [];

  // First add layers from the scenario that are detected
  for (const [layer, defaultToolId] of scenarioSeq) {
    if (detected.has(layer)) {
      const toolId = resolvedMap[layer] ?? defaultToolId;
      result.push([layer, toolId]);
    }
  }

  // Then add any detected CNC layers not yet in the sequence
  const assigned = new Set(result.map(([l]) => l));
  for (const layer of detectedLayers) {
    if (assigned.has(layer)) continue;
    if (resolvedMap[layer] !== undefined) {
      result.push([layer, resolvedMap[layer]]);
    }
  }

  return result;
}

/**
 * Build the full set of available tools (for dropdown selectors).
 * Combines built-in and custom tools, sorted by pocket number.
 */
export function getAvailableTools(
  defaults: Record<string, ToolConfig>,
  overrides: Record<string, any> | null | undefined,
  customTools?: Record<string, ToolConfig> | null,
): { key: string; number: number; name: string; id: string }[] {
  const resolved = resolveTools(defaults, overrides, customTools);
  return Object.entries(resolved)
    .sort(([, a], [, b]) => a.number - b.number)
    .map(([key, config]) => ({
      key,
      number: config.number,
      name: config.name,
      id: config.id,
    }));
}
