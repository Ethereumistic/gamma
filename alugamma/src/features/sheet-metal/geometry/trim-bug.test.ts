/**
 * Test to reproduce the edge case:
 * - Base 900x520
 * - Left side: 1 flange of 20mm
 * - Bottom side: 1 flange of 100mm
 * - Left flange F1 has relief.end = true (V-notch at bottom-left corner)
 *
 * Bug: The left outer vertical CUT/0 line extends too far below the V-notch
 * diagonal at the bottom-left corner. The 4 '0' lines in the ASCII diagram
 * represent a vertical segment that should be trimmed but isn't.
 */

import { describe, it, expect } from "vitest";
import { computeSheetMetalGeometry } from "@/features/sheet-metal/geometry";
import type { SheetMetalModel, LineShape } from "@/features/sheet-metal/types";

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

describe("Bottom-left V-notch trimming edge case", () => {
  it("trims the left outer vertical line at the V-notch diagonal when bottom flange > left flange", () => {
    const model: SheetMetalModel = {
      baseWidth: 900,
      baseHeight: 520,
      invertX: false,
      invertY: false,
      offsetCut: 3,
      includeName: true,
      includeArrow: true,
      arrowDirection: "top",
      sides: {
        top: emptySide(),
        right: emptySide(),
        bottom: {
          flanges: [{
            id: "bottom-f1",
            amount: 100,
            reliefs: { start: false, end: false },
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
        left: {
          flanges: [{
            id: "left-f1",
            amount: 20,
            reliefs: { start: false, end: true }, // end = bottom side relief
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
      },
      cornerReliefs: emptyCorners(),
      rubberband: true,
    };

    const result = computeSheetMetalGeometry(model);

    // The base rectangle:
    // x0 = leftFlangeDepth = 20
    // y0 = bottomFlangeDepth = 100
    // x1 = 20 + 900 = 920
    // y1 = 100 + 520 = 620
    //
    // The outer bounds (with offsetCut=3):
    // outerLeft = -3
    // outerBottom = -3
    // outerRight = 900 + 20 + 0 + 3 = 923
    // outerTop = 520 + 100 + 0 + 3 = 623
    //
    // The left flange has relief.end=true, creating a V-notch at the
    // bottom-left corner. The notch apex is at (x0=20, y0=100) and
    // the shoulder is at bottomShoulderY = y0 - 100 = 0.
    //
    // So the V-notch diagonal goes from (20, 100) to (-80, 0) on the
    // left side and (120, 0) on the right side. BUT the outer left
    // edge is at x = -3 (outerLeft), so the diagonal intersects the
    // left edge at x=-3, y = 100 - (20-(-3)) = 100 - 23 = 77.
    //
    // Therefore, the left vertical CUT line at x = outerLeft = -3
    // should NOT extend below y = 77 (approximately).
    // But the bug causes it to extend all the way down to outerBottom = -3.

    // Get all shapes on the left outer edge (x ≈ -3)
    const outerLeft = -3;
    const leftEdgeShapes = result.shapes.filter(s =>
      (s.layer === "CUT" || s.layer === "0") &&
      Math.abs(s.x1 - outerLeft) < 0.1 &&
      Math.abs(s.x2 - outerLeft) < 0.1
    );

    console.log("\n=== Left outer edge vertical lines (x ≈ -3) ===");
    for (const s of leftEdgeShapes) {
      console.log(`  Layer=${s.layer} y: ${s.y1.toFixed(2)} → ${s.y2.toFixed(2)}`);
    }

    // The V-notch at bottomLeft means: shoulderOff = |bottomShoulderY - y0|
    // bottomShoulderY = y0 - getCornerShoulderOffset(bottom.flanges) = 100 - 100 = 0
    // So shoulderOff = |0 - 100| = 100
    // The notch apex is at (x0=20, y0=100).
    // At x = outerLeft = -3, the diagonal boundary is:
    //   boundaryY = apexY - (|x - apexX| + D) = 100 - (|(-3) - 20| + 0) = 100 - 23 = 77
    //
    // So: left vertical line at x=-3 should stop at y=77 (not go below).
    // After offset, the numbers shift slightly, but the principle is the same.

    // Find the lowest y coordinate on any left-edge vertical line
    const allLeftEdgeYs = leftEdgeShapes.flatMap(s => [s.y1, s.y2]);
    const lowestY = Math.min(...allLeftEdgeYs);

    // Dump ALL CUT shapes to trace the source of the spurious line
    console.log("\n=== ALL CUT shapes ===");
    const cutShapes = result.shapes.filter(s => s.layer === "CUT");
    for (const s of cutShapes) {
      console.log(`  (${s.x1.toFixed(2)}, ${s.y1.toFixed(2)}) → (${s.x2.toFixed(2)}, ${s.y2.toFixed(2)})`);
    }

    console.log(`\nLowest Y on left edge: ${lowestY.toFixed(2)}`);
    console.log(`Expected: should be around 77 or higher (not -3)`);

    // The vertical left-edge line should NOT extend below the V-notch boundary
    // At x=-3, the boundary is at y ≈ 77. So the lowest point on the left edge
    // should be significantly above outerBottom (-3).
    expect(lowestY).toBeGreaterThan(50); // Should be ~77, definitely not -3
  });

  it("also works with offsetCut=0 (zero layer only)", () => {
    const model: SheetMetalModel = {
      baseWidth: 900,
      baseHeight: 520,
      invertX: false,
      invertY: false,
      offsetCut: 0,
      includeName: true,
      includeArrow: true,
      arrowDirection: "top",
      sides: {
        top: emptySide(),
        right: emptySide(),
        bottom: {
          flanges: [{
            id: "bottom-f1",
            amount: 100,
            reliefs: { start: false, end: false },
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
        left: {
          flanges: [{
            id: "left-f1",
            amount: 20,
            reliefs: { start: false, end: true },
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
      },
      cornerReliefs: emptyCorners(),
      rubberband: true,
    };

    const result = computeSheetMetalGeometry(model);

    // With offsetCut=0, outerLeft=0, y0=100, x0=20
    // V-notch apex at (20, 100), shoulder at 0
    // At x=0: boundary = 100 - |0 - 20| = 80
    const outerLeft = 0;
    const leftEdgeShapes = result.shapes.filter(s =>
      (s.layer === "CUT" || s.layer === "0") &&
      Math.abs(s.x1 - outerLeft) < 0.1 &&
      Math.abs(s.x2 - outerLeft) < 0.1
    );

    const allLeftEdgeYs = leftEdgeShapes.flatMap(s => [s.y1, s.y2]);
    const lowestY = Math.min(...allLeftEdgeYs);

    // Should stop at y=80, not go down to y=0
    expect(lowestY).toBeGreaterThan(70);
  });

  it("handles the symmetric case: top-right corner with right flange relief", () => {
    // Mirror of the bottom-left case: right flange 20mm, top flange 100mm,
    // right flange relief.start = true (top side)
    const model: SheetMetalModel = {
      baseWidth: 900,
      baseHeight: 520,
      invertX: false,
      invertY: false,
      offsetCut: 3,
      includeName: true,
      includeArrow: true,
      arrowDirection: "top",
      sides: {
        top: {
          flanges: [{
            id: "top-f1",
            amount: 100,
            reliefs: { start: false, end: false },
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
        right: {
          flanges: [{
            id: "right-f1",
            amount: 20,
            reliefs: { start: true, end: false }, // start = top side relief
            flaps: { start: 0, end: 0 },
          }],
          frezLines: [],
          frezMode: "inner",
          innerFrezLines: [],
        },
        bottom: emptySide(),
        left: emptySide(),
      },
      cornerReliefs: emptyCorners(),
      rubberband: true,
    };

    const result = computeSheetMetalGeometry(model);

    // outerRight = 900 + 0 + 20 + 3 = 923
    const outerRight = 923;
    const rightEdgeShapes = result.shapes.filter(s =>
      (s.layer === "CUT" || s.layer === "0") &&
      Math.abs(s.x1 - outerRight) < 0.1 &&
      Math.abs(s.x2 - outerRight) < 0.1
    );

    const allRightEdgeYs = rightEdgeShapes.flatMap(s => [s.y1, s.y2]);
    const highestY = Math.max(...allRightEdgeYs);

    // outerTop = 520 + 0 + 100 + 3 = 623
    // The right edge should not extend above the V-notch boundary
    // The V-notch at the top-right clips the right edge
    expect(highestY).toBeLessThan(600); // Should be well below outerTop=623
  });
});
