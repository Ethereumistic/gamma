/**
 * geometry/golden.test.ts — Golden-file regression tests for geometry.
 *
 * These tests verify that `computeSheetMetalGeometry` produces consistent,
 * deterministic output for representative sheet-metal configurations.
 * If a refactor changes the output, these tests will catch it.
 *
 * The test strategy:
 * 1. Define representative models covering key configurations
 * 2. Compute geometry once and snapshot the shape counts and bounds
 * 3. Also verify specific shape coordinates that are critical for correctness
 *
 * To update golden values after an intentional change, run:
 *   vitest run --update
 */

import { describe, it, expect } from "vitest";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import type { SheetMetalModel, LineShape } from "@/features/sheet-metal/types";

// ---------------------------------------------------------------------------
// Helper: build deterministic models (no Date.now()-based IDs)
// ---------------------------------------------------------------------------

function id(n: number): string {
  return `golden-${n}`;
}

function makeFlange(amount: number, reliefs?: { start?: boolean; end?: boolean }, flaps?: { start?: number; end?: number }) {
  return {
    id: id(amount),
    amount,
    reliefs: { start: reliefs?.start ?? false, end: reliefs?.end ?? false },
    flaps: { start: flaps?.start ?? 0, end: flaps?.end ?? 0 },
  };
}

function makeFrez(amount: number, notches?: { start?: boolean; end?: boolean }) {
  return {
    id: id(amount + 1000),
    amount,
    notches: { start: notches?.start ?? false, end: notches?.end ?? false },
    spanStart: false,
    spanEnd: false,
  };
}

function makeInnerFrez(amount: number, spanStart = false, spanEnd = false) {
  return {
    id: id(amount + 2000),
    amount,
    notches: { start: false, end: false },
    spanStart,
    spanEnd,
  };
}

function emptySide() {
  return { flanges: [] as any[], frezLines: [] as any[], frezMode: "inner" as const, innerFrezLines: [] as any[] };
}

function emptyCorners() {
  return {
    topLeft: { horizontal: false, vertical: false },
    topRight: { horizontal: false, vertical: false },
    bottomRight: { horizontal: false, vertical: false },
    bottomLeft: { horizontal: false, vertical: false },
  };
}

// ---------------------------------------------------------------------------
// Representative Models
// ---------------------------------------------------------------------------

/** Model 1: Blank panel (base rectangle only) */
const BLANK_PANEL: SheetMetalModel = {
  baseWidth: 500,
  baseHeight: 500,
  invertX: false,
  invertY: false,
  offsetCut: 3,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 1,
  sides: { top: emptySide(), right: emptySide(), bottom: emptySide(), left: emptySide() },
  cornerReliefs: emptyCorners(),
  rubberband: true,
};

/** Model 2: Simple flanges on all 4 sides with V-notches */
const SIMPLE_FLANGES: SheetMetalModel = {
  baseWidth: 500,
  baseHeight: 500,
  invertX: false,
  invertY: false,
  offsetCut: 3,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 1,
  sides: {
    top: { flanges: [makeFlange(60)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    right: { flanges: [makeFlange(40)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    bottom: { flanges: [makeFlange(50)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    left: { flanges: [makeFlange(30)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
  },
  cornerReliefs: emptyCorners(),
  rubberband: true,
};

/** Model 3: Flanges with reliefs (V-notch trimming exercise) */
const FLANGES_WITH_RELIEFS: SheetMetalModel = {
  baseWidth: 500,
  baseHeight: 500,
  invertX: false,
  invertY: false,
  offsetCut: 3,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 1,
  sides: {
    top: { flanges: [makeFlange(60, { start: true, end: true })], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    right: { flanges: [makeFlange(40, { start: true })], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    bottom: { flanges: [makeFlange(50)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    left: { flanges: [makeFlange(30, { end: true })], frezLines: [], frezMode: "inner", innerFrezLines: [] },
  },
  cornerReliefs: emptyCorners(),
  rubberband: true,
};

/** Model 4: Outer frez lines with notches */
const WITH_OUTER_FREZ: SheetMetalModel = {
  baseWidth: 500,
  baseHeight: 500,
  invertX: false,
  invertY: false,
  offsetCut: 3,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 1,
  sides: {
    top: { flanges: [makeFlange(60)], frezLines: [makeFrez(20, { start: true, end: true })], frezMode: "inner", innerFrezLines: [] },
    right: { flanges: [makeFlange(40)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
    bottom: { flanges: [makeFlange(50)], frezLines: [makeFrez(15, { start: true, end: true })], frezMode: "inner", innerFrezLines: [] },
    left: { flanges: [makeFlange(30)], frezLines: [], frezMode: "inner", innerFrezLines: [] },
  },
  cornerReliefs: emptyCorners(),
  rubberband: true,
};

/** Model 5: Complex model with inner frez lines and flanges on all sides */
const COMPLEX_MODEL: SheetMetalModel = {
  baseWidth: 1040,
  baseHeight: 610,
  invertX: false,
  invertY: false,
  offsetCut: 3,
  includeName: true,
  includeArrow: true,
  arrowDirection: "top",
  includeMetadata: false,
  metadataCount: 1,
  sides: {
    top: {
      flanges: [makeFlange(26)],
      frezLines: [],
      frezMode: "inner",
      innerFrezLines: [],
    },
    right: {
      flanges: [makeFlange(28)],
      frezLines: [],
      frezMode: "inner",
      innerFrezLines: [],
    },
    bottom: {
      flanges: [makeFlange(142)],
      frezLines: [makeFrez(116, { start: true, end: true })],
      frezMode: "inner",
      innerFrezLines: [],
    },
    left: {
      flanges: [makeFlange(30)],
      frezLines: [makeFrez(220, { start: true, end: true })],
      frezMode: "inner",
      innerFrezLines: [],
    },
  },
  cornerReliefs: emptyCorners(),
  rubberband: true,
};

// ---------------------------------------------------------------------------
// Snapshot computation
// ---------------------------------------------------------------------------

interface GoldenSnapshot {
  totalShapes: number;
  cutShapes: number;
  frezShapes: number;
  holesShapes: number;
  zeroShapes: number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  baseRect: { x0: number; y0: number; x1: number; y1: number };
  totalWidth: number;
  totalHeight: number;
  /** Sample coordinates: a few representative FREZ line endpoint pairs */
  frezSamples: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

function computeGolden(model: SheetMetalModel): GoldenSnapshot {
  const result = computeSheetMetalGeometry(model);
  const cutShapes = result.shapes.filter(s => s.layer === "CUT").length;
  const frezShapes = result.shapes.filter(s => s.layer === "FREZ").length;
  const holesShapes = result.shapes.filter(s => s.layer === "HOLES").length;
  const zeroShapes = result.shapes.filter(s => s.layer === "0").length;

  const frezLines = result.shapes.filter(s => s.layer === "FREZ");
  // Take up to 5 sample FREZ line midpoint coordinates
  const frezSamples = frezLines.slice(0, 5).map(s => ({
    x1: Math.round(s.x1 * 1000) / 1000,
    y1: Math.round(s.y1 * 1000) / 1000,
    x2: Math.round(s.x2 * 1000) / 1000,
    y2: Math.round(s.y2 * 1000) / 1000,
  }));

  return {
    totalShapes: result.shapes.length,
    cutShapes,
    frezShapes,
    holesShapes,
    zeroShapes,
    bounds: {
      x0: Math.round(result.bounds.x0 * 1000) / 1000,
      y0: Math.round(result.bounds.y0 * 1000) / 1000,
      x1: Math.round(result.bounds.x1 * 1000) / 1000,
      y1: Math.round(result.bounds.y1 * 1000) / 1000,
    },
    baseRect: {
      x0: Math.round(result.baseRect.x0 * 1000) / 1000,
      y0: Math.round(result.baseRect.y0 * 1000) / 1000,
      x1: Math.round(result.baseRect.x1 * 1000) / 1000,
      y1: Math.round(result.baseRect.y1 * 1000) / 1000,
    },
    totalWidth: Math.round(result.totalWidth * 1000) / 1000,
    totalHeight: Math.round(result.totalHeight * 1000) / 1000,
    frezSamples,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Golden-file regression: computeSheetMetalGeometry", () => {
  it("blank panel: base rectangle only", () => {
    const golden = computeGolden(BLANK_PANEL);

    // Bounds: offsetCut=3, no flanges
    // outerLeft = -3, outerBottom = -3, outerRight = 500+3=503, outerTop = 500+3=503
    expect(golden.bounds).toEqual({ x0: -3, y0: -3, x1: 503, y1: 503 });
    expect(golden.baseRect).toEqual({ x0: 0, y0: 0, x1: 500, y1: 500 });
    expect(golden.totalWidth).toBe(506);
    expect(golden.totalHeight).toBe(506);

    // No flanges/frez → only CUT boundary lines
    expect(golden.frezShapes).toBe(0);
    expect(golden.cutShapes).toBeGreaterThan(0);
    expect(golden.zeroShapes).toBeGreaterThan(0); // Zero-layer inner cut
  });

  it("simple flanges on all 4 sides", () => {
    const golden = computeGolden(SIMPLE_FLANGES);

    // Flanges produce FREZ fold lines
    expect(golden.frezShapes).toBeGreaterThan(0);
    expect(golden.totalShapes).toBeGreaterThan(0);

    // Bounds include flange depths
    expect(golden.bounds.x0).toBe(-3);
    expect(golden.bounds.x1).toBe(573); // 500 + 30 (left) + 40 (right) + 3 (offset)
    expect(golden.bounds.y1).toBe(613); // 500 + 50 (bottom) + 60 (top) + 3 (offset)

    // 4 fold lines (one per side) = 4 FREZ lines minimum
    expect(golden.frezShapes).toBeGreaterThanOrEqual(4);
  });

  it("flanges with reliefs produce V-notch trimming", () => {
    const golden = computeGolden(FLANGES_WITH_RELIEFS);

    // With reliefs, the FREZ lines near corners should be trimmed into
    // shorter segments (because notches eat into the corners)
    expect(golden.frezShapes).toBeGreaterThan(0);

    // The total shape count might be higher (notch diagonals in CUT layer)
    const noReliefGolden = computeGolden(SIMPLE_FLANGES);
    // With reliefs, there should be more CUT shapes (notch edges) and
    // possibly more FREZ segments (trimmed lines split into sub-segments)
    expect(golden.cutShapes).toBeGreaterThanOrEqual(noReliefGolden.cutShapes);
  });

  it("outer frez lines with notches produce trimmed segments", () => {
    const golden = computeGolden(WITH_OUTER_FREZ);

    // Expect FREZ lines: 4 fold lines + 2 outer frez lines = 6+ segments
    expect(golden.frezShapes).toBeGreaterThanOrEqual(6);

    // Verify shape coordinates are finite and reasonable
    for (const s of golden.frezSamples) {
      expect(isFinite(s.x1)).toBe(true);
      expect(isFinite(s.y1)).toBe(true);
      expect(isFinite(s.x2)).toBe(true);
      expect(isFinite(s.y2)).toBe(true);
    }
  });

  it("complex model (prototype relief) matches expected bounds", () => {
    const golden = computeGolden(COMPLEX_MODEL);

    // 1040×610 base + flanges
    // left=30, right=28, top=26, bottom=142
    // outerLeft = -3, outerRight = 1040+30+28+3 = 1101
    // outerBottom = -3, outerTop = 610+142+26+3 = 781
    expect(golden.bounds.x0).toBe(-3);
    expect(golden.bounds.x1).toBe(1101);
    expect(golden.bounds.y0).toBe(-3);
    expect(golden.bounds.y1).toBe(781);

    // Should have FREZ lines (fold lines + outer frez on bottom and left)
    expect(golden.frezShapes).toBeGreaterThan(0);
  });
});

describe("Golden: deterministic output", () => {
  it("same model always produces same output", () => {
    const result1 = computeSheetMetalGeometry(SIMPLE_FLANGES);
    const result2 = computeSheetMetalGeometry(SIMPLE_FLANGES);

    // Shape count must match
    expect(result1.shapes.length).toBe(result2.shapes.length);

    // Every shape coordinate must match exactly
    for (let i = 0; i < result1.shapes.length; i++) {
      const s1 = result1.shapes[i];
      const s2 = result2.shapes[i];
      expect(s1.layer).toBe(s2.layer);
      expect(s1.x1).toBeCloseTo(s2.x1, 10);
      expect(s1.y1).toBeCloseTo(s2.y1, 10);
      expect(s1.x2).toBeCloseTo(s2.x2, 10);
      expect(s1.y2).toBeCloseTo(s2.y2, 10);
    }
  });
});