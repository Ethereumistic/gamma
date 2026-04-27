// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — DXF Sheet Writer
// Generates valid R2010 DXF files for each sheet layout.
//
// Plan refs: PLAN_03 (writer), PLAN_0 §5
// ────────────────────────────────────────────────────────────────────────────────

import {
  SHEET_WIDTH,
  SHEET_HEIGHT,
  MARGIN,
  CUT_OFFSET,
  LAYER_CUT,
  LAYER_SHEETS,
  LAYER_ZERO,
  LAYER_FREZ,
  LAYER_FREZ_135,
  LAYER_HOLES,
  LAYER_COLORS,
} from "./constants";
import type { SheetLayout, NestPart, Segment } from "./types";
import { collectAndDeduplicate } from "./deduplicator";

// ── DXF String Builder ──────────────────────────────────────────────────────

class DxfBuilder {
  private lines: string[] = [];

  constructor() {
    this.lines = [];
  }

  add(code: number, value: string | number): this {
    this.lines.push(String(code));
    this.lines.push(String(value));
    return this;
  }

  toString(): string {
    return this.lines.join("\n");
  }
}

// ── DXF Header ─────────────────────────────────────────────────────────────

function writeHeader(b: DxfBuilder, totalW: number, totalH: number): void {
  b.add(0, "SECTION")
    .add(2, "HEADER")
    .add(9, "$ACADVER").add(1, "AC1015") // R2000
    .add(9, "$INSUNITS").add(70, 4) // mm
    .add(9, "$EXTMIN").add(10, 0).add(20, 0).add(30, 0)
    .add(9, "$EXTMAX").add(10, totalW).add(20, totalH).add(30, 0)
    .add(0, "ENDSEC");
}

// ── DXF Tables ────────────────────────────────────────────────────────────

function writeTables(b: DxfBuilder): void {
  b.add(0, "SECTION").add(2, "TABLES");

  // LTYPE table
  b.add(0, "TABLE").add(2, "LTYPE").add(70, 1);
  b.add(0, "LTYPE").add(2, "Continuous").add(70, 0).add(3, "Solid line").add(72, 65).add(73, 0).add(40, 0);
  b.add(0, "ENDTAB");

  // LAYER table — include all nesting layers
  b.add(0, "TABLE").add(2, "LAYER").add(70, 6);

  const layers = [
    { name: LAYER_ZERO, color: LAYER_COLORS[LAYER_ZERO] ?? 7 },
    { name: LAYER_CUT, color: LAYER_COLORS[LAYER_CUT] ?? 1 },
    { name: LAYER_FREZ, color: LAYER_COLORS[LAYER_FREZ] ?? 6 },
    { name: LAYER_FREZ_135, color: LAYER_COLORS[LAYER_FREZ_135] ?? 4 },
    { name: LAYER_HOLES, color: LAYER_COLORS[LAYER_HOLES] ?? 5 },
    { name: LAYER_SHEETS, color: LAYER_COLORS[LAYER_SHEETS] ?? 7 },
  ];

  for (const layer of layers) {
    b.add(0, "LTYPE").add(2, "Continuous"); // ensure linetype reference
    b.add(0, "LAYER")
      .add(2, layer.name)
      .add(70, 0)
      .add(62, layer.color)
      .add(6, "Continuous");
  }
  b.add(0, "ENDTAB");

  b.add(0, "ENDTAB"); // close any remaining table
  b.add(0, "ENDSEC");
}

// ── DXF Entities ───────────────────────────────────────────────────────────

function writeLine(b: DxfBuilder, x1: number, y1: number, x2: number, y2: number, layer: string, color?: number): void {
  b.add(0, "LINE")
    .add(8, layer)
    .add(10, round(x1)).add(20, round(y1)).add(30, 0)
    .add(11, round(x2)).add(21, round(y2)).add(31, 0);
  if (color !== undefined) {
    b.add(62, color);
  }
}

function writeLwpolyline(b: DxfBuilder, points: [number, number][], layer: string, closed: boolean, color?: number): void {
  b.add(0, "LWPOLYLINE")
    .add(8, layer)
    .add(90, points.length)
    .add(70, closed ? 1 : 0);
  if (color !== undefined) {
    b.add(62, color);
  }
  for (const [x, y] of points) {
    b.add(10, round(x)).add(20, round(y));
  }
}

function writeText(b: DxfBuilder, text: string, x: number, y: number, height: number, layer: string, color?: number): void {
  b.add(0, "TEXT")
    .add(8, layer)
    .add(10, round(x)).add(20, round(y)).add(30, 0)
    .add(40, height)
    .add(1, text);
  if (color !== undefined) {
    b.add(62, color);
  }
}

function writeBlockInsert(b: DxfBuilder, blockName: string, x: number, y: number, rotation: number, layer: string): void {
  b.add(0, "INSERT")
    .add(8, layer)
    .add(2, blockName)
    .add(10, round(x)).add(20, round(y)).add(30, 0)
    .add(50, rotation); // rotation in degrees
}

// ── Block Definitions ──────────────────────────────────────────────────────

function writeBlocksSection(b: DxfBuilder, parts: NestPart[]): void {
  b.add(0, "SECTION").add(2, "BLOCKS");

  for (const part of parts) {
    // Create a block for each part (non-CUT geometry)
    if (!part.blockDxfContent) continue;

    b.add(0, "BLOCK")
      .add(2, part.id)
      .add(8, LAYER_ZERO)
      .add(70, 0)
      .add(10, 0).add(20, 0).add(30, 0)
      .add(3, part.id);

    // Parse the block content (simple LINE entities from the part's DXF)
    // For now, we write the entities directly in the block definition
    writePartEntitiesInBlock(b, part);

    b.add(0, "ENDBLK").add(8, LAYER_ZERO).add(2, part.id);
  }

  b.add(0, "ENDSEC");
}

function writePartEntitiesInBlock(b: DxfBuilder, part: NestPart): void {
  // Write non-CUT entities from the part.
  // If the part has dxfContent, we parse it and extract non-CUT layer entities.
  // For simplicity, since the block content comes from the sheet-metal DXF generator,
  // we'll write the geometry we know about (Layer 0 bounding box, etc.)
  //
  // TODO: For imported DXF files, we need a proper parser (dxf-reader.ts).
  // For sheet-metal sourced parts, the geometry comes from buildDxf().

  // For now, write what we can from l0Bbox
  const { x0, y0, x1, y1 } = part.l0Bbox;

  // Layer 0 outline
  writeLwpolyline(
    b,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    LAYER_ZERO,
    true,
  );
}

// ── Sheet Frame ─────────────────────────────────────────────────────────────

function writeSheetFrame(b: DxfBuilder, mode: "A" | "B", offsetX: number, offsetY: number, layoutW: number, layoutH: number): void {
  // Outer sheet boundary
  writeLwpolyline(
    b,
    [
      [0, 0],
      [SHEET_WIDTH, 0],
      [SHEET_WIDTH, SHEET_HEIGHT],
      [0, SHEET_HEIGHT],
    ],
    LAYER_SHEETS,
    true,
    LAYER_COLORS[LAYER_SHEETS],
  );

  if (mode === "A") {
    // Inner margin rect
    const m = MARGIN;
    writeLwpolyline(
      b,
      [
        [m, m],
        [SHEET_WIDTH - m, m],
        [SHEET_WIDTH - m, SHEET_HEIGHT - m],
        [m, SHEET_HEIGHT - m],
      ],
      LAYER_SHEETS,
      true,
      8, // gray
    );
  } else {
    // Mode B: equal-margin guide rect around the centered layout
    const x0 = offsetX;
    const y0 = offsetY;
    const x1 = offsetX + layoutW;
    const y1 = offsetY + layoutH;
    writeLwpolyline(
      b,
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      LAYER_SHEETS,
      true,
      8,
    );
  }
}

// ── Round numbers for cleaner DXF ───────────────────────────────────────────

function round(n: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// ── Main DXF Writer ─────────────────────────────────────────────────────────

export function writeNestSheetDxf(
  layout: SheetLayout,
  parts: NestPart[],
): string {
  const b = new DxfBuilder();

  const totalW = SHEET_WIDTH;
  const totalH = SHEET_HEIGHT + 200; // Extra space above for label

  // ── Header ──
  writeHeader(b, totalW, totalH);

  // ── Tables ──
  writeTables(b);

  // ── Blocks (non-CUT geometry) ──
  writeBlocksSection(b, parts);

  // ── Entities ──
  b.add(0, "SECTION").add(2, "ENTITIES");

  // Sheet frame
  const layoutW = layout.placements.length > 0
    ? Math.max(...layout.placements.map((pl) => pl.packX + pl.packWidth))
    : 0;
  const layoutH = layout.placements.length > 0
    ? Math.max(...layout.placements.map((pl) => pl.packY + pl.packHeight))
    : 0;

  writeSheetFrame(b, layout.mode, layout.offsetX, layout.offsetY, layoutW, layoutH);

  // Block inserts for non-CUT geometry
  for (const placement of layout.placements) {
    const part = parts.find((p) => p.id === placement.partId);
    if (!part) continue;

    const insertX = placement.packX + layout.offsetX + CUT_OFFSET;
    const insertY = placement.packY + layout.offsetY + CUT_OFFSET;

    writeBlockInsert(b, part.id, insertX, insertY, placement.rotation, LAYER_ZERO);
  }

  // Deduplicated CUT lines
  const dedupedCut = collectAndDeduplicate(
    layout.placements,
    parts,
    layout.mode,
    layout.offsetX,
    layout.offsetY,
  );

  for (const seg of dedupedCut) {
    writeLine(b, seg.x1, seg.y1, seg.x2, seg.y2, LAYER_CUT, LAYER_COLORS[LAYER_CUT]);
  }

  // Label
  const labelText = `${layout.sheetName}_x${layout.repeatCount}`;
  writeText(b, labelText, SHEET_WIDTH / 2, SHEET_HEIGHT + 80, 50, LAYER_SHEETS, LAYER_COLORS[LAYER_SHEETS]);

  b.add(0, "ENDSEC");

  // ── EOF ──
  b.add(0, "EOF");

  return b.toString();
}

// ── Export Helper: Download DXF File ─────────────────────────────────────────

export function downloadDxf(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Export All Sheets as ZIP ─────────────────────────────────────────────────

export async function exportAllSheetsAsZip(
  layouts: SheetLayout[],
  parts: NestPart[],
): Promise<void> {
  // Dynamic import of JSZip (it's in our dependencies)
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