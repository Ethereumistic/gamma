/**
 * geometry/math.test.ts — Unit tests for pure math utilities.
 */

import { describe, expect, it } from "vitest";
import {
  EPS,
  DIAGONAL_RATIO,
  SHOULDER_SHRINK_FACTOR,
  flapDiagonal,
  clamp,
  isNearlyEqual,
  sumMeasurements,
  getCumulativeOffsets,
  getCornerShoulderOffset,
  collectWarnings,
  getFlangeDepths,
  getFrezOffsets,
  getResolvedFrezPositions,
} from "./math";
import { createEmptyModel, type SheetMetalModel } from "@/features/sheet-metal/types";

// ---------------------------------------------------------------------------
// EPS
// ---------------------------------------------------------------------------

describe("EPS", () => {
  it("is 1e-5", () => {
    expect(EPS).toBe(1e-5);
  });
});

// ---------------------------------------------------------------------------
// V-notch constants
// ---------------------------------------------------------------------------

describe("DIAGONAL_RATIO", () => {
  it("is sqrt(2)", () => {
    expect(DIAGONAL_RATIO).toBe(Math.SQRT2);
  });
});

describe("SHOULDER_SHRINK_FACTOR", () => {
  it("is sqrt(2) - 1", () => {
    expect(SHOULDER_SHRINK_FACTOR).toBeCloseTo(Math.SQRT2 - 1, 10);
  });
  it("is approximately 0.4142", () => {
    expect(SHOULDER_SHRINK_FACTOR).toBeCloseTo(0.4142, 3);
  });
});

describe("flapDiagonal", () => {
  it("returns 0 for undefined flap", () => {
    expect(flapDiagonal(undefined)).toBe(0);
  });
  it("returns 0 for flap = 0", () => {
    expect(flapDiagonal(0)).toBe(0);
  });
  it("returns flap * sqrt(2) for positive flap", () => {
    expect(flapDiagonal(5)).toBeCloseTo(5 * Math.SQRT2, 10);
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles equal min and max", () => {
    expect(clamp(5, 7, 7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// isNearlyEqual
// ---------------------------------------------------------------------------

describe("isNearlyEqual", () => {
  it("returns true for identical values", () => {
    expect(isNearlyEqual(5, 5)).toBe(true);
  });

  it("returns true for values within EPS", () => {
    expect(isNearlyEqual(5, 5 + EPS * 0.5)).toBe(true);
  });

  it("returns false for values outside EPS", () => {
    expect(isNearlyEqual(5, 5 + EPS * 10)).toBe(false);
  });

  it("respects custom tolerance", () => {
    expect(isNearlyEqual(5, 6, 1)).toBe(true);
    expect(isNearlyEqual(5, 6, 0.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sumMeasurements
// ---------------------------------------------------------------------------

describe("sumMeasurements", () => {
  it("sums amounts", () => {
    expect(sumMeasurements([{ id: "1", amount: 10 }, { id: "2", amount: 20 }, { id: "3", amount: 30 }])).toBe(60);
  });

  it("returns 0 for empty array", () => {
    expect(sumMeasurements([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCumulativeOffsets
// ---------------------------------------------------------------------------

describe("getCumulativeOffsets", () => {
  it("returns prefix sums", () => {
    expect(getCumulativeOffsets([{ id: "1", amount: 10 }, { id: "2", amount: 20 }, { id: "3", amount: 30 }])).toEqual([10, 30, 60]);
  });

  it("returns empty array for no items", () => {
    expect(getCumulativeOffsets([])).toEqual([]);
  });

  it("handles single item", () => {
    expect(getCumulativeOffsets([{ id: "1", amount: 42 }])).toEqual([42]);
  });
});

// ---------------------------------------------------------------------------
// getCornerShoulderOffset
// ---------------------------------------------------------------------------

describe("getCornerShoulderOffset", () => {
  it("returns 0 for empty array", () => {
    expect(getCornerShoulderOffset([])).toBe(0);
  });

  it("returns sum for single item", () => {
    expect(getCornerShoulderOffset([{ id: "test-1", amount: 25 }])).toBe(25);
  });

  it("returns first item amount for multiple items", () => {
    expect(getCornerShoulderOffset([{ id: "test-1", amount: 60 }, { id: "test-2", amount: 25 }])).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// getFlangeDepths
// ---------------------------------------------------------------------------

describe("getFlangeDepths", () => {
  it("returns 0 for all sides of empty model", () => {
    const model = createEmptyModel();
    const depths = getFlangeDepths(model);
    expect(depths.top).toBe(0);
    expect(depths.bottom).toBe(0);
    expect(depths.left).toBe(0);
    expect(depths.right).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFrezOffsets
// ---------------------------------------------------------------------------

describe("getFrezOffsets", () => {
  it("returns empty arrays for empty model", () => {
    const model = createEmptyModel();
    const offsets = getFrezOffsets(model);
    expect(offsets.top).toEqual([]);
    expect(offsets.bottom).toEqual([]);
    expect(offsets.left).toEqual([]);
    expect(offsets.right).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectWarnings
// ---------------------------------------------------------------------------

describe("getResolvedFrezPositions", () => {
  it("resolves outer FREZ positions for top side", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.frezLines = [{ id: "1", amount: 20, notches: { start: false, end: false } }];
    model.sides.top.frezMode = "outer";
    const offsets = { top: [20], right: [], bottom: [], left: [] };
    const positions = getResolvedFrezPositions(model, 0, 0, 500, 500, offsets);
    // outer top: y1 + offset = 500 + 20 = 520
    expect(positions.top[0]).toBe(520);
  });

  it("resolves inner FREZ positions for top side", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.top.frezLines = [{ id: "1", amount: 20, notches: { start: false, end: false } }];
    model.sides.top.frezMode = "inner";
    const offsets = { top: [20], right: [], bottom: [], left: [] };
    const positions = getResolvedFrezPositions(model, 0, 0, 500, 500, offsets);
    // inner top: y1 - offset = 500 - 20 = 480
    expect(positions.top[0]).toBe(480);
  });

  it("resolves inner FREZ positions for bottom side", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.bottom.frezLines = [{ id: "1", amount: 30, notches: { start: false, end: false } }];
    model.sides.bottom.frezMode = "inner";
    const offsets = { top: [], right: [], bottom: [30], left: [] };
    const positions = getResolvedFrezPositions(model, 0, 0, 500, 500, offsets);
    // inner bottom: y0 + offset = 0 + 30 = 30
    expect(positions.bottom[0]).toBe(30);
  });

  it("resolves outer FREZ positions for left side", () => {
    const model = createEmptyModel();
    model.baseWidth = 500;
    model.baseHeight = 500;
    model.sides.left.frezLines = [{ id: "1", amount: 15, notches: { start: false, end: false } }];
    model.sides.left.frezMode = "outer";
    const offsets = { top: [], right: [], bottom: [], left: [15] };
    const positions = getResolvedFrezPositions(model, 0, 0, 500, 500, offsets);
    // outer left: x0 - offset = 0 - 15 = -15
    expect(positions.left[0]).toBe(-15);
  });
});

describe("collectWarnings", () => {
  it("returns empty warnings for empty model", () => {
    const model = createEmptyModel();
    const depths = getFlangeDepths(model);
    const warnings = collectWarnings(model, depths);
    expect(warnings).toEqual([]);
  });

  it("warns when outer FREZ exceeds flange depth", () => {
    const model = createEmptyModel();
    model.sides.top.flanges = [{ id: "1", amount: 20, reliefs: { start: false, end: false }, flaps: { start: 0, end: 0 } }];
    model.sides.top.frezLines = [{ id: "1", amount: 25, notches: { start: false, end: false } }];
    model.sides.top.frezMode = "outer";
    const depths = getFlangeDepths(model);
    const warnings = collectWarnings(model, depths);
    // 25 >= 20 (flange depth) → warning
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("FREZ");
  });

  it("warns when outer FREZ has no flange depth", () => {
    const model = createEmptyModel();
    model.sides.right.frezLines = [{ id: "1", amount: 10, notches: { start: false, end: false } }];
    model.sides.right.frezMode = "outer";
    const depths = getFlangeDepths(model);
    const warnings = collectWarnings(model, depths);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("warns when inner FREZ exceeds base size", () => {
    const model = createEmptyModel();
    model.baseHeight = 100;
    model.baseWidth = 100;
    // Use top side (uses baseHeight for inner frez limit)
    model.sides.top.frezLines = [{ id: "1", amount: 110, notches: { start: false, end: false } }];
    model.sides.top.frezMode = "inner";
    const depths = getFlangeDepths(model);
    const warnings = collectWarnings(model, depths);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("base size");
  });
});