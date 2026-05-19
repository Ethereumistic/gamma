// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Core Types
// ────────────────────────────────────────────────────────────────────────────────

import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  MARGIN,
  USABLE_WIDTH,
  USABLE_HEIGHT,
  CUT_OFFSET,
  COINCIDENCE_TOL,
  MAX_SHEETS,
  DEFAULT_JOB_NAME,
} from "./constants";

// ── Direction & Rotation ──────────────────────────────────────────────────

export type PartDirection = "T" | "B" | "L" | "R" | null;
export type RotationDeg = 0 | 90;
export type PackingMode = "A" | "B";

// ── Geometric Primitives ──────────────────────────────────────────────────

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

// ── Part (Input) ──────────────────────────────────────────────────────────

export type PartSource = "sheet-metal" | "custom-dxf";

export type NestPart = {
  id: string;
  name: string;
  filename: string;
  direction: PartDirection;
  count: number;
  rotationLocked: boolean;
  allowedRotation: RotationDeg | -1; // 0=upright, 90=rotated, -1=both

  // Layer 0 bounding box dimensions
  l0Width: number;
  l0Height: number;

  // CUT layer dimensions (l0 + 2 * CUT_OFFSET on each axis)
  cutWidth: number;
  cutHeight: number;

  source: PartSource;

  // Parsed geometry — populated by the DXF reader
  cutLines: Segment[];
  l0Bbox: Rect;

  // Raw DXF string for custom imports (used when writing output)
  dxfContent?: string;

  // Link to Convex design (for sheet-metal sourced parts)
  designId?: string;

  // Block definition content for DXF output (non-CUT layers, to be inserted via block insert)
  blockDxfContent?: string;
};

// ── Placement (a single part instance on a sheet) ─────────────────────────

export type Placement = {
  partId: string;
  instanceIndex: number;

  // Position in PACKING space
  packX: number;
  packY: number;

  // Dimensions in packing space (may be swapped if rotated)
  packWidth: number;
  packHeight: number;

  rotation: RotationDeg;
};

// ── Sheet Layout (Output) ─────────────────────────────────────────────────

export type SheetLayout = {
  id: string;
  sheetIndex: number;
  mode: PackingMode;
  placements: Placement[];
  repeatCount: number;
  sheetName: string;

  // Offset from packing → sheet space
  offsetX: number;
  offsetY: number;

  // Deduplicated CUT segments (populated after dedup step)
  dedupedCutSegments: Segment[];
};

// ── Nest Job (Top-Level Aggregate) ────────────────────────────────────────

export type NestJobStatus = "idle" | "packing" | "done" | "error";

export type NestJob = {
  id: string;
  name: string;
  parts: NestPart[];
  layouts: SheetLayout[];
  mode: PackingMode;
  status: NestJobStatus;
  warnings: string[];
  totalSheetsToCut: number;
  createdAt: number;
  updatedAt: number;
};

// ── Packer Internal Types ──────────────────────────────────────────────────

export type PackItem = {
  rid: string; // unique: "{partId}_{instanceIndex}"
  partId: string;
  partName: string;
  instanceIndex: number;
  w: number; // width in packing space (possibly swapped)
  h: number; // height in packing space (possibly swapped)
  rotated: boolean; // true if pre-rotated 90° before packing
  partData: NestPart; // reference back to the original part
};

export type FreeRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PackResult = {
  x: number;
  y: number;
  width: number;
  height: number;
  rid: string;
  rotated: boolean; // true if the packer swapped w↔h for this item
};

export type PackedBin = {
  binIndex: number;
  rects: PackResult[];
};

// ── Filename Parser ────────────────────────────────────────────────────────
//
// Supported patterns (fallthrough — most specific first):
//   <name>_<DIR>_x<count>.dxf   →  1335_B_x50  → { name:"1335", dir:"B", count:50 }
//   <name>_x<count>.dxf        →  corner_x8     → { name:"corner", dir:"T", count:8 }
//   <name>_<DIR>.dxf            →  panel_R       → { name:"panel", dir:"R", count:1 }
//   <anything>.dxf              →  test-0        → { name:"test-0", dir:"T", count:1 }
//
// When direction is not specified, default is "T" (top, upright).
// When count is not specified, default is 1.

const DIRECTION_VALUES = new Set(["T", "B", "L", "R", "t", "b", "l", "r"]);

const FILENAME_RE_WITH_DIR_AND_COUNT = /^(.+?)_([TBLRtblr])_[xX](\d+)$/;
const FILENAME_RE_COUNT_ONLY = /^(.+?)_[xX](\d+)$/;
const FILENAME_RE_DIR_ONLY = /^(.+?)_([TBLRtblr])$/;

export type ParsedFilename = {
  name: string;
  direction: PartDirection;
  count: number;
};

export function parseFilename(filename: string): ParsedFilename {
  // Remove extension
  const stem = filename.replace(/\.[^.]+$/, "");

  // Pattern 1: <name>_<DIR>_x<count>  e.g. "1335_B_x50"
  const withDirAndCount = FILENAME_RE_WITH_DIR_AND_COUNT.exec(stem);
  if (withDirAndCount) {
    return {
      name: withDirAndCount[1],
      direction: withDirAndCount[2].toUpperCase() as "T" | "B" | "L" | "R",
      count: parseInt(withDirAndCount[3], 10),
    };
  }

  // Pattern 2: <name>_x<count>  e.g. "corner_x8"
  const countOnly = FILENAME_RE_COUNT_ONLY.exec(stem);
  if (countOnly) {
    return {
      name: countOnly[1],
      direction: "T", // default: upright
      count: parseInt(countOnly[2], 10),
    };
  }

  // Pattern 3: <name>_<DIR>  e.g. "panel_R"
  const dirOnly = FILENAME_RE_DIR_ONLY.exec(stem);
  if (dirOnly) {
    return {
      name: dirOnly[1],
      direction: dirOnly[2].toUpperCase() as "T" | "B" | "L" | "R",
      count: 1,
    };
  }

  // Fallback: any filename at all — use the whole stem as name, default T, count 1
  return {
    name: stem,
    direction: "T", // default: upright
    count: 1,
  };
}

// ── Direction → Rotation Mapping ────────────────────────────────────────────

export function directionToRotation(direction: PartDirection): RotationDeg | -1 {
  if (direction === null) return -1;
  if (direction === "T" || direction === "B") return 0;
  if (direction === "L" || direction === "R") return 90;
  return -1;
}

export function isRotationLocked(direction: PartDirection): boolean {
  return direction !== null;
}

// ── CUT Bbox Calculation ──────────────────────────────────────────────────

export function computeCutDimensions(l0Width: number, l0Height: number): { cutWidth: number; cutHeight: number } {
  return {
    cutWidth: l0Width + 2 * CUT_OFFSET,
    cutHeight: l0Height + 2 * CUT_OFFSET,
  };
}

// ── Packing Mode Detection ─────────────────────────────────────────────────

export function detectPackingMode(parts: NestPart[]): PackingMode {
  // Mode B triggers when:
  // 1. Any single part's CUT width > USABLE_WIDTH
  // 2. Any single part's CUT height > USABLE_HEIGHT
  // 3. Any two parts' CUT widths sum > USABLE_WIDTH  (can't fit side-by-side in margin mode)
  // 4. Any two parts' CUT heights sum > USABLE_HEIGHT (can't fit top-to-bottom in margin mode)

  for (const p of parts) {
    if (p.cutWidth > USABLE_WIDTH) return "B";
    if (p.cutHeight > USABLE_HEIGHT) return "B";
  }

  // Check pairs — only if few enough parts (realistic facade work is < 20 part types)
  if (parts.length <= 100) {
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].cutWidth + parts[j].cutWidth > USABLE_WIDTH) return "B";
        if (parts[i].cutHeight + parts[j].cutHeight > USABLE_HEIGHT) return "B";
      }
    }
  }

  return "A";
}

// ── Create Empty Job ────────────────────────────────────────────────────────

let idCounter = Date.now();

export function createEmptyNestJob(): NestJob {
  return {
    id: `nest-${++idCounter}`,
    name: DEFAULT_JOB_NAME,
    parts: [],
    layouts: [],
    mode: "A",
    status: "idle",
    warnings: [],
    totalSheetsToCut: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Create NestPart Helper ─────────────────────────────────────────────────

export function createNestPart(overrides: Partial<NestPart> & { name: string; id?: string }): NestPart {
  const id = overrides.id ?? `part-${++idCounter}`;
  const direction = overrides.direction ?? null;
  const l0Width = overrides.l0Width ?? 0;
  const l0Height = overrides.l0Height ?? 0;
  const { cutWidth, cutHeight } = computeCutDimensions(l0Width, l0Height);

  return {
    id,
    name: overrides.name,
    filename: overrides.filename ?? overrides.name,
    direction,
    count: overrides.count ?? 1,
    rotationLocked: isRotationLocked(direction),
    allowedRotation: directionToRotation(direction),
    l0Width,
    l0Height,
    cutWidth,
    cutHeight,
    source: overrides.source ?? "custom-dxf",
    cutLines: overrides.cutLines ?? [],
    l0Bbox: overrides.l0Bbox ?? { x0: 0, y0: 0, x1: l0Width, y1: l0Height },
    dxfContent: overrides.dxfContent,
    designId: overrides.designId,
    blockDxfContent: overrides.blockDxfContent,
  };
}

// ── Layout ID Helper ────────────────────────────────────────────────────────

export function createLayoutId(index: number): string {
  return `layout-${index}`;
}