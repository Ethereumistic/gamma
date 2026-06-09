// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — DXF Sheet Writer
// Generates a simple, universally-compatible DXF by using Maker.js's exporter,
// exactly the same methodology as the sheet-metal feature.
// ────────────────────────────────────────────────────────────────────────────────

import makerjs from "makerjs";
import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  MARGIN,
  CUT_OFFSET,
  LAYER_CUT,
  LAYER_SHEETS,
  LAYER_ZERO,
  LAYER_COLORS,
  DEFAULT_LAYER_ACI_COLOR,
  getAciColor,
} from "./constants";
import type { SheetLayout, NestPart, Segment } from "./types";
import { formatSheetTitle } from "./types";
import { collectAndDeduplicate } from "./deduplicator";
import { extractDxfModel } from "./dxf-reader";
import { joinSegmentsForLayer, joinStrategyForLayer } from "./line-joiner";

// ── Helpers ────────────────────────────────────────────────────────────────

function addRectLines(
  model: makerjs.IModel,
  corners: [number, number][],
  layer: string,
  nextId: () => string,
): void {
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    const line = new makerjs.paths.Line(corners[i], corners[j]) as makerjs.IPath;
    line.layer = layer;
    model.paths![nextId()] = line;
  }
}

function injectBeforeEndsec(dxfString: string, entityDxf: string): string {
  const entitiesSectionIdx = dxfString.indexOf("ENTITIES");
  if (entitiesSectionIdx === -1) return dxfString;
  const lineEnding = dxfString.includes("\r\n") ? "\r\n" : "\n";
  const endsecMatch = dxfString.indexOf(`0${lineEnding}ENDSEC`, entitiesSectionIdx);
  if (endsecMatch === -1) return dxfString;
  const formatted = entityDxf.replace(/\n/g, lineEnding);
  return dxfString.slice(0, endsecMatch) + formatted + dxfString.slice(endsecMatch);
}

/** Post-process DXF string to fix layer colors:
 *  Change unknown layer colors to orange (ACI 30). */
function postProcessDxfLayerColors(dxfString: string): string {
  const lineEnding = dxfString.includes("\r\n") ? "\r\n" : "\n";
  const lines = dxfString.split(lineEnding);
  const knownLayers = new Set(Object.keys(LAYER_COLORS));
  let modified = false;

  let i = 0;
  while (i < lines.length) {
    // Find start of a LAYER entity: "0" followed by "LAYER"
    if (lines[i]?.trim() === "0" && lines[i + 1]?.trim() === "LAYER") {
      let layerName = "";
      let colorValueIdx = -1; // Index of the color VALUE line (line after "62")
      let j = i + 2; // Skip "0" and "LAYER"

      // Process group code/value pairs until next entity (group code 0)
      while (j < lines.length - 1 && lines[j]?.trim() !== "0") {
        const code = lines[j]?.trim();
        const value = lines[j + 1]?.trim() || "";
        if (code === "2") layerName = value;
        if (code === "62") colorValueIdx = j + 1; // value line index
        j += 2;
      }

      // Change unknown layer colors to orange (ACI 30)
      if (!knownLayers.has(layerName) && layerName !== "DEFPOINTS" && layerName !== "") {
        if (colorValueIdx >= 0 && colorValueIdx < lines.length) {
          lines[colorValueIdx] = String(DEFAULT_LAYER_ACI_COLOR);
          modified = true;
        }
      }
    }
    i++;
  }

  return modified ? lines.join(lineEnding) : dxfString;
}

// ── Line Joining: Extract, Join, and Replace ──────────────────────────────────
//
// Walks the Maker.js model tree to collect all LINE paths organized by layer,
// applies per-layer joining strategies, removes the original LINE paths for
// layers that need joining, and adds the joined lines as new top-level paths.
//
// This is the critical step that ensures CNC-ready DXF output:
//   CUT, HOLES, custom → full join (merge all collinear segments)
//   FREZ, FREZ_135    → orientation-aware join (same-angle collinear segments only)
//   SHEETS, 0         → skip (no joining needed)

interface CollectedLine {
  layer: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Key in the paths object, used for removal */
  pathKey: string;
  /** Reference to the paths object that contains this line */
  pathsObj: Record<string, makerjs.IPath>;
}

/**
 * Recursively walk a Maker.js model tree and collect all LINE paths
 * with their world-space coordinates (accounting for model origins).
 */
function collectLinePaths(
  model: makerjs.IModel,
  offsetX: number = 0,
  offsetY: number = 0,
): CollectedLine[] {
  const lines: CollectedLine[] = [];

  // Accumulate this model's origin
  const ox = offsetX + (model.origin ? model.origin[0] : 0);
  const oy = offsetY + (model.origin ? model.origin[1] : 0);

  // Collect LINE paths from this model level
  if (model.paths) {
    for (const [key, path] of Object.entries(model.paths)) {
      if (path.type === "line") {
        const line = path as makerjs.paths.Line;
        lines.push({
          layer: (line as any).layer || "0",
          x1: line.origin[0] + ox,
          y1: line.origin[1] + oy,
          x2: line.end[0] + ox,
          y2: line.end[1] + oy,
          pathKey: key,
          pathsObj: model.paths!,
        });
      }
    }
  }

  // Recurse into sub-models
  if (model.models) {
    for (const subModel of Object.values(model.models)) {
      lines.push(...collectLinePaths(subModel as makerjs.IModel, ox, oy));
    }
  }

  return lines;
}

/**
 * Apply per-layer line joining to a Maker.js model.
 *
 * 1. Collect all LINE paths from the model tree (with world-space coordinates)
 * 2. Remove LINE paths for layers that need joining
 * 3. Apply the appropriate joining strategy per layer
 * 4. Add joined lines as new top-level paths
 *
 * Returns the number of lines removed and added for diagnostics.
 */
export function applyLineJoining(model: makerjs.IModel, nextId: () => string): {
  removed: number;
  added: number;
} {
  // Step 1: Collect all LINE paths with world-space coordinates
  const collected = collectLinePaths(model);

  // Group by layer
  const byLayer = new Map<string, CollectedLine[]>();
  for (const line of collected) {
    if (!byLayer.has(line.layer)) byLayer.set(line.layer, []);
    byLayer.get(line.layer)!.push(line);
  }

  // Step 2: For each layer that needs joining, remove original lines and add joined lines
  let totalRemoved = 0;
  let totalAdded = 0;

  for (const [layer, lines] of byLayer) {
    const strategy = joinStrategyForLayer(layer);
    if (strategy === "skip") continue;

    // Convert to segments
    const segments: Segment[] = lines.map((l) => ({
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
    }));

    // Remove original LINE paths from the model
    for (const line of lines) {
      delete line.pathsObj[line.pathKey];
      totalRemoved++;
    }

    // Apply joining
    const joined = joinSegmentsForLayer(segments, layer);

    // Add joined lines as new top-level paths
    for (const seg of joined) {
      const newLine = new makerjs.paths.Line(
        [seg.x1, seg.y1],
        [seg.x2, seg.y2],
      ) as makerjs.IPath;
      newLine.layer = layer;
      model.paths![nextId()] = newLine;
      totalAdded++;
    }
  }

  return { removed: totalRemoved, added: totalAdded };
}

// ── Main DXF Writer ─────────────────────────────────────────────────────────

export function writeNestSheetDxf(layout: SheetLayout, parts: NestPart[]): string {
  const mainModel: makerjs.IModel = { paths: {}, models: {} };
  let pathId = 0;
  const nextPathId = () => `p${pathId++}`;

  // ── Sheet frame ────────────────────────────────────────
  const outer: [number, number][] = [
    [0, 0],
    [SHEET_WIDTH, 0],
    [SHEET_WIDTH, SHEET_HEIGHT],
    [0, SHEET_HEIGHT],
  ];
  addRectLines(mainModel, outer, LAYER_SHEETS, nextPathId);

  // Inner guide rectangle
  const layoutW =
    layout.placements.length > 0
      ? Math.max(...layout.placements.map((pl) => pl.packX + pl.packWidth))
      : 0;
  const layoutH =
    layout.placements.length > 0
      ? Math.max(...layout.placements.map((pl) => pl.packY + pl.packHeight))
      : 0;

  if (layout.mode === "A") {
    const m = MARGIN;
    const inner: [number, number][] = [
      [m, m],
      [SHEET_WIDTH - m, m],
      [SHEET_WIDTH - m, SHEET_HEIGHT - m],
      [m, SHEET_HEIGHT - m],
    ];
    addRectLines(mainModel, inner, LAYER_SHEETS, nextPathId);
  } else {
    const x0 = layout.offsetX;
    const y0 = layout.offsetY;
    const x1 = layout.offsetX + layoutW;
    const y1 = layout.offsetY + layoutH;
    const inner: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    addRectLines(mainModel, inner, LAYER_SHEETS, nextPathId);
  }

  // ── Per-part non‑CUT geometry (Layer 0, FREZ, FREZ_135, HOLES) ──
  const partBaseModels = new Map<string, makerjs.IModel | null>();
  const getBaseModel = (part: NestPart): makerjs.IModel | null => {
    if (partBaseModels.has(part.id)) return partBaseModels.get(part.id)!;

    let model: makerjs.IModel | null = null;
    if (part.dxfContent) {
      model = extractDxfModel(part.dxfContent);
    }

    // Fallback: simple Layer 0 rectangle if nothing was parsed
    if (!model && part.l0Bbox) {
      const { x0, y0, x1, y1 } = part.l0Bbox;
      const fb: makerjs.IModel = { paths: {} };
      const l1 = new makerjs.paths.Line([x0, y0], [x1, y0]) as makerjs.IPath; l1.layer = LAYER_ZERO;
      const l2 = new makerjs.paths.Line([x1, y0], [x1, y1]) as makerjs.IPath; l2.layer = LAYER_ZERO;
      const l3 = new makerjs.paths.Line([x1, y1], [x0, y1]) as makerjs.IPath; l3.layer = LAYER_ZERO;
      const l4 = new makerjs.paths.Line([x0, y1], [x0, y0]) as makerjs.IPath; l4.layer = LAYER_ZERO;
      fb.paths = { l1, l2, l3, l4 };
      model = fb;
    }

    partBaseModels.set(part.id, model);
    return model;
  };

  for (let i = 0; i < layout.placements.length; i++) {
    const placement = layout.placements[i];
    const part = parts.find((p) => p.id === placement.partId);
    if (!part) continue;

    const baseModel = getBaseModel(part);
    if (!baseModel) continue;

    // Deep-clone so rotation/movement don't mutate the cached base model
    const instance: makerjs.IModel = JSON.parse(JSON.stringify(baseModel));

    // 1. Normalise raw DXF coordinates so the part's l0 lower-left sits at local (0,0)
    makerjs.model.moveRelative(instance, [-part.l0Bbox.x0, -part.l0Bbox.y0]);

    // 2. Rotate and align
    if (placement.rotation === 90) {
      makerjs.model.rotate(instance, 90, [0, 0]);
      makerjs.model.moveRelative(instance, [part.l0Height + CUT_OFFSET, CUT_OFFSET]);
    } else if (placement.rotation === 180) {
      makerjs.model.rotate(instance, 180, [0, 0]);
      makerjs.model.moveRelative(instance, [part.l0Width + CUT_OFFSET, part.l0Height + CUT_OFFSET]);
    } else if (placement.rotation === 270) {
      makerjs.model.rotate(instance, 270, [0, 0]);
      makerjs.model.moveRelative(instance, [CUT_OFFSET, part.l0Width + CUT_OFFSET]);
    } else {
      // 0° — no rotation
      makerjs.model.moveRelative(instance, [CUT_OFFSET, CUT_OFFSET]);
    }

    // 3. Translate to final sheet position (pack position + layout offset)
    makerjs.model.moveRelative(instance, [placement.packX + layout.offsetX, placement.packY + layout.offsetY]);

    mainModel.models![`${part.id}_${i}`] = instance;
  }

  // ── Deduplicated CUT lines (pre-joined for CNC readiness) ──────────────
  // Join CUT segments BEFORE adding them to the Maker.js model.
  // Pre-joining directly on the Segment[] data is more reliable than
  // relying on the model-walking approach in applyLineJoining because:
  //   1. No Maker.js path-type matching — operates on plain coordinates
  //   2. No model origin math — segments are already in sheet space
  //   3. Deterministic regardless of model nesting or structure
  // applyLineJoining still runs later for FREZ/HOLES/etc. and will
  // harmlessly re-confirm the already-joined CUT lines.
  const dedupedCut = collectAndDeduplicate(
    layout.placements,
    parts,
    layout.mode,
    layout.offsetX,
    layout.offsetY,
  );
  const joinedCut = joinSegmentsForLayer(dedupedCut, LAYER_CUT);
  for (const seg of joinedCut) {
    const line = new makerjs.paths.Line([seg.x1, seg.y1], [seg.x2, seg.y2]) as makerjs.IPath;
    line.layer = LAYER_CUT;
    mainModel.paths![nextPathId()] = line;
  }

  // ── Apply line joining for remaining layers (FREZ, HOLES, custom) ────
  // CUT lines are already pre-joined above, so applyLineJoining will
  // confirm them (no-op) and process FREZ/FREZ_135/HOLES/etc.
  //   FREZ, FREZ_135     →  orientation-aware join
  //   HOLES, custom       →  full join
  //   SHEETS, 0           →  skip
  applyLineJoining(mainModel, nextPathId);

  // ── Build DXF via MakerJs (same method as sheet-metal) ──

  // Walk the model to collect all used layers and build complete layerOptions
  const usedLayers = new Set<string>();
  makerjs.model.walk(mainModel, {
    onPath: (walked) => {
      const layer = walked.layer || (walked.pathContext as any).layer || "0";
      if (layer) usedLayers.add(layer);
    },
  });

  const layerOptions: Record<string, { color: number }> = {};
  // Add all used layers with their correct ACI colors
  for (const layer of usedLayers) {
    layerOptions[layer] = { color: getAciColor(layer) };
  }
  // Also ensure known layers are always defined (even if empty)
  for (const [layer, color] of Object.entries(LAYER_COLORS)) {
    if (!(layer in layerOptions)) {
      layerOptions[layer] = { color };
    }
  }

  let dxfString = makerjs.exporter.toDXF(mainModel, {
    units: makerjs.unitType.Millimeter,
    layerOptions,
  });

  // ── Post-process DXF: fix layer colors (true color for SHEETS, orange for unknown) ──
  dxfString = postProcessDxfLayerColors(dxfString);

  // ── Inject label TEXT entities ────────────────────────────────────────────
  // Build all entity DXF strings
  let entityDxf = "";
  const lineEnding = dxfString.includes("\r\n") ? "\r\n" : "\n";

  // ── Sheet title (top-left, above the sheet) ──
  // Format: {number}_r{repeat}_{mode}_p{parts}_u{util}%
  const titleText = formatSheetTitle(layout);
  const titleX = 10; // Left-aligned, small margin from left edge
  const titleY = SHEET_HEIGHT + 80; // Above the sheet
  const titleHeight = 95.63;
  entityDxf += `0${lineEnding}TEXT${lineEnding}`;
  entityDxf += `8${lineEnding}0${lineEnding}`; // Layer 0
  entityDxf += `10${lineEnding}${titleX}${lineEnding}`; // Insertion X
  entityDxf += `20${lineEnding}${titleY}${lineEnding}`; // Insertion Y
  entityDxf += `40${lineEnding}${titleHeight}${lineEnding}`; // Text height
  entityDxf += `1${lineEnding}${titleText}${lineEnding}`; // Text content

  // ── Per-part name labels (centered on L0 bbox) ──
  const partMap = new Map(parts.map((p) => [p.id, p]));
  for (const placement of layout.placements) {
    const part = partMap.get(placement.partId);
    if (!part) continue;

    const l0ShiftX = (placement.rotation === 90 || placement.rotation === 270) ? part.l0Height : 0;
    const labelW = (placement.rotation === 90 || placement.rotation === 270) ? part.l0Height : part.l0Width;
    const labelH = (placement.rotation === 90 || placement.rotation === 270) ? part.l0Width : part.l0Height;
    const labelTextX =
      placement.packX + layout.offsetX + CUT_OFFSET + l0ShiftX + labelW / 2;
    const labelTextY =
      placement.packY + layout.offsetY + CUT_OFFSET + labelH / 2;

    // Center-aligned text: use group code 72=1 (center) and provide alignment point (11/21)
    entityDxf += `0${lineEnding}TEXT${lineEnding}`;
    entityDxf += `8${lineEnding}0${lineEnding}`; // Layer 0
    entityDxf += `10${lineEnding}${labelTextX}${lineEnding}`; // First alignment X
    entityDxf += `20${lineEnding}${labelTextY}${lineEnding}`; // First alignment Y
    entityDxf += `40${lineEnding}50${lineEnding}`; // Text height
    entityDxf += `1${lineEnding}${part.name}${lineEnding}`; // Text content
    entityDxf += `72${lineEnding}1${lineEnding}`; // Horizontal alignment: center
    entityDxf += `11${lineEnding}${labelTextX}${lineEnding}`; // Second alignment X
    entityDxf += `21${lineEnding}${labelTextY}${lineEnding}`; // Second alignment Y
  }

  // ── Repetition count label (bottom-right, below the sheet) ──
  // Shows just the repetition number for this sheet
  const repeatX = SHEET_WIDTH - 10; // Right-aligned, small margin from right
  const repeatY = -120; // Below the sheet, clear of the bottom edge
  const repeatHeight = titleHeight;
  entityDxf += `0${lineEnding}TEXT${lineEnding}`;
  entityDxf += `8${lineEnding}0${lineEnding}`; // Layer 0
  entityDxf += `10${lineEnding}${repeatX}${lineEnding}`; // Insertion X
  entityDxf += `20${lineEnding}${repeatY}${lineEnding}`; // Insertion Y
  entityDxf += `40${lineEnding}${repeatHeight}${lineEnding}`; // Text height
  entityDxf += `1${lineEnding}${String(layout.repeatCount)}${lineEnding}`; // Text content
  entityDxf += `72${lineEnding}2${lineEnding}`; // Horizontal alignment: right
  entityDxf += `11${lineEnding}${repeatX}${lineEnding}`; // Second alignment X
  entityDxf += `21${lineEnding}${repeatY}${lineEnding}`; // Second alignment Y

  // Inject all entities before ENDSEC
  dxfString = injectBeforeEndsec(dxfString, entityDxf);

  return dxfString;
}

// ── Export Helper: Download DXF File ───────────────────────────────────────

export function downloadDxf(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Export All Sheets as ZIP ───────────────────────────────────────────────

export async function exportAllSheetsAsZip(
  layouts: SheetLayout[],
  parts: NestPart[],
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const layout of layouts) {
    const dxfContent = writeNestSheetDxf(layout, parts);
    const filename = formatSheetTitle(layout);
    zip.file(`${filename}.dxf`, dxfContent);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nesting_sheets.zip";
  link.click();
  URL.revokeObjectURL(url);
}