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
  [LAYER_SHEETS]: 7,   // white/black
  [LAYER_CUT]: 1,      // red
  [LAYER_ZERO]: 7,     // white/black
  [LAYER_FREZ]: 6,     // magenta
  [LAYER_FREZ_135]: 4, // cyan
  [LAYER_HOLES]: 5,    // blue
};

// ── Canvas Rendering Colors (CSS) ──────────────────────────────────────────

export const CANVAS_COLORS: Record<string, string> = {
  [LAYER_CUT]: "#ef4444",      // red-500
  [LAYER_FREZ]: "#d946ef",    // fuchsia-500
  [LAYER_FREZ_135]: "#22d3ee", // cyan-400
  [LAYER_HOLES]: "#3b82f6",   // blue-500
  [LAYER_ZERO]: "#ffffff",    // white
  [LAYER_SHEETS]: "#9ca3af", // gray-400
  sheetFill: "#1e293b",       // slate-800
  marginFill: "#334155",     // slate-700
  highlight: "#22c55e",      // green-500
  label: "#fbbf24",          // amber-400
};

// ── Default New Job Name ──────────────────────────────────────────────────

export const DEFAULT_JOB_NAME = "Untitled Nesting Job";