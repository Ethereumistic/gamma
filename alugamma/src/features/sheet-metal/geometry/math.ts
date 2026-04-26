/**
 * geometry/math.ts — Pure math utilities for sheet-metal geometry.
 *
 * All functions are stateless, deterministic, and have no side effects.
 * Extracted from geometry.ts to enable isolated unit testing.
 */

import { type SideKey, sideKeys } from "@/features/sheet-metal/types";

/** Numerical epsilon used for coordinate comparisons throughout the geometry engine. */
export const EPS = 1e-5;

/** Clamp a value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** True when |a - b| <= EPS. */
export function isNearlyEqual(a: number, b: number, tolerance = EPS): boolean {
  return Math.abs(a - b) <= tolerance;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

type AmountItem = { amount: number };

/** Sum the `.amount` field of every item. */
export function sumMeasurements<T extends AmountItem>(items: T[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

/** Return cumulative prefix-sums of `.amount`. */
export function getCumulativeOffsets<T extends AmountItem>(items: T[]): number[] {
  const offsets: number[] = [];
  let total = 0;
  for (const item of items) {
    total += item.amount;
    offsets.push(total);
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Model-derived values
// ---------------------------------------------------------------------------

import type { SheetMetalModel, FrezMeasurement, Measurement } from "@/features/sheet-metal/types";

/** Total flange depth per side (sum of all flange amounts). */
export function getFlangeDepths(model: SheetMetalModel): Record<SideKey, number> {
  return {
    top: sumMeasurements(model.sides.top.flanges),
    right: sumMeasurements(model.sides.right.flanges),
    bottom: sumMeasurements(model.sides.bottom.flanges),
    left: sumMeasurements(model.sides.left.flanges),
  };
}

/** Cumulative FREZ offsets per side. */
export function getFrezOffsets(model: SheetMetalModel): Record<SideKey, number[]> {
  return {
    top: getCumulativeOffsets(model.sides.top.frezLines),
    right: getCumulativeOffsets(model.sides.right.frezLines),
    bottom: getCumulativeOffsets(model.sides.bottom.frezLines),
    left: getCumulativeOffsets(model.sides.left.frezLines),
  };
}

/** Resolve absolute FREZ positions from offsets and base coords. */
export function getResolvedFrezPositions(
  model: SheetMetalModel,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  frezOffsets: Record<SideKey, number[]>,
): Record<SideKey, number[]> {
  return {
    top: frezOffsets.top.map((offset) => (model.sides.top.frezMode === "inner" ? y1 - offset : y1 + offset)),
    right: frezOffsets.right.map((offset) => (model.sides.right.frezMode === "inner" ? x1 - offset : x1 + offset)),
    bottom: frezOffsets.bottom.map((offset) => (model.sides.bottom.frezMode === "inner" ? y0 + offset : y0 - offset)),
    left: frezOffsets.left.map((offset) => (model.sides.left.frezMode === "inner" ? x0 + offset : x0 - offset)),
  };
}

/** Shoulder offset at corners: if multiple flanges, only the outermost counts. */
export function getCornerShoulderOffset(items: Measurement[]): number {
  if (items.length === 0) return 0;
  return items.length > 1 ? items[0].amount : sumMeasurements(items);
}

/** Collect warnings for FREZ depths that exceed the available space. */
export function collectWarnings(model: SheetMetalModel, flangeDepths: Record<SideKey, number>): string[] {
  const warnings: string[] = [];

  for (const side of sideKeys) {
    const offsets = getCumulativeOffsets(model.sides[side].frezLines);
    if (offsets.length === 0) continue;

    const limit =
      model.sides[side].frezMode === "inner"
        ? side === "left" || side === "right"
          ? model.baseWidth
          : model.baseHeight
        : flangeDepths[side];

    if (limit <= 0) {
      warnings.push(`${side[0].toUpperCase()}${side.slice(1)} outer FREZ needs flange depth on that side.`);
      continue;
    }

    if (offsets.some((value) => value >= limit)) {
      const scope = model.sides[side].frezMode === "inner" ? "base size" : "flange depth";
      warnings.push(`${side[0].toUpperCase()}${side.slice(1)} FREZ depth reaches past the ${scope}.`);
    }
  }

  return warnings;
}