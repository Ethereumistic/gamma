// src/features/cnc-pipeline/tool-defaults.ts
// TypeScript mirror of the Python TOOLS dict in cnc_pipeline/config.py
// Used by the frontend to know what fields exist and what the defaults are.

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

/** Hardcoded defaults — must stay in sync with cnc_pipeline/config.py */
export const TOOL_DEFAULTS: Record<number, ToolConfig> = {
  7: {
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
  9: {
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
  11: {
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

/** Layer-level numeric fields that can be overridden */
export const LAYER_NUMERIC_FIELDS = ["depth", "offset"] as const;

/**
 * Deep-merge sparse overrides onto the hardcoded defaults.
 * Only overrides that are plain numbers get applied — everything else is ignored.
 * Returns a new object (does not mutate defaults).
 */
export function resolveTools(
  defaults: Record<number, ToolConfig>,
  overrides: Record<string, any> | null | undefined,
): Record<number, ToolConfig> {
  if (!overrides || Object.keys(overrides).length === 0) return defaults;

  const result: Record<number, ToolConfig> = {};

  for (const toolNum of Object.keys(defaults)) {
    const num = Number(toolNum);
    const base = defaults[num];
    const toolOverride = overrides[toolNum];

    if (!toolOverride || typeof toolOverride !== "object") {
      result[num] = base;
      continue;
    }

    const merged = { ...base };

    // Merge top-level numeric fields
    for (const field of TOOL_NUMERIC_FIELDS) {
      if (field in toolOverride && typeof toolOverride[field] === "number") {
        (merged as any)[field] = toolOverride[field];
      }
    }

    // Merge layers
    if (toolOverride.layers && typeof toolOverride.layers === "object") {
      const mergedLayers: Record<string, LayerConfig> = { ...base.layers };
      for (const layerName of Object.keys(toolOverride.layers)) {
        const layerOverride = toolOverride.layers[layerName];
        if (!layerOverride || typeof layerOverride !== "object") continue;
        const baseLayer = base.layers[layerName];
        if (!baseLayer) continue; // don't create layers that don't exist in defaults
        const mergedLayer = { ...baseLayer };
        for (const field of LAYER_NUMERIC_FIELDS) {
          if (field in layerOverride && typeof layerOverride[field] === "number") {
            (mergedLayer as any)[field] = layerOverride[field];
          }
        }
        mergedLayers[layerName] = mergedLayer;
      }
      merged.layers = mergedLayers;
    }

    result[num] = merged;
  }

  return result;
}

/**
 * Compare a resolved tool against defaults to find which fields differ.
 * Returns a sparse overrides object suitable for saving to Convex.
 */
export function computeOverrides(
  resolved: Record<number, ToolConfig>,
  defaults: Record<number, ToolConfig>,
): Record<string, any> {
  const overrides: Record<string, any> = {};

  for (const toolNum of Object.keys(defaults)) {
    const num = Number(toolNum);
    const base = defaults[num];
    const current = resolved[num];
    if (!current) continue;

    const toolDiff: Record<string, any> = {};
    let toolChanged = false;

    for (const field of TOOL_NUMERIC_FIELDS) {
      if ((current as any)[field] !== (base as any)[field]) {
        toolDiff[field] = (current as any)[field];
        toolChanged = true;
      }
    }

    // Check layers
    for (const layerName of Object.keys(base.layers)) {
      const baseLayer = base.layers[layerName];
      const currentLayer = current.layers[layerName];
      if (!currentLayer) continue;

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

    if (toolChanged) {
      overrides[toolNum] = toolDiff;
    }
  }

  return overrides;
}

// ── Layer Sequence Configuration ────────────────────────────────────────────────

/** Frontend mirror of Python SCENARIOS dict in cnc_pipeline/config.py */
export const SCENARIOS: Record<string, [string, number][]> = {
  most_common: [
    ["FREZ", 9],
    ["CUT", 7],
  ],
  common: [
    ["HOLES", 7],
    ["FREZ", 9],
    ["CUT", 7],
  ],
  rare: [
    ["FREZ", 9],
    ["FREZ_135", 11],
    ["CUT", 7],
  ],
  very_rare: [
    ["HOLES", 7],
    ["FREZ", 9],
    ["FREZ_135", 11],
    ["CUT", 7],
  ],
  cut_only: [
    ["CUT", 7],
  ],
};

/** Fixed layer → tool assignment (frontend mirror of config.LAYER_TOOL_MAP) */
export const LAYER_TOOL_MAP: Record<string, number> = {
  CUT: 7,
  HOLES: 7,
  FREZ: 9,
  FREZ_135: 11,
};

/** CNC layers that participate in toolpath generation (orderable) */
export const CNC_LAYERS = ["HOLES", "FREZ", "FREZ_135", "CUT"] as const;
export type CNCLayer = (typeof CNC_LAYERS)[number];

/**
 * Given a detected scenario and the set of layers detected in the DXF,
 * derive the default layer sequence as an array of [layer, toolNumber] tuples.
 * Only includes layers that are present in `detectedLayers`.
 */
export function deriveDefaultSequence(
  scenario: string,
  detectedLayers: string[],
): [string, number][] {
  const scenarioSeq = SCENARIOS[scenario];
  if (!scenarioSeq) return [];

  const detected = new Set(detectedLayers);
  return scenarioSeq.filter(([layer]) => detected.has(layer));
}
