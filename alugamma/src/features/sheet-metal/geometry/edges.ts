/**
 * geometry/edges.ts — CUT-layer edge drawing and span clipping.
 *
 * These functions draw the outer boundary edges of the sheet-metal panel,
 * correctly routing around V-notches with diagonal segments.
 */

import type { LineShape, Layer } from "@/features/sheet-metal/types";
import { type HorizontalNotch, type VerticalNotch } from "./notches";
import { EPS } from "./math";

// ---------------------------------------------------------------------------
// Low-level helper
// ---------------------------------------------------------------------------

function addLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (x1 === x2 && y1 === y2) return;
  shapes.push({ type: "line", layer, x1, y1, x2, y2 });
}

// ---------------------------------------------------------------------------
// Horizontal CUT edge (top / bottom boundary)
// ---------------------------------------------------------------------------

/**
 * Draw a horizontal CUT edge at `yEdge` from `startX` to `endX`,
 * routing around any horizontal notches (V-cut indentations).
 *
 * The edge is a polyline: straight segments on the boundary Y where there
 * is no notch, and diagonal segments following the V-cut where a notch
 * intersects.
 */
export function addHorizontalCutEdge(
  shapes: LineShape[],
  yEdge: number,
  startX: number,
  endX: number,
  notches: HorizontalNotch[],
): void {
  const sorted = [...notches]
    .filter((notch) => notch.apexX > startX && notch.apexX < endX)
    .sort((left, right) => left.apexX - right.apexX);

  if (sorted.length === 0) {
    addLine(shapes, "CUT", startX, yEdge, endX, yEdge);
    return;
  }

  const isTopEdge = sorted[0].apexY < yEdge;

  let xCrits = [startX, endX];
  for (const notch of sorted) {
    const shoulderOff = Math.abs(notch.shoulderY - notch.apexY);
    const D = (notch.flap || 0) * Math.SQRT2;
    xCrits.push(notch.apexX - shoulderOff);
    xCrits.push(notch.apexX);
    xCrits.push(notch.apexX + shoulderOff);
    if (D > 0) {
      xCrits.push(notch.apexX - Math.max(0, shoulderOff - D));
      xCrits.push(notch.apexX + Math.max(0, shoulderOff - D));
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const n1 = sorted[i];
      const n2 = sorted[j];
      const xInt1 = (n1.apexY - n2.apexY + n1.apexX + n2.apexX) / 2;
      const xInt2 = (n2.apexY - n1.apexY + n1.apexX + n2.apexX) / 2;
      xCrits.push(xInt1);
      xCrits.push(xInt2);
    }
  }

  xCrits = xCrits.filter(x => x >= startX - EPS && x <= endX + EPS).sort((a, b) => a - b);
  const uniqueXCrits: number[] = [];
  for (const x of xCrits) {
    if (uniqueXCrits.length === 0 || Math.abs(x - uniqueXCrits[uniqueXCrits.length - 1]) > EPS) {
      uniqueXCrits.push(x);
    }
  }

  function getInnerNotchY(notch: HorizontalNotch, x: number) {
    const D = (notch.flap || 0) * Math.SQRT2;
    return notch.apexY + (isTopEdge ? 1 : -1) * (Math.abs(x - notch.apexX) + D);
  }

  function getActiveNotch(xMid: number): HorizontalNotch | null {
    let activeNotch: HorizontalNotch | null = null;
    let boundY = yEdge;
    for (const notch of sorted) {
      const shoulderOff = Math.abs(notch.shoulderY - notch.apexY);
      if (xMid > notch.apexX - shoulderOff && xMid < notch.apexX + shoulderOff) {
        const ny = getInnerNotchY(notch, xMid);
        if (isTopEdge ? ny < boundY : ny > boundY) {
          boundY = ny;
          activeNotch = notch;
        }
      }
    }
    return activeNotch;
  }

  let currentY = yEdge;
  for (let i = 0; i < uniqueXCrits.length - 1; i++) {
    const xA = uniqueXCrits[i];
    const xB = uniqueXCrits[i + 1];
    const xMid = (xA + xB) / 2;

    const activeNotch = getActiveNotch(xMid);
    const yA = activeNotch ? getInnerNotchY(activeNotch, xA) : yEdge;
    const yB = activeNotch ? getInnerNotchY(activeNotch, xB) : yEdge;

    if (Math.abs(currentY - yA) > EPS) {
      addLine(shapes, "CUT", xA, currentY, xA, yA);
    }

    addLine(shapes, "CUT", xA, yA, xB, yB);
    currentY = yB;
  }

  if (Math.abs(currentY - yEdge) > EPS) {
    addLine(shapes, "CUT", endX, currentY, endX, yEdge);
  }
}

// ---------------------------------------------------------------------------
// Vertical CUT edge (left / right boundary)
// ---------------------------------------------------------------------------

/**
 * Draw a vertical CUT edge at `xEdge` from `startY` to `endY`,
 * routing around any vertical notches (V-cut indentations).
 */
export function addVerticalCutEdge(
  shapes: LineShape[],
  xEdge: number,
  startY: number,
  endY: number,
  notches: VerticalNotch[],
): void {
  const sorted = [...notches]
    .filter((notch) => notch.apexY < startY && notch.apexY > endY)
    .sort((a, b) => b.apexY - a.apexY);

  if (sorted.length === 0) {
    addLine(shapes, "CUT", xEdge, startY, xEdge, endY);
    return;
  }

  const isRightEdge = sorted[0].apexX < xEdge;

  let yCrits = [startY, endY];
  for (const notch of sorted) {
    const shoulderOff = Math.abs(notch.shoulderX - notch.apexX);
    const D = (notch.flap || 0) * Math.SQRT2;
    yCrits.push(notch.apexY + shoulderOff);
    yCrits.push(notch.apexY);
    yCrits.push(notch.apexY - shoulderOff);
    if (D > 0) {
      yCrits.push(notch.apexY + Math.max(0, shoulderOff - D));
      yCrits.push(notch.apexY - Math.max(0, shoulderOff - D));
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const n1 = sorted[i];
      const n2 = sorted[j];
      const yInt1 = (n1.apexX - n2.apexX + n1.apexY + n2.apexY) / 2;
      const yInt2 = (n2.apexX - n1.apexX + n1.apexY + n2.apexY) / 2;
      yCrits.push(yInt1);
      yCrits.push(yInt2);
    }
  }

  yCrits = yCrits.filter(y => y <= startY + EPS && y >= endY - EPS).sort((a, b) => b - a);
  const uniqueYCrits: number[] = [];
  for (const y of yCrits) {
    if (uniqueYCrits.length === 0 || Math.abs(uniqueYCrits[uniqueYCrits.length - 1] - y) > EPS) {
      uniqueYCrits.push(y);
    }
  }

  function getInnerNotchX(notch: VerticalNotch, y: number) {
    const D = (notch.flap || 0) * Math.SQRT2;
    return notch.apexX + (isRightEdge ? 1 : -1) * (Math.abs(y - notch.apexY) + D);
  }

  function getActiveNotch(yMid: number): VerticalNotch | null {
    let activeNotch: VerticalNotch | null = null;
    let boundX = xEdge;
    for (const notch of sorted) {
      const shoulderOff = Math.abs(notch.shoulderX - notch.apexX);
      if (yMid < notch.apexY + shoulderOff && yMid > notch.apexY - shoulderOff) {
        const nx = getInnerNotchX(notch, yMid);
        if (isRightEdge ? nx < boundX : nx > boundX) {
          boundX = nx;
          activeNotch = notch;
        }
      }
    }
    return activeNotch;
  }

  let currentX = xEdge;
  for (let i = 0; i < uniqueYCrits.length - 1; i++) {
    const yA = uniqueYCrits[i];
    const yB = uniqueYCrits[i + 1];
    const yMid = (yA + yB) / 2;

    const activeNotch = getActiveNotch(yMid);
    const xA = activeNotch ? getInnerNotchX(activeNotch, yA) : xEdge;
    const xB = activeNotch ? getInnerNotchX(activeNotch, yB) : xEdge;

    if (Math.abs(currentX - xA) > EPS) {
      addLine(shapes, "CUT", currentX, yA, xA, yA);
    }

    addLine(shapes, "CUT", xA, yA, xB, yB);
    currentX = xB;
  }

  if (Math.abs(currentX - xEdge) > EPS) {
    addLine(shapes, "CUT", currentX, endY, xEdge, endY);
  }
}

// ---------------------------------------------------------------------------
// Span clipping (for corners where perpendicular notches eat into edges)
// ---------------------------------------------------------------------------

/**
 * Clip a horizontal edge span (startX..endX at yEdge) against perpendicular
 * vertical notches. A vertical notch on the left edge that opens leftward has
 * a 45° diagonal; where that diagonal intersects the horizontal edge gives the
 * point past which no metal exists. We clamp startX/endX accordingly.
 */
export function clipHorizontalSpan(
  yEdge: number,
  startX: number,
  endX: number,
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): { startX: number; endX: number } {
  let clippedStart = startX;
  let clippedEnd = endX;

  for (const n of leftNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = n.apexY - yEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX - (dist + D);
    if (xIntersect > clippedStart) clippedStart = xIntersect;
  }

  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = n.apexY - yEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX + (dist + D);
    if (xIntersect < clippedEnd) clippedEnd = xIntersect;
  }

  // Also handle the case where the horizontal edge is above the notch apex
  for (const n of leftNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = yEdge - n.apexY;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX - (dist + D);
    if (xIntersect > clippedStart) clippedStart = xIntersect;
  }

  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = yEdge - n.apexY;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX + (dist + D);
    if (xIntersect < clippedEnd) clippedEnd = xIntersect;
  }

  return { startX: clippedStart, endX: clippedEnd };
}

/**
 * Clip a vertical edge span (endY..startY at xEdge) against perpendicular
 * horizontal notches. Symmetric to clipHorizontalSpan.
 */
export function clipVerticalSpan(
  xEdge: number,
  startY: number,
  endY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
): { startY: number; endY: number } {
  let clippedStart = startY;
  let clippedEnd = endY;

  for (const n of topNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = n.apexX - xEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY + (dist + D);
    if (yIntersect < clippedStart) clippedStart = yIntersect;
  }

  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = n.apexX - xEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY - (dist + D);
    if (yIntersect > clippedEnd) clippedEnd = yIntersect;
  }

  // Also handle right-side intersections
  for (const n of topNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = xEdge - n.apexX;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY + (dist + D);
    if (yIntersect < clippedStart) clippedStart = yIntersect;
  }

  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = xEdge - n.apexX;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY - (dist + D);
    if (yIntersect > clippedEnd) clippedEnd = yIntersect;
  }

  return { startY: clippedStart, endY: clippedEnd };
}

/** Draw a simple single line segment (no notch routing). */
export { addLine };