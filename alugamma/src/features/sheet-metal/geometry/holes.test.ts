/**
 * geometry/holes.test.ts — Unit tests for hole generation.
 */

import { describe, it, expect } from "vitest";
import { addHoleLines, processHoles } from "./holes";
import type { LineShape, FlangeMeasurement, FrezMeasurement } from "@/features/sheet-metal/types";

describe("addHoleLines", () => {
  function collect(
    holeData: NonNullable<Parameters<typeof addHoleLines>[1]>,
    region: Parameters<typeof addHoleLines>[2],
    side: Parameters<typeof addHoleLines>[3],
  ): LineShape[] {
    const shapes: LineShape[] = [];
    addHoleLines(shapes, holeData, region, side);
    return shapes;
  }

  const baseRegion = { xMin: 0, xMax: 200, yMin: 0, yMax: 100 };
  const baseHoleData = {
    enabled: true,
    placement: "inner" as const,
    orientation: "horizontal" as const,
    sideOffset: 10,
    endOffset: 15,
    length: 20,
  };

  // ── Top side ──────────────────────────────────────────────

  it("top: horizontal orientation, inner placement, both lines", () => {
    const result = collect(baseHoleData, baseRegion, "top");
    expect(result).toHaveLength(2);
    // inner placement → y = yMin + endOffset = 0 + 15 = 15
    expect(result[0]).toMatchObject({ layer: "HOLES", y1: 15, y2: 15 });
    // line1 starts at xMin + sideOffset
    expect(result[0].x1).toBe(10);
    expect(result[0].x2).toBe(30); // length=20
    // line2 ends at xMax - sideOffset
    expect(result[1].x2).toBe(190);
    expect(result[1].x1).toBe(170); // 190 - 20
  });

  it("top: horizontal orientation, outer placement", () => {
    const holeData = { ...baseHoleData, placement: "outer" as const };
    const result = collect(holeData, baseRegion, "top");
    // outer → y = yMax - endOffset = 100 - 15 = 85
    expect(result[0].y1).toBe(85);
  });

  it("top: vertical orientation, inner placement", () => {
    const holeData = { ...baseHoleData, orientation: "vertical" as const };
    const result = collect(holeData, baseRegion, "top");
    expect(result).toHaveLength(2);
    // inner → y1 = yMin + endOffset = 15, y2 = y1 + length = 35
    expect(result[0]).toMatchObject({ layer: "HOLES", y1: 15, y2: 35, x1: 10, x2: 10 });
    // line2 at x2 = xMax - sideOffset
    expect(result[1].x1).toBe(190);
  });

  it("top: vertical orientation, outer placement", () => {
    const holeData = { ...baseHoleData, orientation: "vertical" as const, placement: "outer" as const };
    const result = collect(holeData, baseRegion, "top");
    // outer → y1 = yMax - endOffset = 85, y2 = y1 - length = 65
    expect(result[0]).toMatchObject({ y1: 85, y2: 65 });
  });

  // ── Bottom side ──────────────────────────────────────────

  it("bottom: horizontal orientation, inner placement", () => {
    const result = collect(baseHoleData, baseRegion, "bottom");
    expect(result).toHaveLength(2);
    // inner → y = yMax - endOffset = 100 - 15 = 85
    expect(result[0].y1).toBe(85);
  });

  it("bottom: vertical orientation, inner placement", () => {
    const holeData = { ...baseHoleData, orientation: "vertical" as const };
    const result = collect(holeData, baseRegion, "bottom");
    // inner → y1 = yMax - endOffset = 85, y2 = y1 - length = 65
    expect(result[0]).toMatchObject({ y1: 85, y2: 65 });
  });

  // ── Left side ────────────────────────────────────────────

  it("left: horizontal orientation, inner placement", () => {
    const result = collect(baseHoleData, baseRegion, "left");
    expect(result).toHaveLength(2);
    // inner → x = xMax - endOffset = 200 - 15 = 185
    expect(result[0].x1).toBe(185);
    expect(result[0].x2).toBe(185);
    // y1 = yMin + sideOffset, line1 length from yMin side
    expect(result[0].y1).toBe(10);
    expect(result[0].y2).toBe(30);
  });

  it("left: vertical orientation, inner placement", () => {
    const holeData = { ...baseHoleData, orientation: "vertical" as const };
    const result = collect(holeData, baseRegion, "left");
    expect(result).toHaveLength(2);
    // inner → x1 = xMax - endOffset = 185, x2 = x1 - length = 165
    expect(result[0]).toMatchObject({ x1: 185, x2: 165, y1: 10 });
  });

  // ── Right side ───────────────────────────────────────────

  it("right: horizontal orientation, inner placement", () => {
    const result = collect(baseHoleData, baseRegion, "right");
    expect(result).toHaveLength(2);
    // inner → x = xMin + endOffset = 0 + 15 = 15
    expect(result[0].x1).toBe(15);
    expect(result[0].x2).toBe(15);
  });

  it("right: vertical orientation, inner placement", () => {
    const holeData = { ...baseHoleData, orientation: "vertical" as const };
    const result = collect(holeData, baseRegion, "right");
    // inner → x1 = xMin + endOffset = 15, x2 = x1 + length = 35
    expect(result[0]).toMatchObject({ x1: 15, x2: 35, y1: 10 });
  });

  // ── Line enable/disable ──────────────────────────────────

  it("respects line1Enabled=false, line2Enabled=true", () => {
    const holeData = { ...baseHoleData, line1Enabled: false, line2Enabled: true };
    const result = collect(holeData, baseRegion, "top");
    expect(result).toHaveLength(1);
    // Only line2 — starts from the right side
    expect(result[0].x2).toBe(190);
  });

  it("respects line1Enabled=true, line2Enabled=false", () => {
    const holeData = { ...baseHoleData, line1Enabled: true, line2Enabled: false };
    const result = collect(holeData, baseRegion, "top");
    expect(result).toHaveLength(1);
    expect(result[0].x1).toBe(10);
  });

  it("respects both lines disabled", () => {
    const holeData = { ...baseHoleData, line1Enabled: false, line2Enabled: false };
    const result = collect(holeData, baseRegion, "top");
    expect(result).toHaveLength(0);
  });

  // ── Length clamping ──────────────────────────────────────

  it("clamps length when it exceeds half the available span", () => {
    const holeData = { ...baseHoleData, length: 999, sideOffset: 0 };
    const result = collect(holeData, baseRegion, "top");
    // Available span = 200, half = 100, so line1 length = min(999, 100) = 100
    expect(result[0].x2 - result[0].x1).toBe(100);
  });
});

describe("processHoles", () => {
  it("skips when holes not enabled", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-1",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: { enabled: false, placement: "inner", orientation: "horizontal", sideOffset: 10, endOffset: 10, length: 20 },
    };
    processHoles(shapes, feature, "top", 0, 200, 0, 100);
    expect(shapes).toHaveLength(0);
  });

  it("draws holes when enabled on a flange", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-2",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "inner",
        orientation: "horizontal",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "top", 0, 200, 0, 100);
    expect(shapes).toHaveLength(2);
  });

  it("draws holes when enabled on a frez measurement", () => {
    const shapes: LineShape[] = [];
    const feature: FrezMeasurement = {
      id: "m-3",
      amount: 24,
      notches: { start: false, end: false },
      holes: {
        enabled: true,
        placement: "inner",
        orientation: "vertical",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "left", 0, 200, 0, 100);
    expect(shapes).toHaveLength(2);
  });

  it("draws holes on bottom side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-4",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "horizontal",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "bottom", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
    // outer bottom: y = yMin + endOffset = 0 + 15 = 15
    expect(shapes[0].y1).toBe(15);
  });

  it("draws holes on left side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-5",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "horizontal",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "left", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
    // outer left horizontal: x = xMin + endOffset = 15
    expect(shapes[0].x1).toBe(15);
  });

  it("draws holes on right side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-6",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "horizontal",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "right", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
    // outer right horizontal: x = xMax - endOffset = 200 - 15 = 185
    expect(shapes[0].x1).toBe(185);
  });

  it("draws vertical holes on bottom side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-7",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "vertical",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "bottom", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
    // outer bottom vertical: y1 = yMin + endOffset = 15, y2 = y1 + length = 35
    expect(shapes[0].y1).toBe(15);
    expect(shapes[0].y2).toBe(35);
  });

  it("draws vertical holes on left side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-8",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "vertical",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "left", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
  });

  it("draws vertical holes on right side with outer placement", () => {
    const shapes: LineShape[] = [];
    const feature: FlangeMeasurement = {
      id: "m-9",
      amount: 20,
      reliefs: { start: false, end: false },
      flaps: { start: 0, end: 0 },
      holes: {
        enabled: true,
        placement: "outer",
        orientation: "vertical",
        sideOffset: 10,
        endOffset: 15,
        length: 20,
      },
    };
    processHoles(shapes, feature, "right", 0, 200, 0, 100);
    expect(shapes.length).toBeGreaterThanOrEqual(1);
  });
});