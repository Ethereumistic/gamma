/**
 * geometry/notches.ts — V-notch types, computation, and offset logic.
 *
 * Notches are V-shaped cutouts at the corners of sheet-metal flanges.
 * They are defined by an apex point and a shoulder point that determines
 * how deep the V-cut extends.
 */

import type { FrezMeasurement, SideKey } from "@/features/sheet-metal/types";
import { sumMeasurements } from "./math";

// ---------------------------------------------------------------------------
// Notch types
// ---------------------------------------------------------------------------

/** Horizontal notch — apex on a top/bottom edge; V-cut opens up/down. */
export type HorizontalNotch = {
  apexX: number;
  apexY: number;
  shoulderY: number;
  flap?: number;
};

/** Vertical notch — apex on a left/right edge; V-cut opens left/right. */
export type VerticalNotch = {
  apexX: number;
  apexY: number;
  shoulderX: number;
  flap?: number;
};

// ---------------------------------------------------------------------------
// Notch collections per edge
// ---------------------------------------------------------------------------

export type NotchArrays = {
  top: HorizontalNotch[];
  bottom: HorizontalNotch[];
  left: VerticalNotch[];
  right: VerticalNotch[];
};

// ---------------------------------------------------------------------------
// Add FREZ-driven notches
// ---------------------------------------------------------------------------

/**
 * For a horizontal side (top/bottom), add notches driven by FREZ lines on an
 * adjacent vertical side (left/right). Each FREZ line with notch flags pushes
 * a HorizontalNotch onto the top or bottom edge.
 */
export function addFrezDrivenHorizontalNotches(
  startEdgeNotches: HorizontalNotch[],
  endEdgeNotches: HorizontalNotch[],
  frezLines: FrezMeasurement[],
  positions: number[],
  startTarget: { apexY: number; shoulderY: number },
  endTarget: { apexY: number; shoulderY: number },
): void {
  frezLines.forEach((line, index) => {
    const apexX = positions[index];
    if (apexX === undefined) return;

    if (line.notches.start) {
      startEdgeNotches.push({ apexX, apexY: startTarget.apexY, shoulderY: startTarget.shoulderY });
    }
    if (line.notches.end) {
      endEdgeNotches.push({ apexX, apexY: endTarget.apexY, shoulderY: endTarget.shoulderY });
    }
  });
}

/**
 * For a vertical side (left/right), add notches driven by FREZ lines on an
 * adjacent horizontal side (top/bottom). Each FREZ line with notch flags pushes
 * a VerticalNotch onto the left or right edge.
 */
export function addFrezDrivenVerticalNotches(
  startEdgeNotches: VerticalNotch[],
  endEdgeNotches: VerticalNotch[],
  frezLines: FrezMeasurement[],
  positions: number[],
  startTarget: { apexX: number; shoulderX: number },
  endTarget: { apexX: number; shoulderX: number },
): void {
  frezLines.forEach((line, index) => {
    const apexY = positions[index];
    if (apexY === undefined) return;

    if (line.notches.start) {
      startEdgeNotches.push({ apexX: startTarget.apexX, apexY, shoulderX: startTarget.shoulderX });
    }
    if (line.notches.end) {
      endEdgeNotches.push({ apexX: endTarget.apexX, apexY, shoulderX: endTarget.shoulderX });
    }
  });
}

// ---------------------------------------------------------------------------
// Offset notches (for offset-cut dual-pass)
// ---------------------------------------------------------------------------

/**
 * Offset horizontal notches by moving the apex along the V-cut direction
 * and shrinking the shoulder accordingly.
 *
 * @param notches   The original notch array
 * @param dirY      +1 for top (apex moves up), -1 for bottom (apex moves down)
 * @param unoffsetEdgeY  The Y coordinate of the edge *before* offset was applied
 * @param offset    The offset-cut distance
 */
export function offsetHorizontalNotches(
  notches: HorizontalNotch[],
  dirY: 1 | -1,
  unoffsetEdgeY: number,
  offset: number,
): HorizontalNotch[] {
  if (offset === 0) return notches;
  const dDiag = offset * Math.SQRT2;
  const finalNotches: HorizontalNotch[] = [];

  for (const n of notches) {
    if (n.shoulderY === n.apexY) continue;
    const initialSign = Math.sign(n.shoulderY - n.apexY);

    const originalS = Math.abs(n.shoulderY - n.apexY);
    const isOuterEdge = Math.abs(n.shoulderY - unoffsetEdgeY) < 1e-4;
    const newS = isOuterEdge ? (originalS - offset * (Math.SQRT2 - 1)) : (originalS - offset);
    if (newS <= 0) continue;

    const newApexY = n.apexY + dirY * dDiag;
    const newShoulderY = newApexY + dirY * newS;

    if (Math.sign(newShoulderY - newApexY) !== initialSign) continue;
    finalNotches.push({ apexX: n.apexX, apexY: newApexY, shoulderY: newShoulderY, flap: n.flap });
  }
  return finalNotches;
}

/**
 * Offset vertical notches by moving the apex along the V-cut direction
 * and shrinking the shoulder accordingly.
 *
 * @param notches   The original notch array
 * @param dirX      -1 for left (apex moves left), +1 for right (apex moves right)
 * @param unoffsetEdgeX  The X coordinate of the edge *before* offset was applied
 * @param offset    The offset-cut distance
 */
export function offsetVerticalNotches(
  notches: VerticalNotch[],
  dirX: 1 | -1,
  unoffsetEdgeX: number,
  offset: number,
): VerticalNotch[] {
  if (offset === 0) return notches;
  const dDiag = offset * Math.SQRT2;
  const finalNotches: VerticalNotch[] = [];

  for (const n of notches) {
    if (n.shoulderX === n.apexX) continue;
    const initialSign = Math.sign(n.shoulderX - n.apexX);

    const originalS = Math.abs(n.shoulderX - n.apexX);
    const isOuterEdge = Math.abs(n.shoulderX - unoffsetEdgeX) < 1e-4;
    const newS = isOuterEdge ? (originalS - offset * (Math.SQRT2 - 1)) : (originalS - offset);
    if (newS <= 0) continue;

    const newApexX = n.apexX + dirX * dDiag;
    const newShoulderX = newApexX + dirX * newS;

    if (Math.sign(newShoulderX - newApexX) !== initialSign) continue;
    finalNotches.push({ apexX: newApexX, apexY: n.apexY, shoulderX: newShoulderX, flap: n.flap });
  }
  return finalNotches;
}