// ────────────────────────────────────────────────────────────────────────────────
// Regression test: per-part CUT contours must be emitted as LWPOLYLINE
// entities (one closed polyline per part), with cross-part OVERKILL removing
// coincident shared edges.
//
// The user wants the CUT layer to look like a clean per-part closed polygon
// in CAD viewers, not as N individual LINE entities. We emit LWPOLYLINE
// entities for that purpose.
//
// Cross-part OVERKILL: when two parts share a flush edge, the shared edge
// appears in both parts' polylines. We mark one of them for removal (the
// "non-owner") and emit the removed edge as a standalone LINE entity. The
// "owner" keeps the edge in its LWPOLYLINE (still closed), the non-owner
// has a gap (filled by the standalone LINE).
// ────────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { createNestPartFromDesign, parseDxfContent } from "@/features/nesting/dxf-reader";
import { writeNestSheetDxf } from "@/features/nesting/dxf-writer";
import { createNestPart } from "@/features/nesting/types";
import type { Placement, SheetLayout, NestPart } from "@/features/nesting/types";
import { PRODUCTION_DESIGNS } from "../sheet-metal/__fixtures__/production-designs";
import { parseFormula } from "@/features/sheet-metal/formula/parser";
import { CUT_OFFSET } from "@/features/nesting/constants";

function makePart(designId: string): NestPart {
  const fixture = PRODUCTION_DESIGNS.find((d) => d.id === designId);
  if (!fixture) throw new Error(`Unknown design ${designId}`);
  return createNestPartFromDesign({
    id: fixture.id as any,
    name: fixture.name,
    exportName: fixture.exportName,
    model: fixture.model,
  } as any);
}

function makeLayout(part: NestPart, placements: Placement[]): SheetLayout {
  return {
    id: "regression-layout",
    sheetIndex: 0,
    mode: "A",
    alignment: "margin",
    placements,
    repeatCount: 1,
    sheetName: "regression",
    offsetX: 0,
    offsetY: 0,
    dedupedCutSegments: [],
    utilizationPercent: 0,
  };
}

function makeDoubleVNotchPart(id = "double-v-notch"): NestPart {
  const formula = "875x1790 W F10 Q E F90 Q E A F25 F20 S F308 Q E D F20";
  const { model, errors } = parseFormula(formula);
  expect(errors).toHaveLength(0);

  return createNestPartFromDesign({
    id,
    name: "double-v-notch",
    exportName: "double-v-notch_T_x1",
    model,
  } as any);
}

function makeDoubleVNotchCustomDxfPart(): NestPart {
  const sourcePart = makeDoubleVNotchPart("double-v-notch-source");
  expect(sourcePart.dxfContent).toBeDefined();

  const parsed = parseDxfContent(sourcePart.dxfContent!);
  expect(parsed).not.toBeNull();

  return createNestPart({
    id: "double-v-notch-custom",
    name: "double-v-notch-custom",
    filename: "double-v-notch_T_x1",
    direction: "T",
    count: 1,
    source: "custom-dxf",
    l0Width: parsed!.l0Width,
    l0Height: parsed!.l0Height,
    l0Bbox: parsed!.l0Bbox,
    cutLines: parsed!.cutLines,
    dxfContent: sourcePart.dxfContent,
  });
}

function expectPolylineFollowsCutLineOrder(
  polyline: LwPolyline,
  part: NestPart,
  placement: Placement,
  layout: SheetLayout,
): void {
  expect(polyline.closed).toBe(true);
  expect(polyline.points.length).toBe(part.cutLines.length);

  const insertX = placement.packX + layout.offsetX + CUT_OFFSET;
  const insertY = placement.packY + layout.offsetY + CUT_OFFSET;
  for (let i = 0; i < part.cutLines.length; i++) {
    expect(polyline.points[i].x).toBeCloseTo(insertX + part.cutLines[i].x1, 6);
    expect(polyline.points[i].y).toBeCloseTo(insertY + part.cutLines[i].y1, 6);
  }
}

type LwPolyline = {
  layer: string;
  points: Array<{ x: number; y: number }>;
  closed: boolean;
};

type Line = {
  layer: string;
  x1: number; y1: number; x2: number; y2: number;
};

/** Parse polyline and LINE entities from a DXF string on the CUT layer. */
function extractCutEntities(dxf: string): { polylines: LwPolyline[]; lines: Line[] } {
  const polylines: LwPolyline[] = [];
  const lines: Line[] = [];

  const text = dxf.split(/\r?\n/);
  let i = 0;
  let curEntity: "LWPOLYLINE" | "POLYLINE" | "VERTEX" | "LINE" | null = null;
  let curLayer = "";
  let curClosed = false;
  let curPoints: Array<{ x: number; y: number }> = [];
  let curX = NaN, curY = NaN;
  let curX1 = NaN, curY1 = NaN, curX2 = NaN, curY2 = NaN;
  let activePolylineLayer = "";
  let activePolylineClosed = false;
  let activePolylinePoints: Array<{ x: number; y: number }> = [];

  const flushEntity = () => {
    if (curEntity === "LWPOLYLINE" && curLayer === "CUT" && curPoints.length > 0) {
      polylines.push({ layer: "CUT", points: curPoints, closed: curClosed });
    } else if (curEntity === "VERTEX" && activePolylineLayer === "CUT") {
      if (!Number.isNaN(curX) && !Number.isNaN(curY)) {
        activePolylinePoints.push({ x: curX, y: curY });
      }
    } else if (curEntity === "LINE" && curLayer === "CUT") {
      if (!Number.isNaN(curX1) && !Number.isNaN(curY1) && !Number.isNaN(curX2) && !Number.isNaN(curY2)) {
        lines.push({ layer: "CUT", x1: curX1, y1: curY1, x2: curX2, y2: curY2 });
      }
    }
  };

  while (i < text.length - 1) {
    const code = text[i].trim();
    const val = text[i + 1].trim();
    i += 2;

    if (code === "0") {
      flushEntity();

      if (val === "SEQEND") {
        if (activePolylineLayer === "CUT" && activePolylinePoints.length > 0) {
          polylines.push({
            layer: "CUT",
            points: activePolylinePoints,
            closed: activePolylineClosed,
          });
        }
        activePolylineLayer = "";
        activePolylineClosed = false;
        activePolylinePoints = [];
        curEntity = null;
        continue;
      }

      // Start new entity
      if (val === "LWPOLYLINE") {
        curEntity = "LWPOLYLINE";
        curLayer = "";
        curClosed = false;
        curPoints = [];
        curX = curY = curX1 = curY1 = curX2 = curY2 = NaN;
      } else if (val === "POLYLINE") {
        curEntity = "POLYLINE";
        curLayer = "";
        curClosed = false;
        activePolylineLayer = "";
        activePolylineClosed = false;
        activePolylinePoints = [];
        curX = curY = curX1 = curY1 = curX2 = curY2 = NaN;
      } else if (val === "VERTEX") {
        curEntity = "VERTEX";
        curLayer = "";
        curX = curY = curX1 = curY1 = curX2 = curY2 = NaN;
      } else if (val === "LINE") {
        curEntity = "LINE";
        curLayer = "";
        curX = curY = curX1 = curY1 = curX2 = curY2 = NaN;
      } else {
        curEntity = null;
      }
    } else if (curEntity === "LWPOLYLINE") {
      if (code === "8") curLayer = val;
      else if (code === "70") curClosed = (parseInt(val, 10) & 1) === 1;
      else if (code === "10") {
        curX = Number(val);
        if (!Number.isNaN(curY)) {
          curPoints.push({ x: curX, y: curY });
          curX = curY = NaN;
        }
      } else if (code === "20") {
        curY = Number(val);
        if (!Number.isNaN(curX)) {
          curPoints.push({ x: curX, y: curY });
          curX = curY = NaN;
        }
      }
    } else if (curEntity === "POLYLINE") {
      if (code === "8") {
        curLayer = val;
        activePolylineLayer = val;
      } else if (code === "70") {
        curClosed = (parseInt(val, 10) & 1) === 1;
        activePolylineClosed = curClosed;
      }
    } else if (curEntity === "VERTEX") {
      if (code === "8") curLayer = val;
      else if (code === "10") curX = Number(val);
      else if (code === "20") curY = Number(val);
    } else if (curEntity === "LINE") {
      if (code === "8") curLayer = val;
      else if (code === "10") curX1 = Number(val);
      else if (code === "20") curY1 = Number(val);
      else if (code === "11") curX2 = Number(val);
      else if (code === "21") curY2 = Number(val);
    }
  }
  // Flush last entity
  flushEntity();
  return { polylines, lines };
}

function extractLineEntitiesByLayer(dxf: string, targetLayer: string): Line[] {
  const lines: Line[] = [];
  const text = dxf.split(/\r?\n/);
  let i = 0;
  let inLine = false;
  let layer = "";
  let x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN;

  const flush = () => {
    if (inLine && layer === targetLayer) {
      if (!Number.isNaN(x1) && !Number.isNaN(y1) && !Number.isNaN(x2) && !Number.isNaN(y2)) {
        lines.push({ layer, x1, y1, x2, y2 });
      }
    }
  };

  while (i < text.length - 1) {
    const code = text[i].trim();
    const val = text[i + 1].trim();
    i += 2;

    if (code === "0") {
      flush();
      inLine = val === "LINE";
      layer = "";
      x1 = y1 = x2 = y2 = NaN;
      continue;
    }

    if (!inLine) continue;
    if (code === "8") layer = val;
    else if (code === "10") x1 = Number(val);
    else if (code === "20") y1 = Number(val);
    else if (code === "11") x2 = Number(val);
    else if (code === "21") y2 = Number(val);
  }
  flush();
  return lines;
}

function bboxOfLines(lines: Line[]) {
  const xs = lines.flatMap((line) => [line.x1, line.x2]);
  const ys = lines.flatMap((line) => [line.y1, line.y2]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

function bboxOfPoints(points: Array<{ x: number; y: number }>) {
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

function shiftedRectangleDxf(): string {
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    `0\nLINE\n8\n${layer}\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;

  return [
    "0\nSECTION\n2\nENTITIES\n",
    line("0", 100, 200, 200, 200),
    line("0", 200, 200, 200, 250),
    line("0", 200, 250, 100, 250),
    line("0", 100, 250, 100, 200),
    line("CUT", 97, 197, 203, 197),
    line("CUT", 203, 197, 203, 253),
    line("CUT", 203, 253, 97, 253),
    line("CUT", 97, 253, 97, 197),
    "0\nENDSEC\n0\nEOF\n",
  ].join("");
}

describe("regression: per-part CUT contours emitted as LWPOLYLINE entities", () => {
  it("gabrovo: 1 instance produces a single closed LWPOLYLINE", () => {
    const part = makePart("jx743me73n9e80t30am5gdnq19853wa4");
    const placement: Placement = {
      partId: part.id,
      instanceIndex: 0,
      packX: 35,
      packY: 35,
      packWidth: part.cutWidth,
      packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [placement]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    // eslint-disable-next-line no-console
    console.log(`1 instance: ${polylines.length} LWPOLYLINE entities, ${lines.length} LINE entities`);
    // Should have exactly 1 LWPOLYLINE entity (one per part, closed)
    expect(polylines.length).toBe(1);
    expect(polylines[0].closed).toBe(true);
    // No standalone LINE entities on CUT (nothing to dedupe with 1 part)
    expect(lines.length).toBe(0);
  });

  it("gabrovo: 2 instances side-by-side produce TWO LWPOLYLINE entities (no cross-part stitching)", () => {
    const part = makePart("jx743me73n9e80t30am5gdnq19853wa4");
    const p1: Placement = {
      partId: part.id, instanceIndex: 0,
      packX: 35, packY: 35,
      packWidth: part.cutWidth, packHeight: part.cutHeight,
      rotation: 0,
    };
    const p2: Placement = {
      partId: part.id, instanceIndex: 1,
      packX: 35 + part.cutWidth, packY: 35,
      packWidth: part.cutWidth, packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [p1, p2]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    // eslint-disable-next-line no-console
    console.log(`2 instances side-by-side: ${polylines.length} LWPOLYLINE, ${lines.length} LINE`);

    // Each part has its own closed LWPOLYLINE (no cross-part stitching at the polyline level)
    expect(polylines.length).toBe(2);
    for (const p of polylines) {
      expect(p.closed).toBe(true);
    }
    expect(lines.length).toBe(0);
  });

  it("gabrovo: 2 instances with a gap — no cross-part OVERKILL happens", () => {
    const part = makePart("jx743me73n9e80t30am5gdnq19853wa4");
    const GAP = 50;
    const p1: Placement = {
      partId: part.id, instanceIndex: 0,
      packX: 35, packY: 35,
      packWidth: part.cutWidth, packHeight: part.cutHeight,
      rotation: 0,
    };
    const p2: Placement = {
      partId: part.id, instanceIndex: 1,
      packX: 35 + part.cutWidth + GAP, packY: 35,
      packWidth: part.cutWidth, packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [p1, p2]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    // eslint-disable-next-line no-console
    console.log(`2 instances with gap: ${polylines.length} LWPOLYLINE, ${lines.length} LINE`);

    // Each part has its own polyline, no shared edges, no cross-part dedup
    expect(polylines.length).toBe(2);
    expect(lines.length).toBe(0);

    // Each LWPOLYLINE should be the full polyline (16+1=17 points for gabrovo)
    for (const p of polylines) {
      expect(p.closed).toBe(true);
      expect(p.points.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("gabrovo: 5x gabrovo in a vertical stack — each part has a closed LWPOLYLINE", () => {
    // Simulate the user's "5 parts" scenario
    const part = makePart("jx743me73n9e80t30am5gdnq19853wa4");
    const placements: Placement[] = [];
    for (let i = 0; i < 5; i++) {
      placements.push({
        partId: part.id,
        instanceIndex: i,
        packX: 35,
        packY: 35 + i * part.cutHeight,
        packWidth: part.cutWidth,
        packHeight: part.cutHeight,
        rotation: 0,
      });
    }
    const layout = makeLayout(part, placements);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    // eslint-disable-next-line no-console
    console.log(`5x gabrovo: ${polylines.length} LWPOLYLINE, ${lines.length} LINE`);

    // 5 LWPOLYLINE entities (one per part, each closed)
    expect(polylines.length).toBe(5);
    for (const p of polylines) {
      expect(p.closed).toBe(true);
    }
  });

  it("double V-notch formula: project import preserves source CUT order", () => {
    const part = makeDoubleVNotchPart();
    const placement: Placement = {
      partId: part.id,
      instanceIndex: 0,
      packX: 35,
      packY: 35,
      packWidth: part.cutWidth,
      packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [placement]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    expect(polylines.length).toBe(1);
    expect(lines.length).toBe(0);
    expectPolylineFollowsCutLineOrder(polylines[0], part, placement, layout);
  });

  it("double V-notch formula: custom DXF import preserves source CUT order", () => {
    const part = makeDoubleVNotchCustomDxfPart();
    const placement: Placement = {
      partId: part.id,
      instanceIndex: 0,
      packX: 35,
      packY: 35,
      packWidth: part.cutWidth,
      packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [placement]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const { polylines, lines } = extractCutEntities(dxf);

    expect(polylines.length).toBe(1);
    expect(lines.length).toBe(0);
    expectPolylineFollowsCutLineOrder(polylines[0], part, placement, layout);
  });

  it("double V-notch formula: AutoCAD-compatible nested POLYLINE re-import preserves CUT segments", () => {
    const part = makeDoubleVNotchPart();
    const placement: Placement = {
      partId: part.id,
      instanceIndex: 0,
      packX: 35,
      packY: 35,
      packWidth: part.cutWidth,
      packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [placement]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const parsed = parseDxfContent(dxf);

    expect(parsed).not.toBeNull();
    expect(parsed!.cutLines.length).toBe(part.cutLines.length);
  });

  it("custom DXF import keeps CUT 3mm from Layer 0 when raw Layer 0 origin is shifted", () => {
    const parsed = parseDxfContent(shiftedRectangleDxf());
    expect(parsed).not.toBeNull();
    expect(parsed!.l0Bbox).toEqual({ x0: 100, y0: 200, x1: 200, y1: 250 });
    expect(parsed!.cutLines[0]).toEqual({ x1: -3, y1: -3, x2: 103, y2: -3 });

    const part = createNestPart({
      id: "shifted-custom-dxf",
      name: "shifted-custom-dxf",
      filename: "shifted-custom-dxf_T_x1",
      direction: "T",
      count: 1,
      source: "custom-dxf",
      l0Width: parsed!.l0Width,
      l0Height: parsed!.l0Height,
      l0Bbox: parsed!.l0Bbox,
      cutLines: parsed!.cutLines,
      dxfContent: shiftedRectangleDxf(),
    });
    const placement: Placement = {
      partId: part.id,
      instanceIndex: 0,
      packX: 35,
      packY: 35,
      packWidth: part.cutWidth,
      packHeight: part.cutHeight,
      rotation: 0,
    };
    const layout = makeLayout(part, [placement]);
    const dxf = writeNestSheetDxf(layout, [part]);
    const l0Bbox = bboxOfLines(extractLineEntitiesByLayer(dxf, "0"));
    const { polylines } = extractCutEntities(dxf);
    expect(polylines.length).toBe(1);
    const cutBbox = bboxOfPoints(polylines[0].points);

    expect(l0Bbox).toEqual({ x0: 38, y0: 38, x1: 138, y1: 88 });
    expect(cutBbox).toEqual({ x0: 35, y0: 35, x1: 141, y1: 91 });
    expect(l0Bbox.x0 - cutBbox.x0).toBe(CUT_OFFSET);
    expect(l0Bbox.y0 - cutBbox.y0).toBe(CUT_OFFSET);
    expect(cutBbox.x1 - l0Bbox.x1).toBe(CUT_OFFSET);
    expect(cutBbox.y1 - l0Bbox.y1).toBe(CUT_OFFSET);
  });
});
