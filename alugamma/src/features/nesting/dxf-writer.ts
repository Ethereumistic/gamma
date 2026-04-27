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

// ── Helpers ────────────────────────────────────────────────────────────────

function transformPoint(
  localX: number,
  localY: number,
  insertX: number,
  insertY: number,
  rotation: 0 | 90,
): [number, number] {
  if (rotation === 0) {
    return [insertX + localX, insertY + localY];
  }
  // 90° CCW: (x, y) → (-y, x)
  return [insertX - localY, insertY + localX];
}

function addLine(
  model: makerjs.IModel,
  a: [number, number],
  b: [number, number],
  layer: string,
): void {
  const line = new makerjs.paths.Line(a, b) as makerjs.IPath;
  line.layer = layer;
  const id = `p${Object.keys(model.paths || {}).length}`;
  model.paths![id] = line;
}

function addRectLines(
  model: makerjs.IModel,
  corners: [number, number][],
  layer: string,
): void {
  for (let i = 0; i < corners.length; i++) {
    const next = (i + 1) % corners.length;
    addLine(model, corners[i], corners[next], layer);
  }
}

// ── Main DXF Writer ─────────────────────────────────────────────────────────

export function writeNestSheetDxf(layout: SheetLayout, parts: NestPart[]): string {
  const model: makerjs.IModel = { paths: {} };

  // ── Sheet frame ────────────────────────────────────────
  // Outer boundary
  const outer: [number, number][] = [
    [0, 0],
    [SHEET_WIDTH, 0],
    [SHEET_WIDTH, SHEET_HEIGHT],
    [0, SHEET_HEIGHT],
  ];
  addRectLines(model, outer, LAYER_SHEETS);

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
    addRectLines(model, inner, LAYER_SHEETS);
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
    addRectLines(model, inner, LAYER_SHEETS);
  }

  // ── Part outlines (Layer 0 bounding boxes) ─────────────
  for (const placement of layout.placements) {
    const part = parts.find((p) => p.id === placement.partId);
    if (!part) continue;

    const insertX = placement.packX + layout.offsetX + CUT_OFFSET;
    const insertY = placement.packY + layout.offsetY + CUT_OFFSET;

    const { x0, y0, x1, y1 } = part.l0Bbox;
    const localCorners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const globalCorners = localCorners.map(([lx, ly]) =>
      transformPoint(lx, ly, insertX, insertY, placement.rotation),
    );
    addRectLines(model, globalCorners, LAYER_ZERO);
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
    addLine(model, [seg.x1, seg.y1], [seg.x2, seg.y2], LAYER_CUT);
  }

  // ── Export via MakerJs (same method as sheet-metal) ──
  let dxfString = makerjs.exporter.toDXF(model, {
    units: makerjs.unitType.Millimeter,
    layerOptions: {
      [LAYER_ZERO]: { color: LAYER_COLORS[LAYER_ZERO] },
      [LAYER_CUT]: { color: LAYER_COLORS[LAYER_CUT] },
      [LAYER_SHEETS]: { color: LAYER_COLORS[LAYER_SHEETS] },
    },
  });

  // ── Inject sheet label as TEXT entity ─────────────────
  const labelText = `${layout.sheetName}_x${layout.repeatCount}`;
  const textHeight = 50;
  const textX = SHEET_WIDTH / 2;
  const textY = SHEET_HEIGHT + 80;

  const textDxf = `0\nTEXT\n8\n${LAYER_SHEETS}\n10\n${textX}\n20\n${textY}\n40\n${textHeight}\n1\n${labelText}\n`;

  const entitiesSectionIdx = dxfString.indexOf("ENTITIES");
  if (entitiesSectionIdx !== -1) {
    const lineEnding = dxfString.includes("\r\n") ? "\r\n" : "\n";
    const endsecMatch = dxfString.indexOf(
      `0${lineEnding}ENDSEC`,
      entitiesSectionIdx,
    );
    if (endsecMatch !== -1) {
      const formattedTextDxf = textDxf.replace(/\n/g, lineEnding);
      dxfString =
        dxfString.slice(0, endsecMatch) +
        formattedTextDxf +
        dxfString.slice(endsecMatch);
    }
  }

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
