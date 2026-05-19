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
} from "./constants";
import type { SheetLayout, NestPart } from "./types";
import { collectAndDeduplicate } from "./deduplicator";
import { extractDxfModel } from "./dxf-reader";

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
      // Rotate 90° CCW around origin, then shift so rotated CUT bbox aligns with (0,0).
      // After CCW rotation, the bbox shifts left by l0Height.
      // Adding (l0Height + CUT_OFFSET) in X and CUT_OFFSET in Y brings
      // the CUT bbox lower-left back to (0,0), matching the 0° case.
      makerjs.model.rotate(instance, 90, [0, 0]);
      makerjs.model.moveRelative(instance, [part.l0Height + CUT_OFFSET, CUT_OFFSET]);
    } else {
      // No rotation — shift so CUT bbox is at (0,0)
      makerjs.model.moveRelative(instance, [CUT_OFFSET, CUT_OFFSET]);
    }

    // 3. Translate to final sheet position (pack position + layout offset)
    makerjs.model.moveRelative(instance, [placement.packX + layout.offsetX, placement.packY + layout.offsetY]);

    mainModel.models![`${part.id}_${i}`] = instance;
  }

  // ── Deduplicated CUT lines ───────────────────────────
  const dedupedCut = collectAndDeduplicate(
    layout.placements,
    parts,
    layout.mode,
    layout.offsetX,
    layout.offsetY,
  );
  for (const seg of dedupedCut) {
    const line = new makerjs.paths.Line([seg.x1, seg.y1], [seg.x2, seg.y2]) as makerjs.IPath;
    line.layer = LAYER_CUT;
    mainModel.paths![nextPathId()] = line;
  }

  // ── Build DXF via MakerJs (same method as sheet-metal) ──
  const layerOptions: Record<string, { color: number }> = {};
  for (const [layer, color] of Object.entries(LAYER_COLORS)) {
    layerOptions[layer] = { color };
  }

  let dxfString = makerjs.exporter.toDXF(mainModel, {
    units: makerjs.unitType.Millimeter,
    layerOptions,
  });

  // ── Inject sheet label as TEXT entity ─────────────────
  const labelText = `${layout.sheetName}_x${layout.repeatCount}`;
  const textHeight = 50;
  const textX = SHEET_WIDTH / 2;
  const textY = SHEET_HEIGHT + 80;
  const textDxf = `0\nTEXT\n8\n${LAYER_SHEETS}\n10\n${textX}\n20\n${textY}\n40\n${textHeight}\n1\n${labelText}\n`;
  dxfString = injectBeforeEndsec(dxfString, textDxf);

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
    const filename = `${layout.sheetName}_x${layout.repeatCount}.dxf`;
    zip.file(filename, dxfContent);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nesting_sheets.zip";
  link.click();
  URL.revokeObjectURL(url);
}
