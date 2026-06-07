// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Constants
// All magic numbers in one place. Must match the Python autopacker config.
// ────────────────────────────────────────────────────────────────────────────────

/** Physical sheet width in mm */
export const SHEET_WIDTH = 1250;

/** Physical sheet height in mm */
export const SHEET_HEIGHT = 3200;

/** Standard margin for Mode A packing in mm */
export const MARGIN = 35;

/** Layout utilization threshold below which Mode B sheets use bottom-left
 *  alignment instead of centering. Expressed as a percentage (0–100). */
export const BOTTOM_LEFT_THRESHOLD = 70;

/** Usable area width in Mode A (sheet - 2×margin) */
export const USABLE_WIDTH = SHEET_WIDTH - 2 * MARGIN; // 1180

/** Usable area height in Mode A (sheet - 2×margin) */
export const USABLE_HEIGHT = SHEET_HEIGHT - 2 * MARGIN; // 3130

/** CNC tool / CUT layer offset outward from Layer 0 on all sides */
export const CUT_OFFSET = 3;

/** Deduplication tolerance in mm — segments closer than this are coincident */
export const COINCIDENCE_TOL = 0.01;

/** Maximum number of bins (sheets) the packer may open */
export const MAX_SHEETS = 200;

/** Maximum number of part instances before we warn about performance */
export const MAX_PART_INSTANCES = 500;

// ── DXF Layer Configuration ────────────────────────────────────────────────

export const LAYER_CUT = "CUT";
export const LAYER_ZERO = "0";
export const LAYER_FREZ = "FREZ";
export const LAYER_FREZ_135 = "FREZ_135";
export const LAYER_HOLES = "HOLES";
export const LAYER_SHEETS = "SHEETS";

/** All layers that are NOT CUT — these go through block inserts unmodified */
export const NON_CUT_LAYERS = [LAYER_ZERO, LAYER_FREZ, LAYER_FREZ_135, LAYER_HOLES] as const;

/** ACI color codes for DXF output */
export const LAYER_COLORS: Record<string, number> = {
  [LAYER_SHEETS]: 4,      // cyan (close ACI; true color override applied for exact RGB)
  [LAYER_CUT]: 3,         // green
  [LAYER_ZERO]: 7,        // white/black
  [LAYER_FREZ]: 6,        // magenta
  [LAYER_FREZ_135]: 1,    // red
  [LAYER_HOLES]: 2,       // yellow
};

/** Default ACI color for layers not in LAYER_COLORS (orange) */
export const DEFAULT_LAYER_ACI_COLOR = 30;

// ── Canvas Rendering Colors (CSS) ──────────────────────────────────────────

export const CANVAS_COLORS: Record<string, string> = {
  [LAYER_CUT]: "#22c55e",          // green-500
  [LAYER_FREZ]: "#d946ef",        // fuchsia-500 (magenta)
  [LAYER_FREZ_135]: "#ef4444",    // red-500
  [LAYER_HOLES]: "#eab308",       // yellow-500
  [LAYER_ZERO]: "#ffffff",        // white
  [LAYER_SHEETS]: "rgb(39,118,187)", // dark cyan (exact RGB 39,118,187)
  sheetFill: "#1e293b",           // slate-800
  marginFill: "#334155",         // slate-700
  highlight: "#22c55e",          // green-500
  label: "#fbbf24",              // amber-400
  _default: "#f97316",           // orange-500 (for any unknown/custom layer)
};

/** Get the ACI color code for a given layer name */
export function getAciColor(layer: string): number {
  if (layer in LAYER_COLORS) return LAYER_COLORS[layer];
  if (layer === "DEFPOINTS" || layer === "") return 7;
  return DEFAULT_LAYER_ACI_COLOR; // orange for unknown/custom layers
}

/** Get the canvas CSS color for a given layer name */
export function getCanvasColor(layer: string): string {
  if (layer in CANVAS_COLORS) return CANVAS_COLORS[layer];
  return CANVAS_COLORS._default; // orange for unknown/custom layers
}

// ── Default New Job Name ──────────────────────────────────────────────────

export const DEFAULT_JOB_NAME = "Untitled Nesting Job";