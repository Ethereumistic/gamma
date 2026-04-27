/**
 * geometry/edges.test.ts — Unit tests for CUT edge drawing and span clipping.
 */

import { describe, expect, it } from "vitest";
import { addHorizontalCutEdge, addVerticalCutEdge, clipHorizontalSpan, clipVerticalSpan } from "./edges";
import type { HorizontalNotch, VerticalNotch } from "./notches";
import type { LineShape } from "@/features/sheet-metal/types";

// ---------------------------------------------------------------------------
// addHorizontalCutEdge
// ---------------------------------------------------------------------------

describe("addHorizontalCutEdge", () => {
  it("draws a single horizontal line with no notches", () => {
    const shapes: LineShape[] = [];
    addHorizontalCutEdge(shapes, 100, 0, 200, []);
    expect(shapes.length).toBe(1);
    expect(shapes[0]).toEqual({ type: "line", layer: "CUT", x1: 0, y1: 100, x2: 200, y2: 100 });
  });

  it("draws a V-indent on the top edge for a bottom notch", () => {
    // Bottom edge at y=0, notch opens upward
    // Notch: apexX=100, apexY=0 (on edge), shoulderY=40 (deeper)
    const shapes: LineShape[] = [];
    const notch: HorizontalNotch = { apexX: 100, apexY: 0, shoulderY: 40 };
    addHorizontalCutEdge(shapes, 0, 0, 200, [notch]);
    // Should produce multiple lines: flat + diagonal + diagonal + flat
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    // All lines should be on CUT layer
    for (const s of shapes) {
      expect(s.layer).toBe("CUT");
    }
    // First line starts at (0, 0)
    expect(shapes[0].x1).toBe(0);
    expect(shapes[0].y1).toBeCloseTo(0);
  });

  it("handles multiple non-overlapping notches", () => {
    const shapes: LineShape[] = [];
    const n1: HorizontalNotch = { apexX: 50, apexY: 0, shoulderY: 20 };
    const n2: HorizontalNotch = { apexX: 150, apexY: 0, shoulderY: 20 };
    addHorizontalCutEdge(shapes, 0, 0, 200, [n1, n2]);
    expect(shapes.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// addVerticalCutEdge
// ---------------------------------------------------------------------------

describe("addVerticalCutEdge", () => {
  it("draws a single vertical line with no notches", () => {
    const shapes: LineShape[] = [];
    addVerticalCutEdge(shapes, 0, 200, 0, []);
    expect(shapes.length).toBe(1);
    expect(shapes[0]).toEqual({ type: "line", layer: "CUT", x1: 0, y1: 200, x2: 0, y2: 0 });
  });

  it("draws a V-indent on the right edge", () => {
    const shapes: LineShape[] = [];
    const notch: VerticalNotch = { apexX: 100, apexY: 100, shoulderX: 40 };
    addVerticalCutEdge(shapes, 100, 200, 0, [notch]);
    expect(shapes.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// clipHorizontalSpan
// ---------------------------------------------------------------------------

describe("clipHorizontalSpan", () => {
  it("returns full span when no notches", () => {
    const result = clipHorizontalSpan(100, 0, 200, [], []);
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(200);
  });

  it("clips from left when left notch apex is above edge", () => {
    // Left notch at apexX=100, apexY=150 (above yEdge=100), shoulderX=60 (shoulderOff=40)
    // dist = 150-100 = 50 → dist > shoulderOff(40), skip
    // Need dist < shoulderOff: use apexY=130, dist=30, shoulderOff=40
    const result = clipHorizontalSpan(100, 0, 200, [{ apexX: 100, apexY: 130, shoulderX: 60 }], []);
    // dist=30 < shoulderOff=40 ✓
    // xIntersect = apexX - (dist + D) = 100 - 30 = 70
    // clippedStart = max(0, 70) = 70
    expect(result.startX).toBe(70);
    expect(result.endX).toBe(200);
  });

  it("clips from left when left notch apex is below edge", () => {
    // Second loop: yEdge(100) > apexY(50)
    // Left notch at apexX=100, apexY=50, shoulderX=60 (shoulderOff=40)
    const result = clipHorizontalSpan(100, 0, 200, [{ apexX: 100, apexY: 50, shoulderX: 60 }], []);
    // dist = yEdge - apexY = 100-50 = 50, shoulderOff=40 → dist > shoulderOff, skip
    // Need dist < shoulderOff: use apexY=70, dist=30, shoulderOff=40
    const result2 = clipHorizontalSpan(100, 0, 200, [{ apexX: 100, apexY: 70, shoulderX: 60 }], []);
    // dist=30 < 40 ✓, xIntersect = 100 - 30 = 70
    expect(result2.startX).toBe(70);
    expect(result2.endX).toBe(200);
  });

  it("clips from right when right notch apex is above edge", () => {
    // Right notch at apexX=100, apexY=130, shoulderX=140 (shoulderOff=40)
    const result = clipHorizontalSpan(100, 0, 200, [], [{ apexX: 100, apexY: 130, shoulderX: 140 }]);
    // dist = 130-100 = 30 < 40 ✓
    // xIntersect = apexX + (dist+D) = 100 + 30 = 130
    // clippedEnd = min(200, 130) = 130
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(130);
  });

  it("does not clip when notch is too far away", () => {
    // Left notch with dist > shoulderOff → outside influence
    const result = clipHorizontalSpan(100, 0, 200, [{ apexX: 100, apexY: 200, shoulderX: 70 }], []);
    // dist = 200-100 = 100, shoulderOff = 30 → dist > shoulderOff, skip
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// clipVerticalSpan
// ---------------------------------------------------------------------------

describe("clipVerticalSpan", () => {
  it("returns full span when no notches", () => {
    const result = clipVerticalSpan(100, 200, 0, [], []);
    expect(result.startY).toBe(200);
    expect(result.endY).toBe(0);
  });

  it("clips from top when top notch intersects", () => {
    // Top notch at apexX=150 (right of xEdge=100), apexY=130, shoulderY=90 (shoulderOff=40)
    // dist = apexX - xEdge = 150-100 = 50 → dist > shoulderOff(40), skip
    // Need dist < shoulderOff: use apexX=130, dist=30
    const result = clipVerticalSpan(100, 200, 0, [{ apexX: 130, apexY: 130, shoulderY: 90 }], []);
    // dist=30 < 40 ✓
    // yIntersect = apexY + (dist + D) = 130 + 30 = 160
    // clippedStart = min(200, 160) = 160
    expect(result.startY).toBe(160);
    expect(result.endY).toBe(0);
  });

  it("clips from bottom when bottom notch intersects", () => {
    // Bottom notch at apexX=130, apexY=50, shoulderY=90 (shoulderOff=40)
    // dist = apexX - xEdge = 130-100 = 30 < 40 ✓
    // yIntersect = apexY - (dist+D) = 50 - 30 = 20
    // clippedEnd = max(0, 20) = 20
    const result = clipVerticalSpan(100, 200, 0, [], [{ apexX: 130, apexY: 50, shoulderY: 90 }]);
    expect(result.startY).toBe(200);
    expect(result.endY).toBe(20);
  });

  it("does not clip when notch is too far away", () => {
    const result = clipVerticalSpan(100, 200, 0, [{ apexX: 200, apexY: 100, shoulderY: 60 }], []);
    // dist = 200-100 = 100, shoulderOff=40 → skip
    expect(result.startY).toBe(200);
    expect(result.endY).toBe(0);
  });

  it("clips from right side (xEdge right of apexX) on top notch", () => {
    // Right-side loop: xEdge - apexX = dist, so xEdge > apexX
    // Top notch at apexX=70, xEdge=100, dist=30, shoulderOff=40
    // yIntersect = apexY + (dist + D) = 130 + 30 = 160
    const result = clipVerticalSpan(100, 200, 0, [{ apexX: 70, apexY: 130, shoulderY: 90 }], []);
    expect(result.startY).toBe(160);
    expect(result.endY).toBe(0);
  });

  it("clips from right side on bottom notch", () => {
    // Bottom notch with xEdge > apexX
    // apexX=70, xEdge=100, dist=30, shoulderOff=40
    // yIntersect = apexY - (dist+D) = 50 - 30 = 20
    const result = clipVerticalSpan(100, 200, 0, [], [{ apexX: 70, apexY: 50, shoulderY: 90 }]);
    expect(result.startY).toBe(200);
    expect(result.endY).toBe(20);
  });
});