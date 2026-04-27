/**
 * geometry/region.test.ts — Unit tests for MetalRegion polygon abstraction.
 */

import { describe, it, expect } from "vitest";
import {
  buildMetalRegion,
  isPointInside,
  isOnBoundary,
  clipSegment,
  clipFrezLine,
  type Point,
  type Polygon,
} from "./region";
import type { HorizontalNotch, VerticalNotch } from "./notches";
import type { LineShape } from "@/features/sheet-metal/types";

// Helpers
const noNotches = {
  topNotches: [] as HorizontalNotch[],
  bottomNotches: [] as HorizontalNotch[],
  leftNotches: [] as VerticalNotch[],
  rightNotches: [] as VerticalNotch[],
};

function rect(left: number, bottom: number, right: number, top: number) {
  return {
    outerLeft: left,
    outerBottom: bottom,
    outerRight: right,
    outerTop: top,
    ...noNotches,
  };
}

// ---------------------------------------------------------------------------
// buildMetalRegion
// ---------------------------------------------------------------------------

describe("buildMetalRegion", () => {
  it("returns outer rectangle when no notches", () => {
    const poly = buildMetalRegion(rect(0, 0, 100, 100));
    // Should be a 4-point rectangle (CCW)
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // First point ≈ bottom-left
    expect(poly[0].x).toBeCloseTo(0);
    expect(poly[0].y).toBeCloseTo(0);
  });

  it("indents top edge with a single notch", () => {
    const topNotch: HorizontalNotch = {
      apexX: 50,
      apexY: 100, // on the top edge
      shoulderY: 60, // V-cut dips down to y=60
    };
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [topNotch],
      bottomNotches: [],
      leftNotches: [],
      rightNotches: [],
    });

    // Check that there's a point at the V-apex (apexX=50, shoulderY=60)
    const hasApexPoint = poly.some(
      p => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 60) < 1e-6,
    );
    expect(hasApexPoint).toBe(true);
  });

  it("indents bottom edge with a single notch", () => {
    const bottomNotch: HorizontalNotch = {
      apexX: 50,
      apexY: 0, // on the bottom edge
      shoulderY: 40, // V-cut dips up to y=40
    };
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [],
      bottomNotches: [bottomNotch],
      leftNotches: [],
      rightNotches: [],
    });

    const hasApexPoint = poly.some(
      p => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 40) < 1e-6,
    );
    expect(hasApexPoint).toBe(true);
  });

  it("indents left edge with a vertical notch", () => {
    const leftNotch: VerticalNotch = {
      apexX: 0,
      apexY: 50,
      shoulderX: 40, // V-cut extends rightward to x=40
    };
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [],
      bottomNotches: [],
      leftNotches: [leftNotch],
      rightNotches: [],
    });

    const hasApexPoint = poly.some(
      p => Math.abs(p.x - 40) < 1e-6 && Math.abs(p.y - 50) < 1e-6,
    );
    expect(hasApexPoint).toBe(true);
  });

  it("indents right edge with a vertical notch", () => {
    const rightNotch: VerticalNotch = {
      apexX: 100,
      apexY: 50,
      shoulderX: 60, // V-cut extends leftward to x=60
    };
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [],
      bottomNotches: [],
      leftNotches: [],
      rightNotches: [rightNotch],
    });

    const hasApexPoint = poly.some(
      p => Math.abs(p.x - 60) < 1e-6 && Math.abs(p.y - 50) < 1e-6,
    );
    expect(hasApexPoint).toBe(true);
  });

  it("handles vertical notch with flap", () => {
    const leftNotch: VerticalNotch = {
      apexX: 0,
      apexY: 50,
      shoulderX: 40,
      flap: 10,
    };
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [],
      bottomNotches: [],
      leftNotches: [leftNotch],
      rightNotches: [],
    });

    // With flap, should have a flat bottom region at the V indent
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // The shoulder x value should appear in the polygon
    const hasShoulderX = poly.some(p => Math.abs(p.x - 40) < 1e-6);
    expect(hasShoulderX).toBe(true);
  });

  it("merges overlapping notches on the same edge", () => {
    // Two top-edge notches that overlap:
    // Notch A: apexX=30, apexY=100, shoulderY=60 → shoulders at x=10..50
    // Notch B: apexX=50, apexY=100, shoulderY=70 → shoulders at x=30..70
    // Overlap region: x=30..50
    const poly = buildMetalRegion({
      outerLeft: 0,
      outerBottom: 0,
      outerRight: 100,
      outerTop: 100,
      topNotches: [
        { apexX: 30, apexY: 100, shoulderY: 60 },
        { apexX: 50, apexY: 100, shoulderY: 70 },
      ],
      bottomNotches: [],
      leftNotches: [],
      rightNotches: [],
    });

    // The polygon should not self-intersect — the deeper notch dominates
    // in the overlap region. At x=40 (overlap midpoint), notch A boundary
    // = 60 + (10/40)*40 = 70, notch B boundary = 70 + (10/30)*30 = 80.
    // The deeper boundary (further from edgeY=100) is 70 (from notch A).
    // The polygon should be valid (non-self-intersecting).
    expect(poly.length).toBeGreaterThanOrEqual(4);

    // A point inside the polygon but below both notches should be inside
    expect(isPointInside(poly, { x: 40, y: 55 })).toBe(true);
    // A point above the merged notch boundary in overlap should be outside
    expect(isPointInside(poly, { x: 40, y: 85 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPointInside
// ---------------------------------------------------------------------------

describe("isPointInside", () => {
  it("returns true for point inside rectangle", () => {
    const poly: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(isPointInside(poly, { x: 50, y: 50 })).toBe(true);
  });

  it("returns false for point outside rectangle", () => {
    const poly: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(isPointInside(poly, { x: 150, y: 50 })).toBe(false);
  });

  it("returns true for point inside concave polygon with V-notch", () => {
    // Rectangle with a V-notch on the top edge
    // The top edge has a dip at x=50 from y=100 to y=80
    const poly: Polygon = [
      { x: 0, y: 0 },       // bottom-left
      { x: 100, y: 0 },     // bottom-right
      { x: 100, y: 100 },   // right-top corner
      { x: 60, y: 100 },    // right shoulder of notch
      { x: 50, y: 80 },     // V-notch apex
      { x: 40, y: 100 },    // left shoulder of notch
      { x: 0, y: 100 },     // left-top corner
    ];
    // Point at (50, 90) — inside the rectangle but ABOVE the notch apex (y=80 < 90 < 100)
    // This point should be OUTSIDE (the notch cut it out)
    expect(isPointInside(poly, { x: 50, y: 90 })).toBe(false);
    // Point at (50, 70) — below the notch — should be inside
    expect(isPointInside(poly, { x: 50, y: 70 })).toBe(true);
    // Point at (30, 95) — on the top edge but away from notch — inside
    expect(isPointInside(poly, { x: 30, y: 95 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clipSegment
// ---------------------------------------------------------------------------

describe("clipSegment", () => {
  const rectangle: Polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("keeps a segment fully inside the rectangle", () => {
    const segs = clipSegment(rectangle, { x: 10, y: 10 }, { x: 90, y: 10 });
    expect(segs).toHaveLength(1);
    expect(segs[0].p1.x).toBeCloseTo(10);
    expect(segs[0].p2.x).toBeCloseTo(90);
  });

  it("clips a segment that goes outside the rectangle", () => {
    const segs = clipSegment(rectangle, { x: -10, y: 10 }, { x: 110, y: 10 });
    expect(segs).toHaveLength(1);
    expect(segs[0].p1.x).toBeCloseTo(0);
    expect(segs[0].p2.x).toBeCloseTo(100);
  });

  it("returns empty for a segment fully outside", () => {
    const segs = clipSegment(rectangle, { x: 110, y: 10 }, { x: 150, y: 10 });
    expect(segs).toHaveLength(0);
  });

  it("clips horizontal line through a V-notch", () => {
    // Rectangle with a V-notch on the top edge
    const notchedRect: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 60, y: 100 },
      { x: 50, y: 80 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];

    // Horizontal line at y=90 (above the notch apex at y=80)
    // Should get TWO segments with a gap at the notch
    const segs = clipSegment(notchedRect, { x: 0, y: 90 }, { x: 100, y: 90 });
    expect(segs.length).toBeGreaterThanOrEqual(2);

    // Line at y=70 (below the notch) should be intact
    const segs70 = clipSegment(notchedRect, { x: 0, y: 70 }, { x: 100, y: 70 });
    expect(segs70).toHaveLength(1);
    expect(segs70[0].p1.x).toBeCloseTo(0);
    expect(segs70[0].p2.x).toBeCloseTo(100);
  });

  it("clips diagonal line against V-notch", () => {
    const notchedRect: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 60, y: 100 },
      { x: 50, y: 80 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];

    // Diagonal from bottom-left to top-right
    const segs = clipSegment(notchedRect, { x: 0, y: 0 }, { x: 100, y: 100 });
    // Should exist (at least one segment)
    expect(segs.length).toBeGreaterThanOrEqual(1);
    // Check that no segment endpoint falls inside the notch void
    for (const seg of segs) {
      expect(isPointInside(notchedRect, {
        x: (seg.p1.x + seg.p2.x) / 2,
        y: (seg.p1.y + seg.p2.y) / 2,
      })).toBe(true);
    }
  });

  it("returns single segment for degenerate polygon (< 3 points)", () => {
    const tiny: Polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const segs = clipSegment(tiny, { x: 10, y: 10 }, { x: 90, y: 10 });
    // Less than 3 points → returns original segment unclipped
    expect(segs).toHaveLength(1);
    expect(segs[0].p1.x).toBe(10);
    expect(segs[0].p2.x).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// clipFrezLine
// ---------------------------------------------------------------------------

describe("clipFrezLine", () => {
  it("emits FREZ layer lines", () => {
    const shapes: LineShape[] = [];
    const poly: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    clipFrezLine(shapes, "FREZ", 10, 50, 90, 50, poly);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].layer).toBe("FREZ");
    expect(shapes[0].x1).toBeCloseTo(10);
    expect(shapes[0].x2).toBeCloseTo(90);
  });
});