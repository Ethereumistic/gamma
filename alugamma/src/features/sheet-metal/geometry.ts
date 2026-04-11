import {
  sideKeys,
  type FrezMeasurement,
  type GeometryResult,
  type LineShape,
  type Layer,
  type Measurement,
  type FlangeMeasurement,
  type SheetMetalModel,
  type SideKey,
} from "@/features/sheet-metal/types";

type HorizontalNotch = {
  apexX: number;
  apexY: number;
  shoulderY: number;
  flap?: number;
};

type VerticalNotch = {
  apexX: number;
  apexY: number;
  shoulderX: number;
  flap?: number;
};

type AmountItem = {
  amount: number;
};

function addLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  if (x1 === x2 && y1 === y2) {
    return;
  }

  shapes.push({ type: "line", layer, x1, y1, x2, y2 });
}

export function sumMeasurements<T extends AmountItem>(items: T[]) {
  return items.reduce((total, item) => total + item.amount, 0);
}

export function getCumulativeOffsets<T extends AmountItem>(items: T[]) {
  const offsets: number[] = [];
  let total = 0;

  for (const item of items) {
    total += item.amount;
    offsets.push(total);
  }

  return offsets;
}

function getFlangeDepths(model: SheetMetalModel): Record<SideKey, number> {
  return {
    top: sumMeasurements(model.sides.top.flanges),
    right: sumMeasurements(model.sides.right.flanges),
    bottom: sumMeasurements(model.sides.bottom.flanges),
    left: sumMeasurements(model.sides.left.flanges),
  };
}

function getFrezOffsets(model: SheetMetalModel) {
  return {
    top: getCumulativeOffsets(model.sides.top.frezLines),
    right: getCumulativeOffsets(model.sides.right.frezLines),
    bottom: getCumulativeOffsets(model.sides.bottom.frezLines),
    left: getCumulativeOffsets(model.sides.left.frezLines),
  };
}

function getResolvedFrezPositions(
  model: SheetMetalModel,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  frezOffsets: Record<SideKey, number[]>,
) {
  return {
    top: frezOffsets.top.map((offset) => (model.sides.top.frezMode === "inner" ? y1 - offset : y1 + offset)),
    right: frezOffsets.right.map((offset) => (model.sides.right.frezMode === "inner" ? x1 - offset : x1 + offset)),
    bottom: frezOffsets.bottom.map((offset) => (model.sides.bottom.frezMode === "inner" ? y0 + offset : y0 - offset)),
    left: frezOffsets.left.map((offset) => (model.sides.left.frezMode === "inner" ? x0 + offset : x0 - offset)),
  };
}

function collectWarnings(model: SheetMetalModel, flangeDepths: Record<SideKey, number>) {
  const warnings: string[] = [];

  for (const side of sideKeys) {
    const offsets = getCumulativeOffsets(model.sides[side].frezLines);
    if (offsets.length === 0) {
      continue;
    }

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



function addHorizontalCutEdge(
  shapes: LineShape[],
  yEdge: number,
  startX: number,
  endX: number,
  notches: HorizontalNotch[],
) {
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

  xCrits = xCrits.filter(x => x >= startX - 1e-5 && x <= endX + 1e-5).sort((a, b) => a - b);
  const uniqueXCrits: number[] = [];
  for (const x of xCrits) {
    if (uniqueXCrits.length === 0 || Math.abs(x - uniqueXCrits[uniqueXCrits.length - 1]) > 1e-5) {
      uniqueXCrits.push(x);
    }
  }

  function getInnerNotchY(notch: HorizontalNotch, x: number) {
    const D = (notch.flap || 0) * Math.SQRT2;
    return notch.apexY + (isTopEdge ? 1 : -1) * (Math.abs(x - notch.apexX) + D);
  }

  function getActiveNotch(xMid: number) {
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

    if (Math.abs(currentY - yA) > 1e-5) {
      addLine(shapes, "CUT", xA, currentY, xA, yA);
    }

    addLine(shapes, "CUT", xA, yA, xB, yB);
    currentY = yB;
  }

  if (Math.abs(currentY - yEdge) > 1e-5) {
    addLine(shapes, "CUT", endX, currentY, endX, yEdge);
  }
}

function addVerticalCutEdge(
  shapes: LineShape[],
  xEdge: number,
  startY: number,
  endY: number,
  notches: VerticalNotch[],
) {
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

  yCrits = yCrits.filter(y => y <= startY + 1e-5 && y >= endY - 1e-5).sort((a, b) => b - a);
  const uniqueYCrits: number[] = [];
  for (const y of yCrits) {
    if (uniqueYCrits.length === 0 || Math.abs(uniqueYCrits[uniqueYCrits.length - 1] - y) > 1e-5) {
      uniqueYCrits.push(y);
    }
  }

  function getInnerNotchX(notch: VerticalNotch, y: number) {
    const D = (notch.flap || 0) * Math.SQRT2;
    return notch.apexX + (isRightEdge ? 1 : -1) * (Math.abs(y - notch.apexY) + D);
  }

  function getActiveNotch(yMid: number) {
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

    if (Math.abs(currentX - xA) > 1e-5) {
      addLine(shapes, "CUT", currentX, yA, xA, yA);
    }

    addLine(shapes, "CUT", xA, yA, xB, yB);
    currentX = xB;
  }

  if (Math.abs(currentX - xEdge) > 1e-5) {
    addLine(shapes, "CUT", currentX, endY, xEdge, endY);
  }
}

/**
 * Clip a horizontal edge span (startX..endX at yEdge) against perpendicular
 * vertical notches.  A vertical notch on the left edge that opens leftward has
 * a 45° diagonal; where that diagonal intersects the horizontal edge gives the
 * point past which no metal exists.  We clamp startX/endX accordingly.
 */
function clipHorizontalSpan(
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
    const dist = n.apexY - yEdge;            // distance from notch apex down to the horizontal edge
    if (dist < 0) continue;                   // horizontal edge is above the notch apex – skip
    const D = (n.flap || 0) * Math.SQRT2;
    // Only clip if the diagonal actually reaches the horizontal edge
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX - (dist + D);  // left-notch diagonal going down-left
    if (xIntersect > clippedStart) clippedStart = xIntersect;
  }

  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = n.apexY - yEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX + (dist + D);  // right-notch diagonal going down-right
    if (xIntersect < clippedEnd) clippedEnd = xIntersect;
  }

  // Also handle the case where the horizontal edge is above the notch apex
  // (top edge vs left/right notches opening upward)
  for (const n of leftNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = yEdge - n.apexY;             // distance from notch apex up to the horizontal edge
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX - (dist + D);  // left-notch diagonal going up-left
    if (xIntersect > clippedStart) clippedStart = xIntersect;
  }

  for (const n of rightNotches) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const dist = yEdge - n.apexY;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const xIntersect = n.apexX + (dist + D);  // right-notch diagonal going up-right
    if (xIntersect < clippedEnd) clippedEnd = xIntersect;
  }

  return { startX: clippedStart, endX: clippedEnd };
}

/**
 * Clip a vertical edge span (endY..startY at xEdge) against perpendicular
 * horizontal notches.  Symmetric to clipHorizontalSpan.
 */
function clipVerticalSpan(
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
    const dist = n.apexX - xEdge;             // distance from notch apex left to the vertical edge
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY + (dist + D);  // top-notch diagonal going up-left
    if (yIntersect < clippedStart) clippedStart = yIntersect;
  }

  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = n.apexX - xEdge;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY - (dist + D);  // bottom-notch diagonal going down-left
    if (yIntersect > clippedEnd) clippedEnd = yIntersect;
  }

  // Also handle right-side intersections (notch apex to the left of the vertical edge)
  for (const n of topNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = xEdge - n.apexX;             // distance from notch apex right to the vertical edge
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY + (dist + D);  // top-notch diagonal going up-right
    if (yIntersect < clippedStart) clippedStart = yIntersect;
  }

  for (const n of bottomNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const dist = xEdge - n.apexX;
    if (dist < 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    if (dist > shoulderOff) continue;
    const yIntersect = n.apexY - (dist + D);  // bottom-notch diagonal going down-right
    if (yIntersect > clippedEnd) clippedEnd = yIntersect;
  }

  return { startY: clippedStart, endY: clippedEnd };
}

function getCornerShoulderOffset(items: Measurement[]) {
  if (items.length === 0) {
    return 0;
  }

  return items.length > 1 ? items[0].amount : sumMeasurements(items);
}

// ---------------------------------------------------------------------------
// Useless-line trimming utilities
// ---------------------------------------------------------------------------

/**
 * For a horizontal line at `fixedY`, determine whether the point `(x, fixedY)`
 * lies inside the valid sheet-metal area defined by all notch boundaries.
 *
 * A point is inside metal when it is NOT inside any V-notch cutout on any edge.
 *
 * - Top notches cut upward from `y1`; the boundary at X is `apexY + (|x-apexX| + D)`.
 *   A point is removed when `fixedY > boundaryY`.
 * - Bottom notches cut downward from `y0`; the boundary at X is `apexY - (|x-apexX| + D)`.
 *   A point is removed when `fixedY < boundaryY`.
 * - Left notches cut leftward from `x0`; the boundary at Y is `apexX - (|y-apexY| + D)`.
 *   A point is removed when `x < boundaryX`.
 * - Right notches cut rightward from `x1`; the boundary at Y is `apexX + (|y-apexY| + D)`.
 *   A point is removed when `x > boundaryX`.
 */
const EPS = 1e-5;

function isInsideMetalHorizontal(
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

function isInsideMetalVertical(
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

/**
 * Collect critical X coordinates where the notch boundary may change for a
 * horizontal line at `fixedY`. These are points where the line might transition
 * between "inside metal" and "inside a notch cutout".
 */
function getHorizontalCritXs(
  fixedY: number,
  startX: number,
  endX: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): number[] {
  const xs: number[] = [startX, endX];

  // From top/bottom notches: apexX, apexX ± shoulderOff, flap transition points
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

  // From left/right notches: intersection of fixedY with the notch boundary
  // Left notch boundary: boundaryX = apexX - (|y - apexY| + D)
  // At fixedY: boundaryX = apexX - (|fixedY - apexY| + D)
  for (const n of [...leftNotches, ...rightNotches]) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    // The notch affects Y range [apexY - shoulderOff, apexY + shoulderOff]
    if (fixedY > n.apexY - shoulderOff - EPS && fixedY < n.apexY + shoulderOff + EPS) {
      // Boundary X at this Y
      const dist = Math.abs(fixedY - n.apexY) + D;
      // For left notch (cuts leftward): boundaryX = apexX - dist
      // For right notch (cuts rightward): boundaryX = apexX + dist
      // We add both the boundary and the apexY projection as critical points
      const isLeft = n.shoulderX < n.apexX;
      const boundaryX = isLeft ? n.apexX - dist : n.apexX + dist;
      xs.push(boundaryX);
      // Also add the apexX as a critical point (where the notch is deepest)
      // Actually the intersection of fixedY with the notch opening edges
      // The notch opens at apexY ± shoulderOff. At fixedY, the notch width is:
      // |fixedY - apexY|. The boundary at this Y is the above computed value.
      // But we also need the point where fixedY intersects the notch opening
      // which is just the shoulder range check we already did.
      // Add the apexX point since it's where the boundary is closest
      xs.push(n.apexX);
    }
  }

  // Filter to range and deduplicate
  return xs
    .filter(x => x >= startX - EPS && x <= endX + EPS)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]) > EPS);
}

/**
 * Collect critical Y coordinates for a vertical line at `fixedX`.
 */
function getVerticalCritYs(
  fixedX: number,
  startY: number,
  endY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
): number[] {
  const ys: number[] = [startY, endY];

  // From left/right notches: apexY, apexY ± shoulderOff, flap transition points
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

  // From top/bottom notches: intersection of fixedX with the notch boundary
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

/**
 * Add a horizontal line (fixed Y) that is trimmed against all V-notch boundaries.
 * Only segments whose midpoint is inside the metal area are drawn.
 */
function addTrimmableHorizontalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  startX: number,
  endX: number,
  fixedY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
) {
  // Fast path: if no notches at all, just draw the line
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, startX, fixedY, endX, fixedY);
    return;
  }

  console.log('[TRIM] Horizontal line y=' + fixedY.toFixed(2) + ' x=[' + startX.toFixed(2) + ',' + endX.toFixed(2) + '] notches: T=' + topNotches.length + ' B=' + bottomNotches.length + ' L=' + leftNotches.length + ' R=' + rightNotches.length);

  const critXs = getHorizontalCritXs(fixedY, startX, endX, topNotches, bottomNotches, leftNotches, rightNotches);

  for (let i = 0; i < critXs.length - 1; i++) {
    const xA = critXs[i];
    const xB = critXs[i + 1];
    const xMid = (xA + xB) / 2;

    if (isInsideMetalHorizontal(xMid, fixedY, topNotches, bottomNotches, leftNotches, rightNotches)) {
      addLine(shapes, layer, xA, fixedY, xB, fixedY);
    } else {
      console.log('[TRIM]   REMOVED segment [' + xA.toFixed(2) + ',' + xB.toFixed(2) + ']');
    }
  }
}

/**
 * Add a vertical line (fixed X) that is trimmed against all V-notch boundaries.
 */
function addTrimmableVerticalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  fixedX: number,
  startY: number,
  endY: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
) {
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, fixedX, startY, fixedX, endY);
    return;
  }

  console.log('[TRIM] Vertical line x=' + fixedX.toFixed(2) + ' y=[' + startY.toFixed(2) + ',' + endY.toFixed(2) + '] notches: T=' + topNotches.length + ' B=' + bottomNotches.length + ' L=' + leftNotches.length + ' R=' + rightNotches.length);

  const critYs = getVerticalCritYs(fixedX, startY, endY, topNotches, bottomNotches, leftNotches, rightNotches);

  for (let i = 0; i < critYs.length - 1; i++) {
    const yA = critYs[i];
    const yB = critYs[i + 1];
    const yMid = (yA + yB) / 2;

    if (isInsideMetalVertical(fixedX, yMid, topNotches, bottomNotches, leftNotches, rightNotches)) {
      addLine(shapes, layer, fixedX, yA, fixedX, yB);
    } else {
      console.log('[TRIM]   REMOVED segment [' + yA.toFixed(2) + ',' + yB.toFixed(2) + ']');
    }
  }
}

/**
 * Add a diagonal (45-degree) FREZ line, trimmed against notch boundaries.
 * The line goes from (x1,y1) to (x2,y2) at 45 degrees.
 * We sample multiple points along the line and clip segments that fall
 * inside notch cutouts.
 */
function addTrimmableDiagonalLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  lx1: number, ly1: number,
  lx2: number, ly2: number,
  topNotches: HorizontalNotch[],
  bottomNotches: HorizontalNotch[],
  leftNotches: VerticalNotch[],
  rightNotches: VerticalNotch[],
) {
  if (topNotches.length === 0 && bottomNotches.length === 0 &&
      leftNotches.length === 0 && rightNotches.length === 0) {
    addLine(shapes, layer, lx1, ly1, lx2, ly2);
    return;
  }

  // Collect critical t-values (parameter t from 0 to 1 along the line)
  // where the line might cross a notch boundary.
  const dx = lx2 - lx1;
  const dy = ly2 - ly1;
  const ts: number[] = [0, 1];

  // For each notch, compute where the diagonal line intersects the notch boundary
  // Top/bottom notches
  for (const n of [...topNotches, ...bottomNotches]) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    if (shoulderOff === 0) continue;
    const D = (n.flap || 0) * Math.SQRT2;
    // The notch boundary at X: boundaryY = apexY ± (|X - apexX| + D)
    // The diagonal: Y(t) = ly1 + t*dy, X(t) = lx1 + t*dx
    // We need critical t where X(t) = apexX, apexX ± shoulderOff, etc.
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

  // Left/right notches
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

  // Sort and deduplicate t values
  const sortedTs = ts.sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || Math.abs(t - arr[i - 1]) > EPS);

  // Check each segment
  for (let i = 0; i < sortedTs.length - 1; i++) {
    const tA = sortedTs[i];
    const tB = sortedTs[i + 1];
    const tMid = (tA + tB) / 2;

    const mx = lx1 + tMid * dx;
    const my = ly1 + tMid * dy;

    // Check if midpoint is inside metal using both horizontal and vertical checks
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

// Removed legacy hasCornerRelief to compute dynamically

function addFrezDrivenHorizontalNotches(
  startEdgeNotches: HorizontalNotch[],
  endEdgeNotches: HorizontalNotch[],
  frezLines: FrezMeasurement[],
  positions: number[],
  startTarget: { apexY: number; shoulderY: number },
  endTarget: { apexY: number; shoulderY: number },
) {
  frezLines.forEach((line, index) => {
    const apexX = positions[index];
    if (apexX === undefined) {
      return;
    }

    if (line.notches.start) {
      startEdgeNotches.push({ apexX, apexY: startTarget.apexY, shoulderY: startTarget.shoulderY });
    }

    if (line.notches.end) {
      endEdgeNotches.push({ apexX, apexY: endTarget.apexY, shoulderY: endTarget.shoulderY });
    }
  });
}

function addFrezDrivenVerticalNotches(
  startEdgeNotches: VerticalNotch[],
  endEdgeNotches: VerticalNotch[],
  frezLines: FrezMeasurement[],
  positions: number[],
  startTarget: { apexX: number; shoulderX: number },
  endTarget: { apexX: number; shoulderX: number },
) {
  frezLines.forEach((line, index) => {
    const apexY = positions[index];
    if (apexY === undefined) {
      return;
    }

    if (line.notches.start) {
      startEdgeNotches.push({ apexX: startTarget.apexX, apexY, shoulderX: startTarget.shoulderX });
    }

    if (line.notches.end) {
      endEdgeNotches.push({ apexX: endTarget.apexX, apexY, shoulderX: endTarget.shoulderX });
    }
  });
}

function addHoleLines(
  shapes: LineShape[],
  holeData: NonNullable<FlangeMeasurement["holes"]>,
  region: { xMin: number; xMax: number; yMin: number; yMax: number },
  side: SideKey,
) {
  const { xMin, xMax, yMin, yMax } = region;
  const { sideOffset, endOffset, length, placement, orientation } = holeData;
  const line1 = holeData.line1Enabled !== false;
  const line2 = holeData.line2Enabled !== false;

  if (side === "top") {
    if (orientation === "horizontal") {
      const y = placement === "inner" ? yMin + endOffset : yMax - endOffset;
      const lx1 = xMin + sideOffset;
      const lx2 = xMax - sideOffset;
      const len = Math.min(length, Math.max(0, lx2 - lx1) / 2);
      if (line1) addLine(shapes, "HOLES", lx1, y, lx1 + len, y);
      if (line2) addLine(shapes, "HOLES", lx2 - len, y, lx2, y);
    } else {
      const x1 = xMin + sideOffset;
      const x2 = xMax - sideOffset;
      const y1 = placement === "inner" ? yMin + endOffset : yMax - endOffset;
      const y2 = placement === "inner" ? y1 + length : y1 - length;
      if (line1) addLine(shapes, "HOLES", x1, y1, x1, y2);
      if (line2) addLine(shapes, "HOLES", x2, y1, x2, y2);
    }
  } else if (side === "bottom") {
    if (orientation === "horizontal") {
      const y = placement === "inner" ? yMax - endOffset : yMin + endOffset;
      const lx1 = xMin + sideOffset;
      const lx2 = xMax - sideOffset;
      const len = Math.min(length, Math.max(0, lx2 - lx1) / 2);
      if (line1) addLine(shapes, "HOLES", lx1, y, lx1 + len, y);
      if (line2) addLine(shapes, "HOLES", lx2 - len, y, lx2, y);
    } else {
      const x1 = xMin + sideOffset;
      const x2 = xMax - sideOffset;
      const y1 = placement === "inner" ? yMax - endOffset : yMin + endOffset;
      const y2 = placement === "inner" ? y1 - length : y1 + length;
      if (line1) addLine(shapes, "HOLES", x1, y1, x1, y2);
      if (line2) addLine(shapes, "HOLES", x2, y1, x2, y2);
    }
  } else if (side === "left") {
    if (orientation === "horizontal") {
      const x = placement === "inner" ? xMax - endOffset : xMin + endOffset;
      const y1 = yMin + sideOffset;
      const y2 = yMax - sideOffset;
      const len = Math.min(length, Math.max(0, y2 - y1) / 2);
      if (line1) addLine(shapes, "HOLES", x, y1, x, y1 + len);
      if (line2) addLine(shapes, "HOLES", x, y2 - len, x, y2);
    } else {
      const y1 = yMin + sideOffset;
      const y2 = yMax - sideOffset;
      const x1 = placement === "inner" ? xMax - endOffset : xMin + endOffset;
      const x2 = placement === "inner" ? x1 - length : x1 + length;
      if (line1) addLine(shapes, "HOLES", x1, y1, x2, y1);
      if (line2) addLine(shapes, "HOLES", x1, y2, x2, y2);
    }
  } else if (side === "right") {
    if (orientation === "horizontal") {
      const x = placement === "inner" ? xMin + endOffset : xMax - endOffset;
      const y1 = yMin + sideOffset;
      const y2 = yMax - sideOffset;
      const len = Math.min(length, Math.max(0, y2 - y1) / 2);
      if (line1) addLine(shapes, "HOLES", x, y1, x, y1 + len);
      if (line2) addLine(shapes, "HOLES", x, y2 - len, x, y2);
    } else {
      const y1 = yMin + sideOffset;
      const y2 = yMax - sideOffset;
      const x1 = placement === "inner" ? xMin + endOffset : xMax - endOffset;
      const x2 = placement === "inner" ? x1 + length : x1 - length;
      if (line1) addLine(shapes, "HOLES", x1, y1, x2, y1);
      if (line2) addLine(shapes, "HOLES", x1, y2, x2, y2);
    }
  }
}

function _computeSheetMetalGeometry(model: SheetMetalModel): GeometryResult {
  const shapes: LineShape[] = [];
  const flangeDepths = getFlangeDepths(model);

  const x0 = flangeDepths.left;
  const y0 = flangeDepths.bottom;
  const x1 = x0 + model.baseWidth;
  const y1 = y0 + model.baseHeight;

  const cutX0 = x0 - model.offsetCut;
  const cutY0 = y0 - model.offsetCut;
  const cutX1 = x1 + model.offsetCut;
  const cutY1 = y1 + model.offsetCut;

  const outerLeft = -model.offsetCut;
  const outerBottom = -model.offsetCut;
  const outerRight = model.baseWidth + flangeDepths.left + flangeDepths.right + model.offsetCut;
  const outerTop = model.baseHeight + flangeDepths.bottom + flangeDepths.top + model.offsetCut;

  const frezOffsets = getFrezOffsets(model);
  const frezPositions = getResolvedFrezPositions(model, x0, y0, x1, y1, frezOffsets);

  const hasTopLeftRelief =
    model.sides.top.flanges.some((f) => f.reliefs.start) ||
    model.sides.left.flanges.some((f) => f.reliefs.start) ||
    model.sides.top.frezLines.some((f) => f.notches.start) ||
    model.sides.left.frezLines.some((f) => f.notches.start);

  const hasTopRightRelief =
    model.sides.top.flanges.some((f) => f.reliefs.end) ||
    model.sides.right.flanges.some((f) => f.reliefs.start) ||
    model.sides.top.frezLines.some((f) => f.notches.end) ||
    model.sides.right.frezLines.some((f) => f.notches.start);

  const hasBottomRightRelief =
    model.sides.bottom.flanges.some((f) => f.reliefs.end) ||
    model.sides.right.flanges.some((f) => f.reliefs.end) ||
    model.sides.bottom.frezLines.some((f) => f.notches.end) ||
    model.sides.right.frezLines.some((f) => f.notches.end);

  const hasBottomLeftRelief =
    model.sides.bottom.flanges.some((f) => f.reliefs.start) ||
    model.sides.left.flanges.some((f) => f.reliefs.end) ||
    model.sides.bottom.frezLines.some((f) => f.notches.start) ||
    model.sides.left.frezLines.some((f) => f.notches.end);

  const topSpanStart = hasTopLeftRelief ? outerLeft : cutX0;
  const topSpanEnd = hasTopRightRelief ? outerRight : cutX1;
  const bottomSpanStart = hasBottomLeftRelief ? outerLeft : cutX0;
  const bottomSpanEnd = hasBottomRightRelief ? outerRight : cutX1;
  const leftSpanTop = hasTopLeftRelief ? outerTop : cutY1;
  const leftSpanBottom = hasBottomLeftRelief ? outerBottom : cutY0;
  const rightSpanTop = hasTopRightRelief ? outerTop : cutY1;
  const rightSpanBottom = hasBottomRightRelief ? outerBottom : cutY0;

  // =========================================================================
  // Phase 1: Compute all notches BEFORE drawing any FREZ lines.
  // This allows us to trim FREZ lines against the notch boundaries.
  // =========================================================================

  const topShoulderY = y1 + getCornerShoulderOffset(model.sides.top.flanges);
  const bottomShoulderY = y0 - getCornerShoulderOffset(model.sides.bottom.flanges);
  const leftShoulderX = x0 - getCornerShoulderOffset(model.sides.left.flanges);
  const rightShoulderX = x1 + getCornerShoulderOffset(model.sides.right.flanges);

  const topNotches: HorizontalNotch[] = [];
  const bottomNotches: HorizontalNotch[] = [];
  const leftNotches: VerticalNotch[] = [];
  const rightNotches: VerticalNotch[] = [];

  addFrezDrivenHorizontalNotches(
    topNotches,
    bottomNotches,
    model.sides.left.frezLines,
    frezPositions.left,
    { apexY: y1, shoulderY: topShoulderY },
    { apexY: y0, shoulderY: bottomShoulderY },
  );
  addFrezDrivenHorizontalNotches(
    topNotches,
    bottomNotches,
    model.sides.right.frezLines,
    frezPositions.right,
    { apexY: y1, shoulderY: topShoulderY },
    { apexY: y0, shoulderY: bottomShoulderY },
  );
  addFrezDrivenVerticalNotches(
    leftNotches,
    rightNotches,
    model.sides.top.frezLines,
    frezPositions.top,
    { apexX: x0, shoulderX: leftShoulderX },
    { apexX: x1, shoulderX: rightShoulderX },
  );
  addFrezDrivenVerticalNotches(
    leftNotches,
    rightNotches,
    model.sides.bottom.frezLines,
    frezPositions.bottom,
    { apexX: x0, shoulderX: leftShoulderX },
    { apexX: x1, shoulderX: rightShoulderX },
  );

  // Inner frez notches
  const innerFrezOffsetsTop    = getCumulativeOffsets(model.sides.top.innerFrezLines);
  const innerFrezOffsetsBottom = getCumulativeOffsets(model.sides.bottom.innerFrezLines);
  const innerFrezOffsetsLeft   = getCumulativeOffsets(model.sides.left.innerFrezLines);
  const innerFrezOffsetsRight  = getCumulativeOffsets(model.sides.right.innerFrezLines);

  addFrezDrivenHorizontalNotches(
    topNotches,
    bottomNotches,
    model.sides.left.innerFrezLines,
    innerFrezOffsetsLeft.map((o) => x0 + o),
    { apexY: y1, shoulderY: topShoulderY },
    { apexY: y0, shoulderY: bottomShoulderY },
  );
  addFrezDrivenHorizontalNotches(
    topNotches,
    bottomNotches,
    model.sides.right.innerFrezLines,
    innerFrezOffsetsRight.map((o) => x1 - o),
    { apexY: y1, shoulderY: topShoulderY },
    { apexY: y0, shoulderY: bottomShoulderY },
  );
  addFrezDrivenVerticalNotches(
    leftNotches,
    rightNotches,
    model.sides.top.innerFrezLines,
    innerFrezOffsetsTop.map((o) => y1 - o),
    { apexX: x0, shoulderX: leftShoulderX },
    { apexX: x1, shoulderX: rightShoulderX },
  );
  addFrezDrivenVerticalNotches(
    leftNotches,
    rightNotches,
    model.sides.bottom.innerFrezLines,
    innerFrezOffsetsBottom.map((o) => y0 + o),
    { apexX: x0, shoulderX: leftShoulderX },
    { apexX: x1, shoulderX: rightShoulderX },
  );

  // Flange relief notches (add to notch arrays, but draw flap FREZ lines later)
  const topOffsets = getCumulativeOffsets(model.sides.top.flanges);
  const bottomOffsets = getCumulativeOffsets(model.sides.bottom.flanges);
  const leftOffsets = getCumulativeOffsets(model.sides.left.flanges);
  const rightOffsets = getCumulativeOffsets(model.sides.right.flanges);

  const topFolds = [y1, ...topOffsets.slice(0, -1).map((o) => y1 + o)];
  const bottomFolds = [y0, ...bottomOffsets.slice(0, -1).map((o) => y0 - o)];
  const leftFolds = [x0, ...leftOffsets.slice(0, -1).map((o) => x0 - o)];
  const rightFolds = [x1, ...rightOffsets.slice(0, -1).map((o) => x1 + o)];

  // Collect flap diagonal line data for later drawing (after notches are complete)
  const flapDiagonals: Array<{x1: number; y1: number; x2: number; y2: number}> = [];

  model.sides.left.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerTop > y1) {
      topNotches.push({ apexX: leftFolds[i], apexY: y1, shoulderY: topShoulderY, flap: flange.flaps?.start });
      if (flange.flaps?.start) {
        flapDiagonals.push({ x1: leftFolds[i], y1: y1, x2: leftFolds[i] - Math.abs(topShoulderY - y1), y2: topShoulderY });
        flapDiagonals.push({ x1: leftFolds[i], y1: y1, x2: leftFolds[i] + Math.abs(topShoulderY - y1), y2: topShoulderY });
      }
    }
    if (flange.reliefs.end && outerBottom < y0) {
      bottomNotches.push({ apexX: leftFolds[i], apexY: y0, shoulderY: bottomShoulderY, flap: flange.flaps?.end });
      if (flange.flaps?.end) {
        flapDiagonals.push({ x1: leftFolds[i], y1: y0, x2: leftFolds[i] - Math.abs(bottomShoulderY - y0), y2: bottomShoulderY });
        flapDiagonals.push({ x1: leftFolds[i], y1: y0, x2: leftFolds[i] + Math.abs(bottomShoulderY - y0), y2: bottomShoulderY });
      }
    }
  });

  model.sides.right.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerTop > y1) {
      topNotches.push({ apexX: rightFolds[i], apexY: y1, shoulderY: topShoulderY, flap: flange.flaps?.start });
      if (flange.flaps?.start) {
        flapDiagonals.push({ x1: rightFolds[i], y1: y1, x2: rightFolds[i] - Math.abs(topShoulderY - y1), y2: topShoulderY });
        flapDiagonals.push({ x1: rightFolds[i], y1: y1, x2: rightFolds[i] + Math.abs(topShoulderY - y1), y2: topShoulderY });
      }
    }
    if (flange.reliefs.end && outerBottom < y0) {
      bottomNotches.push({ apexX: rightFolds[i], apexY: y0, shoulderY: bottomShoulderY, flap: flange.flaps?.end });
      if (flange.flaps?.end) {
        flapDiagonals.push({ x1: rightFolds[i], y1: y0, x2: rightFolds[i] - Math.abs(bottomShoulderY - y0), y2: bottomShoulderY });
        flapDiagonals.push({ x1: rightFolds[i], y1: y0, x2: rightFolds[i] + Math.abs(bottomShoulderY - y0), y2: bottomShoulderY });
      }
    }
  });

  model.sides.top.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerLeft < x0) {
      leftNotches.push({ apexX: x0, apexY: topFolds[i], shoulderX: leftShoulderX, flap: flange.flaps?.start });
      if (flange.flaps?.start) {
        flapDiagonals.push({ x1: x0, y1: topFolds[i], x2: leftShoulderX, y2: topFolds[i] - Math.abs(leftShoulderX - x0) });
        flapDiagonals.push({ x1: x0, y1: topFolds[i], x2: leftShoulderX, y2: topFolds[i] + Math.abs(leftShoulderX - x0) });
      }
    }
    if (flange.reliefs.end && outerRight > x1) {
      rightNotches.push({ apexX: x1, apexY: topFolds[i], shoulderX: rightShoulderX, flap: flange.flaps?.end });
      if (flange.flaps?.end) {
        flapDiagonals.push({ x1: x1, y1: topFolds[i], x2: rightShoulderX, y2: topFolds[i] - Math.abs(rightShoulderX - x1) });
        flapDiagonals.push({ x1: x1, y1: topFolds[i], x2: rightShoulderX, y2: topFolds[i] + Math.abs(rightShoulderX - x1) });
      }
    }
  });

  model.sides.bottom.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerLeft < x0) {
      leftNotches.push({ apexX: x0, apexY: bottomFolds[i], shoulderX: leftShoulderX, flap: flange.flaps?.start });
      if (flange.flaps?.start) {
        flapDiagonals.push({ x1: x0, y1: bottomFolds[i], x2: leftShoulderX, y2: bottomFolds[i] - Math.abs(leftShoulderX - x0) });
        flapDiagonals.push({ x1: x0, y1: bottomFolds[i], x2: leftShoulderX, y2: bottomFolds[i] + Math.abs(leftShoulderX - x0) });
      }
    }
    if (flange.reliefs.end && outerRight > x1) {
      rightNotches.push({ apexX: x1, apexY: bottomFolds[i], shoulderX: rightShoulderX, flap: flange.flaps?.end });
      if (flange.flaps?.end) {
        flapDiagonals.push({ x1: x1, y1: bottomFolds[i], x2: rightShoulderX, y2: bottomFolds[i] - Math.abs(rightShoulderX - x1) });
        flapDiagonals.push({ x1: x1, y1: bottomFolds[i], x2: rightShoulderX, y2: bottomFolds[i] + Math.abs(rightShoulderX - x1) });
      }
    }
  });

  // =========================================================================
  // Phase 2: Draw all FREZ lines, trimmed against notch boundaries.
  // =========================================================================

  // Flange fold lines (top)
  if (model.sides.top.flanges.length > 0) {
    addTrimmableHorizontalLine(shapes, "FREZ", topSpanStart, topSpanEnd, y1, topNotches, bottomNotches, leftNotches, rightNotches);
    const offsets = getCumulativeOffsets(model.sides.top.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addTrimmableHorizontalLine(shapes, "FREZ", topSpanStart, topSpanEnd, y1 + offsets[i], topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }

  // Flange fold lines (bottom)
  if (model.sides.bottom.flanges.length > 0) {
    addTrimmableHorizontalLine(shapes, "FREZ", bottomSpanStart, bottomSpanEnd, y0, topNotches, bottomNotches, leftNotches, rightNotches);
    const offsets = getCumulativeOffsets(model.sides.bottom.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addTrimmableHorizontalLine(shapes, "FREZ", bottomSpanStart, bottomSpanEnd, y0 - offsets[i], topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }

  // Flange fold lines (left)
  if (model.sides.left.flanges.length > 0) {
    addTrimmableVerticalLine(shapes, "FREZ", x0, leftSpanBottom, leftSpanTop, topNotches, bottomNotches, leftNotches, rightNotches);
    const offsets = getCumulativeOffsets(model.sides.left.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addTrimmableVerticalLine(shapes, "FREZ", x0 - offsets[i], leftSpanBottom, leftSpanTop, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }

  // Flange fold lines (right)
  if (model.sides.right.flanges.length > 0) {
    addTrimmableVerticalLine(shapes, "FREZ", x1, rightSpanBottom, rightSpanTop, topNotches, bottomNotches, leftNotches, rightNotches);
    const offsets = getCumulativeOffsets(model.sides.right.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addTrimmableVerticalLine(shapes, "FREZ", x1 + offsets[i], rightSpanBottom, rightSpanTop, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }

  // Outer frez lines
  for (const y of frezPositions.top) {
    const startX = model.sides.top.frezMode === "outer" ? topSpanStart : x0;
    const endX = model.sides.top.frezMode === "outer" ? topSpanEnd : x1;
    addTrimmableHorizontalLine(shapes, "FREZ", startX, endX, y, topNotches, bottomNotches, leftNotches, rightNotches);
  }

  for (const y of frezPositions.bottom) {
    const startX = model.sides.bottom.frezMode === "outer" ? bottomSpanStart : x0;
    const endX = model.sides.bottom.frezMode === "outer" ? bottomSpanEnd : x1;
    addTrimmableHorizontalLine(shapes, "FREZ", startX, endX, y, topNotches, bottomNotches, leftNotches, rightNotches);
  }

  for (const x of frezPositions.left) {
    const startY = model.sides.left.frezMode === "outer" ? leftSpanBottom : y0;
    const endY = model.sides.left.frezMode === "outer" ? leftSpanTop : y1;
    addTrimmableVerticalLine(shapes, "FREZ", x, startY, endY, topNotches, bottomNotches, leftNotches, rightNotches);
  }

  for (const x of frezPositions.right) {
    const startY = model.sides.right.frezMode === "outer" ? rightSpanBottom : y0;
    const endY = model.sides.right.frezMode === "outer" ? rightSpanTop : y1;
    addTrimmableVerticalLine(shapes, "FREZ", x, startY, endY, topNotches, bottomNotches, leftNotches, rightNotches);
  }

  // Inner frez lines
  const leftFlangeDepth = sumMeasurements(model.sides.left.flanges);
  const rightFlangeDepth = sumMeasurements(model.sides.right.flanges);
  const topFlangeDepth = sumMeasurements(model.sides.top.flanges);
  const bottomFlangeDepth = sumMeasurements(model.sides.bottom.flanges);

  {
    let offsetAcc = 0;
    for (const line of model.sides.top.innerFrezLines) {
      offsetAcc += line.amount;
      const fy = y1 - offsetAcc;
      const lx = line.spanStart ? x0 - leftFlangeDepth : x0;
      const rx = line.spanEnd   ? x1 + rightFlangeDepth : x1;
      addTrimmableHorizontalLine(shapes, "FREZ", lx, rx, fy, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }
  {
    let offsetAcc = 0;
    for (const line of model.sides.bottom.innerFrezLines) {
      offsetAcc += line.amount;
      const fy = y0 + offsetAcc;
      const lx = line.spanStart ? x0 - leftFlangeDepth : x0;
      const rx = line.spanEnd   ? x1 + rightFlangeDepth : x1;
      addTrimmableHorizontalLine(shapes, "FREZ", lx, rx, fy, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }
  {
    let offsetAcc = 0;
    for (const line of model.sides.left.innerFrezLines) {
      offsetAcc += line.amount;
      const fx = x0 + offsetAcc;
      const ty = line.spanStart ? y1 + topFlangeDepth    : y1;
      const by = line.spanEnd   ? y0 - bottomFlangeDepth : y0;
      addTrimmableVerticalLine(shapes, "FREZ", fx, by, ty, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }
  {
    let offsetAcc = 0;
    for (const line of model.sides.right.innerFrezLines) {
      offsetAcc += line.amount;
      const fx = x1 - offsetAcc;
      const ty = line.spanStart ? y1 + topFlangeDepth    : y1;
      const by = line.spanEnd   ? y0 - bottomFlangeDepth : y0;
      addTrimmableVerticalLine(shapes, "FREZ", fx, by, ty, topNotches, bottomNotches, leftNotches, rightNotches);
    }
  }

  // Flap diagonal FREZ lines (trimmed against notch boundaries)
  for (const d of flapDiagonals) {
    addTrimmableDiagonalLine(shapes, "FREZ", d.x1, d.y1, d.x2, d.y2, topNotches, bottomNotches, leftNotches, rightNotches);
  }

  const offset = model.offsetCut;
  const dDiag = offset * Math.SQRT2;

  function offsetHorizontalNotches(notches: HorizontalNotch[], dirY: 1 | -1, unoffsetEdgeY: number) {
    if (offset === 0) return notches;
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

  function offsetVerticalNotches(notches: VerticalNotch[], dirX: 1 | -1, unoffsetEdgeX: number) {
    if (offset === 0) return notches;
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

  const finalTopNotches = offsetHorizontalNotches(topNotches, 1, outerTop - offset);
  const finalBottomNotches = offsetHorizontalNotches(bottomNotches, -1, outerBottom + offset);
  const finalLeftNotches = offsetVerticalNotches(leftNotches, -1, outerLeft + offset);
  const finalRightNotches = offsetVerticalNotches(rightNotches, 1, outerRight - offset);

  // Clip edge spans against perpendicular corner notches so that CUT lines
  // do not extend past the V-notch apex diagonal into the notch cutout.
  const clippedTop = clipHorizontalSpan(outerTop, topSpanStart, topSpanEnd, finalLeftNotches, finalRightNotches);
  const clippedBottom = clipHorizontalSpan(outerBottom, bottomSpanStart, bottomSpanEnd, finalLeftNotches, finalRightNotches);
  const clippedRight = clipVerticalSpan(outerRight, rightSpanTop, rightSpanBottom, finalTopNotches, finalBottomNotches);
  const clippedLeft = clipVerticalSpan(outerLeft, leftSpanTop, leftSpanBottom, finalTopNotches, finalBottomNotches);

  if (clippedTop.startX < clippedTop.endX - 1e-5)
    addHorizontalCutEdge(shapes, outerTop, clippedTop.startX, clippedTop.endX, finalTopNotches);
  if (clippedBottom.startX < clippedBottom.endX - 1e-5)
    addHorizontalCutEdge(shapes, outerBottom, clippedBottom.startX, clippedBottom.endX, finalBottomNotches);
  if (clippedRight.startY > clippedRight.endY + 1e-5)
    addVerticalCutEdge(shapes, outerRight, clippedRight.startY, clippedRight.endY, finalRightNotches);
  if (clippedLeft.startY > clippedLeft.endY + 1e-5)
    addVerticalCutEdge(shapes, outerLeft, clippedLeft.startY, clippedLeft.endY, finalLeftNotches);

  if (!hasTopRightRelief) {
    if (outerTop > cutY1) addLine(shapes, "CUT", cutX1, outerTop, cutX1, cutY1);
    if (outerRight > cutX1) addLine(shapes, "CUT", cutX1, cutY1, outerRight, cutY1);
  }

  if (!hasBottomRightRelief) {
    if (outerRight > cutX1) addLine(shapes, "CUT", outerRight, cutY0, cutX1, cutY0);
    if (outerBottom < cutY0) addLine(shapes, "CUT", cutX1, cutY0, cutX1, outerBottom);
  }

  if (!hasBottomLeftRelief) {
    if (outerBottom < cutY0) addLine(shapes, "CUT", cutX0, outerBottom, cutX0, cutY0);
    if (outerLeft < cutX0) addLine(shapes, "CUT", cutX0, cutY0, outerLeft, cutY0);
  }

  if (!hasTopLeftRelief) {
    if (outerLeft < cutX0) addLine(shapes, "CUT", outerLeft, cutY1, cutX0, cutY1);
    if (outerTop > cutY1) addLine(shapes, "CUT", cutX0, cutY1, cutX0, outerTop);
  }

  function processHoles(feature: FlangeMeasurement | FrezMeasurement, side: SideKey, xMin: number, xMax: number, yMin: number, yMax: number) {
    if (feature.holes?.enabled) {
      addHoleLines(shapes, feature.holes, { xMin, xMax, yMin, yMax }, side);
    }
  }

  model.sides.top.flanges.forEach((flange, i) => {
    processHoles(flange, "top", x0, x1, topFolds[i], topFolds[i] + flange.amount);
  });
  model.sides.bottom.flanges.forEach((flange, i) => {
    processHoles(flange, "bottom", x0, x1, bottomFolds[i] - flange.amount, bottomFolds[i]);
  });
  model.sides.left.flanges.forEach((flange, i) => {
    processHoles(flange, "left", leftFolds[i] - flange.amount, leftFolds[i], y0, y1);
  });
  model.sides.right.flanges.forEach((flange, i) => {
    processHoles(flange, "right", rightFolds[i], rightFolds[i] + flange.amount, y0, y1);
  });

  {
    let offsetAcc = 0;
    model.sides.top.innerFrezLines.forEach((frez) => {
      offsetAcc += frez.amount;
      processHoles(frez, "top", x0, x1, y1 - offsetAcc, y1 - offsetAcc + frez.amount);
    });
  }
  {
    let offsetAcc = 0;
    model.sides.bottom.innerFrezLines.forEach((frez) => {
      offsetAcc += frez.amount;
      processHoles(frez, "bottom", x0, x1, y0 + offsetAcc - frez.amount, y0 + offsetAcc);
    });
  }
  {
    let offsetAcc = 0;
    model.sides.left.innerFrezLines.forEach((frez) => {
      offsetAcc += frez.amount;
      processHoles(frez, "left", x0 + offsetAcc - frez.amount, x0 + offsetAcc, y0, y1);
    });
  }
  {
    let offsetAcc = 0;
    model.sides.right.innerFrezLines.forEach((frez) => {
      offsetAcc += frez.amount;
      processHoles(frez, "right", x1 - offsetAcc, x1 - offsetAcc + frez.amount, y0, y1);
    });
  }

  if (model.invertX) {
    shapes.forEach((shape) => {
      shape.x1 = outerRight - (shape.x1 - outerLeft);
      shape.x2 = outerRight - (shape.x2 - outerLeft);
    });
  }

  if (model.invertY) {
    shapes.forEach((shape) => {
      shape.y1 = outerTop - (shape.y1 - outerBottom);
      shape.y2 = outerTop - (shape.y2 - outerBottom);
    });
  }

  return {
    shapes,
    baseRect: { x0, y0, x1, y1 },
    bounds: { x0: outerLeft, y0: outerBottom, x1: outerRight, y1: outerTop },
    totalWidth: outerRight - outerLeft,
    totalHeight: outerTop - outerBottom,
    flangeDepths,
    frezOffsets,
    warnings: collectWarnings(model, flangeDepths),
  };
}

export function computeSheetMetalGeometry(model: SheetMetalModel): GeometryResult {
  const modelZeroOffset = { ...model, offsetCut: 0 };
  const zeroResult = _computeSheetMetalGeometry(modelZeroOffset);

  if (model.offsetCut === 0) {
    return zeroResult;
  }

  const offsetResult = _computeSheetMetalGeometry(model);

  const frezShapes = zeroResult.shapes.filter(s => s.layer === "FREZ");
  const holeShapes = zeroResult.shapes.filter(s => s.layer === "HOLES");
  const zeroLayerShapes = zeroResult.shapes.filter(s => s.layer === "CUT").map(s => ({ ...s, layer: "0" as Layer }));
  const cutLayerShapes = offsetResult.shapes.filter(s => s.layer === "CUT");

  return {
    ...offsetResult,
    shapes: [...frezShapes, ...holeShapes, ...zeroLayerShapes, ...cutLayerShapes]
  };
}

export function getSideTotal(model: SheetMetalModel, side: SideKey, kind: "flanges" | "frezLines") {
  const items = model.sides[side][kind] as AmountItem[];
  return sumMeasurements(items);
}

export function countShapes(shapes: LineShape[], layer: LineShape["layer"]) {
  return shapes.filter((shape) => shape.layer === layer).length;
}

export { sideKeys };