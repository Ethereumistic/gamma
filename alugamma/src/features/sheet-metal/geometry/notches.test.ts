/**
 * geometry/notches.test.ts — Unit tests for notch computation and offset logic.
 */

import { describe, expect, it } from "vitest";
import {
  addFrezDrivenHorizontalNotches,
  addFrezDrivenVerticalNotches,
  offsetHorizontalNotches,
  offsetVerticalNotches,
  type HorizontalNotch,
  type VerticalNotch,
} from "./notches";

// ---------------------------------------------------------------------------
// addFrezDrivenHorizontalNotches
// ---------------------------------------------------------------------------

describe("addFrezDrivenHorizontalNotches", () => {
  it("adds notches for lines with start and end flags", () => {
    const startNotches: HorizontalNotch[] = [];
    const endNotches: HorizontalNotch[] = [];
    const positions = [50, 100];

    addFrezDrivenHorizontalNotches(
      startNotches,
      endNotches,
      [
        { id: "1", amount: 24, notches: { start: true, end: true } },
        { id: "2", amount: 24, notches: { start: true, end: false } },
      ],
      positions,
      { apexY: 0, shoulderY: 40 },
      { apexY: 100, shoulderY: 60 },
    );

    expect(startNotches.length).toBe(2);
    expect(endNotches.length).toBe(1);
    expect(startNotches[0].apexX).toBe(50);
    expect(endNotches[0].apexX).toBe(50);
  });

  it("skips lines without notch flags", () => {
    const startNotches: HorizontalNotch[] = [];
    const endNotches: HorizontalNotch[] = [];

    addFrezDrivenHorizontalNotches(
      startNotches,
      endNotches,
      [{ id: "1", amount: 24, notches: { start: false, end: false } }],
      [50],
      { apexY: 0, shoulderY: 40 },
      { apexY: 100, shoulderY: 60 },
    );

    expect(startNotches.length).toBe(0);
    expect(endNotches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addFrezDrivenVerticalNotches
// ---------------------------------------------------------------------------

describe("addFrezDrivenVerticalNotches", () => {
  it("adds vertical notches for FREZ lines", () => {
    const startNotches: VerticalNotch[] = [];
    const endNotches: VerticalNotch[] = [];

    addFrezDrivenVerticalNotches(
      startNotches,
      endNotches,
      [{ id: "1", amount: 20, notches: { start: true, end: true } }],
      [100],
      { apexX: 0, shoulderX: 30 },
      { apexX: 200, shoulderX: 170 },
    );

    expect(startNotches.length).toBe(1);
    expect(endNotches.length).toBe(1);
    expect(startNotches[0].apexY).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// offsetHorizontalNotches
// ---------------------------------------------------------------------------

describe("offsetHorizontalNotches", () => {
  it("returns same notches for zero offset", () => {
    const notches: HorizontalNotch[] = [{ apexX: 50, apexY: 0, shoulderY: 40 }];
    expect(offsetHorizontalNotches(notches, -1, 0, 0)).toBe(notches);
  });

  it("shifts bottom-edge notch downward with offset", () => {
    // Bottom edge: apex on edge at y=0, shoulder further down at y=-40
    // (V opens downward for bottom edge)
    const notches: HorizontalNotch[] = [{ apexX: 50, apexY: 0, shoulderY: -40 }];
    // dirY=-1 (bottom), unoffsetEdgeY=-5 (outer boundary before offset)
    const result = offsetHorizontalNotches(notches, -1, -5, 5);
    expect(result.length).toBe(1);
    // Apex moves down by dDiag = 5 * sqrt(2)
    expect(result[0].apexY).toBeCloseTo(-5 * Math.SQRT2);
    // Shoulder also shifts
    expect(result[0].shoulderY).not.toBe(-40);
  });

  it("removes notches that become zero or negative size", () => {
    // Very large offset relative to notch size
    const notches: HorizontalNotch[] = [{ apexX: 50, apexY: 0, shoulderY: 1 }];
    const result = offsetHorizontalNotches(notches, -1, 0, 100);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// offsetVerticalNotches
// ---------------------------------------------------------------------------

describe("offsetVerticalNotches", () => {
  it("returns same notches for zero offset", () => {
    const notches: VerticalNotch[] = [{ apexX: 0, apexY: 50, shoulderX: 30 }];
    expect(offsetVerticalNotches(notches, -1, 0, 0)).toBe(notches);
  });

  it("shifts left-edge notch leftward with offset", () => {
    // Left edge: apex on edge at x=0, shoulder further left at x=-30
    // (V opens leftward for left edge)
    const notches: VerticalNotch[] = [{ apexX: 0, apexY: 50, shoulderX: -30 }];
    // dirX=-1 (left), unoffsetEdgeX=-3 (outer boundary before offset)
    const result = offsetVerticalNotches(notches, -1, -3, 3);
    expect(result.length).toBe(1);
    expect(result[0].apexX).toBeCloseTo(-3 * Math.SQRT2);
  });

  it("filters notches with zero shoulder distance", () => {
    const notches: HorizontalNotch[] = [{ apexX: 50, apexY: 10, shoulderY: 10 }];
    const result = offsetHorizontalNotches(notches, -1, 0, 5);
    expect(result.length).toBe(0);
  });

  it("filters notches where sign flips after offset", () => {
    // A notch where offset causes the shoulder to cross the apex
    // apexY=0, shoulderY=2, offset=100 (huge)
    const notches: HorizontalNotch[] = [{ apexX: 50, apexY: 0, shoulderY: 2 }];
    const result = offsetHorizontalNotches(notches, -1, -1, 100);
    expect(result.length).toBe(0);
  });
});