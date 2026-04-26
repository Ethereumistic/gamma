/**
 * geometry/trim.ts — Useless-line trimming utilities (TEMPORARY).
 *
 * This module contains the ad-hoc midpoint-sampling trimming system that will
 * be replaced by MetalRegion polygon clipping in Phase 3. It is extracted
 * verbatim from geometry.ts to enable modularization without logic changes.
 *
 * TODO: Delete this entire file in Phase 3 when MetalRegion clipping replaces it.
 */

import type { LineShape } from "@/features/sheet-metal/types";
import { type HorizontalNotch, type VerticalNotch } from "./notches";
import { EPS } from "./math";

// ---------------------------------------------------------------------------
// addLine reuse — import from edges to avoid duplication
// ---------------------------------------------------------------------------

import { addLine } from "./edges";

// ---------------------------------------------------------------------------
// Point-in-metal tests
// ---------------------------------------------------------------------------

/**
 * For a horizontal line at `fixedY`, determine whether the point `(x, fixedY)`
 * lies inside the valid sheet-metal area defined by all notch boundaries.
 */
export function isInsideMetalHorizontal(
  x: number,
  fixedY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): boolean {
  // Check top notches (apexY ≈ y1, they cut upward into the flange)
  for (const n of topNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    if (x > n.apexX - shoulderOff - EPS && x < n.apexX + shoulderOff + EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryY = n.apexY + (Math.abs(x - n.apexX) + D);
      if (fixedY > boundaryY + EPS) return false;
    }
  }

  // Check bottom notches (apexY ≈ y0, they cut downward into the flange)
  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    if (x > n.apexX - shoulderOff - EPS && x < n.apexX + shoulderOff + EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryY = n.apexY - (Math.abs(x - n.apexX) + D);
      if (fixedY < boundaryY - EPS) return false;
    }
  }

  // Check left notches (apexX ≈ x0, they cut leftward into the flange)
  for (const n of leftNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    if (fixedY < n.apexY + shoulderOff + EPS && fixedY > n.apexY - shoulderOff - EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryX = n.apexX - (Math.abs(fixedY - n.apexY) + D);
      if (x < boundaryX - EPS) return false;
    }
  }

  // Check right notches (apexX ≈ x1, they cut rightward into the flange)
  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    if (fixedY < n.apexY + shoulderOff + EPS && fixedY > n.apexY - shoulderOff - EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryX = n.apexX + (Math.abs(fixedY - n.apexY) + D);
      if (x > boundaryX + EPS) return false;
    }
  }

  return true;
}

export function isInsideMetalVertical(
  fixedX: number,
  y: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): boolean {
  // Check left notches (apexX ≈ x0, cut leftward)
  for (const n of leftNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    if (y < n.apexY + shoulderOff + EPS && y > n.apexY - shoulderOff - EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryX = n.apexX - (Math.abs(y - n.apexY) + D);
      if (fixedX < boundaryX - EPS) return false;
    }
  }

  // Check right notches (apexX ≈ x1, cut rightward)
  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    if (y < n.apexY + shoulderOff + EPS && y > n.apexY - shoulderOff - EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryX = n.apexX + (Math.abs(y - n.apexY) + D);
      if (fixedX > boundaryX + EPS) return false;
    }
  }

  // Check top notches (apexY ≈ y1, cut upward)
  for (const n of topNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    if (fixedX > n.apexX - shoulderOff - EPS && fixedX < n.apexX + shoulderOff + EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryY = n.apexY + (Math.abs(fixedX - n.apexX) + D);
      if (y > boundaryY + EPS) return false;
    }
  }

  // Check bottom notches (apexY ≈ y0, cut downward)
  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    if (fixedX > n.apexX - shoulderOff - EPS && fixedX < n.apexX + shoulderOff + EPS) {
      const D = (n.flap || 0) * Math.SQRT2;
      const boundaryY = n.apexY - (Math.abs(fixedX - n.apexX) + D);
      if (y < boundaryY - EPS) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Critical coordinate collection
// ---------------------------------------------------------------------------

export function getHorizontalCritXs(
  fixedY: number,
  startX: number,
  endX: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): number[] {
  const xs: number[] = [startX, endX];

  for (const n of [...topNotches, ...bottomNotches]) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    xs.push(n.apexX - shoulderOff, n.apexX, n.apexX + shoulderOff);
    if (D > 0) {
      xs.push(n.apexX - Math.max(0, shoulderOff - D));
      xs.push(n.apexX + Math.max(0, shoulderOff - D));
    }
  }

  for (const n of [...leftNotches, ...rightNotches]) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (fixedY > n.apexY - shoulderOff - EPS && fixedY < n.apexY + shoulderOff + EPS) {
      const dist = Math.abs(fixedY - n.apexY) + D;
      const isLeft = n.shoulderX < n.apexX;
      const boundaryX = isLeft ? n.apexX - dist : n.apexX + dist;
      xs.push(boundaryX);
      xs.push(n.apexX);
    }
  }

  return xs
    .filter(x => x >= startX - EPS && x <= endX + EPS)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]) > EPS);
}

export function getVerticalCritYs(
  fixedX: number,
  startY: number,
  endY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): number[] {
  const ys: number[] = [startY, endY];

  for (const n of [...leftNotches, ...rightNotches]) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    ys.push(n.apexY + shoulderOff, n.apexY, n.apexY - shoulderOff);
    if (D > 0) {
      ys.push(n.apexY + Math.max(0, shoulderOff - D));
      ys.push(n.apexY - Math.max(0, shoulderOff - D));
    }
  }

  for (const n of [...topNotches, ...bottomNotches]) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (fixedX > n.apexX - shoulderOff - EPS && fixedX < n.apexX + shoulderOff + EPS) {
      const dist = Math.abs(fixedX - n.apexX) + D;
      const isTop = n.shoulderY > n.apexY;
      const boundaryY = isTop ? n.apexY + dist : n.apexY - dist;
      ys.push(boundaryY);
      ys.push(n.apexY);
    }
  }

  return ys
    .filter(y => y >= Math.min(startY, endY) - EPS && y <= Math.max(startY, endY) + EPS)
    .sort((a, b) => a - b)
    .filter((y, i, arr) => i === 0 || Math.abs(y - arr[i - 1]) > EPS);
}

// ---------------------------------------------------------------------------
// Trimmable line drawing
// ---------------------------------------------------------------------------

export function addTrimmableHorizontalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  startX: number,
  endX: number,
  fixedY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): void {
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, startX, fixedY, endX, fixedY);
    return;
  }

  const critXs = getHorizontalCritXs(fixedY, startX, endX, topNotches, bottomNotches, leftNotches, rightNotches);

  for (let i = 0; i < critXs.length - 1; i++) {
    const xA = critXs[i];
    const xB = critXs[i + 1];
    const xMid = (xA + xB) / 2;

    if (isInsideMetalHorizontal(xMid, fixedY, topNotches, bottomNotches, leftNotches, rightNotches)) {
      addLine(shapes, layer, xA, fixedY, xB, fixedY);
    }
  }
}

export function addTrimmableVerticalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  fixedX: number,
  startY: number,
  endY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): void {
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, fixedX, startY, fixedX, endY);
    return;
  }

  const critYs = getVerticalCritYs(fixedX, startY, endY, topNotches, bottomNotches, leftNotches, rightNotches);

  for (let i = 0; i < critYs.length - 1; i++) {
    const yA = critYs[i];
    const yB = critYs[i + 1];
    const yMid = (yA + yB) / 2;

    if (isInsideMetalVertical(fixedX, yMid, topNotches, bottomNotches, leftNotches, rightNotches)) {
      addLine(shapes, layer, fixedX, yA, fixedX, yB);
    }
  }
}

export function addTrimmableDiagonalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  lx1: number, ly1: number,
  lx2: number, ly2: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): void {
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, lx1, ly1, lx2, ly2);
    return;
  }

  const dx = lx2 - lx1;
  const dy = ly2 - ly1;
  const ts: number[] = [0, 1];

  // For each notch, compute where the diagonal line intersects the notch boundary
  for (const n of [...topNotches, ...bottomNotches]) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (Math.abs(dx) > EPS) {
      for (const critX of [n.apexX - shoulderOff, n.apexX, n.apexX + shoulderOff]) {
        const t = (critX - lx1) / dx;
        if (t > -EPS && t < 1 + EPS) ts.push(Math.max(0, Math.min(1, t)));
      }
      if (D > 0) {
        for (const critX of [n.apexX - Math.max(0, shoulderOff - D), n.apexX + Math.max(0, shoulderOff - D)]) {
          const t = (critX - lx1) / dx;
          if (t > -EPS && t < 1 + EPS) ts.push(Math.max(0, Math.min(1, t)));
        }
      }
    }
  }

  for (const n of [...leftNotches, ...rightNotches]) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (Math.abs(dy) > EPS) {
      for (const critY of [n.apexY + shoulderOff, n.apexY, n.apexY - shoulderOff]) {
        const t = (critY - ly1) / dy;
        if (t > -EPS && t < 1 + EPS) ts.push(Math.max(0, Math.min(1, t)));
      }
      if (D > 0) {
        for (const critY of [n.apexY + Math.max(0, shoulderOff - D), n.apexY - Math.max(0, shoulderOff - D)]) {
          const t = (critY - ly1) / dy;
          if (t > -EPS && t < 1 + EPS) ts.push(Math.max(0, Math.min(1, t)));
        }
      }
    }
  }

  const sortedTs = ts.sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || Math.abs(t - arr[i - 1]) > EPS);

  for (let i = 0; i < sortedTs.length - 1; i++) {
    const tA = sortedTs[i];
    const tB = sortedTs[i + 1];
    const tMid = (tA + tB) / 2;

    const mx = lx1 + tMid * dx;
    const my = ly1 + tMid * dy;

    const inside = isInsideMetalHorizontal(mx, my, topNotches, bottomNotches, leftNotches, rightNotches) &&
                   isInsideMetalVertical(mx, my, topNotches, bottomNotches, leftNotches, rightNotches);

    if (inside) {
      addLine(
        shapes, layer,
        lx1 + tA * dx, ly1 + tA * dy,
        lx1 + tB * dx, ly1 + tB * dy,
      );
    }
  }
}