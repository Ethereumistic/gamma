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
import { createNestPartFromDesign } from "@/features/nesting/dxf-reader";
import { writeNestSheetDxf } from "@/features/nesting/dxf-writer";
import type { Placement, SheetLayout, NestPart } from "@/features/nesting/types";
import { PRODUCTION_DESIGNS } from "../sheet-metal/__fixtures__/production-designs";

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

type LwPolyline = {
  layer: string;
  points: Array<{ x: number; y: number }>;
  closed: boolean;
};

type Line = {
  layer: string;
  x1: number; y1: number; x2: number; y2: number;
};

/** Parse LWPOLYLINE and LINE entities from a DXF string on the CUT layer. */
function extractCutEntities(dxf: string): { polylines: LwPolyline[]; lines: Line[] } {
  const polylines: LwPolyline[] = [];
  const lines: Line[] = [];

  const text = dxf.split(/\r?\n/);
  let i = 0;
  let curEntity: "LWPOLYLINE" | "LINE" | null = null;
  let curLayer = "";
  let curNumVerts = 0;
  let curClosed = false;
  let curPoints: Array<{ x: number; y: number }> = [];
  let curX = NaN, curY = NaN;
  let curX1 = NaN, curY1 = NaN, curX2 = NaN, curY2 = NaN;
  // For LWPOLYLINE, we need to track when we've read all the (10, 20) pairs.
  // For LINE, we need to track 10/11/20/21.

  while (i < text.length - 1) {
    const code = text[i].trim();
    const val = text[i + 1].trim();
    i += 2;

    if (code === "0") {
      // Flush previous entity
      if (curEntity === "LWPOLYLINE" && curLayer === "CUT") {
        if (curPoints.length > 0) {
          polylines.push({ layer: "CUT", points: curPoints, closed: curClosed });
        }
      } else if (curEntity === "LINE" && curLayer === "CUT") {
        if (!Number.isNaN(curX1) && !Number.isNaN(curY1) && !Number.isNaN(curX2) && !Number.isNaN(curY2)) {
          lines.push({ layer: "CUT", x1: curX1, y1: curY1, x2: curX2, y2: curY2 });
        }
      }
      // Start new entity
      if (val === "LWPOLYLINE") {
        curEntity = "LWPOLYLINE";
        curLayer = "";
        curNumVerts = 0;
        curClosed = false;
        curPoints = [];
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
      else if (code === "90") curNumVerts = parseInt(val, 10);
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
    } else if (curEntity === "LINE") {
      if (code === "8") curLayer = val;
      else if (code === "10") curX1 = Number(val);
      else if (code === "20") curY1 = Number(val);
      else if (code === "11") curX2 = Number(val);
      else if (code === "21") curY2 = Number(val);
    }
  }
  // Flush last entity
  if (curEntity === "LWPOLYLINE" && curLayer === "CUT") {
    if (curPoints.length > 0) {
      polylines.push({ layer: "CUT", points: curPoints, closed: curClosed });
    }
  } else if (curEntity === "LINE" && curLayer === "CUT") {
    if (!Number.isNaN(curX1) && !Number.isNaN(curY1) && !Number.isNaN(curX2) && !Number.isNaN(curY2)) {
      lines.push({ layer: "CUT", x1: curX1, y1: curY1, x2: curX2, y2: curY2 });
    }
  }
  return { polylines, lines };
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
      expect(p.points.length).toBeGreaterThanOrEqual(16);
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
});
