import {
  sideKeys,
  type FrezMeasurement,
  type GeometryResult,
  type LineShape,
  type Layer,
  type Measurement,
  type SheetMetalModel,
  type SideKey,
} from "@/features/sheet-metal/types";

type HorizontalNotch = {
  apexX: number;
  apexY: number;
  shoulderY: number;
};

type VerticalNotch = {
  apexX: number;
  apexY: number;
  shoulderX: number;
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
    xCrits.push(notch.apexX - shoulderOff);
    xCrits.push(notch.apexX);
    xCrits.push(notch.apexX + shoulderOff);
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
    return notch.apexY + (isTopEdge ? 1 : -1) * Math.abs(x - notch.apexX);
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
    yCrits.push(notch.apexY + shoulderOff);
    yCrits.push(notch.apexY);
    yCrits.push(notch.apexY - shoulderOff);
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
    return notch.apexX + (isRightEdge ? 1 : -1) * Math.abs(y - notch.apexY);
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

function getCornerShoulderOffset(items: Measurement[]) {
  if (items.length === 0) {
    return 0;
  }

  return items.length > 1 ? items[0].amount : sumMeasurements(items);
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

  if (model.sides.top.flanges.length > 0) {
    addLine(shapes, "FREZ", topSpanStart, y1, topSpanEnd, y1);
    const offsets = getCumulativeOffsets(model.sides.top.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addLine(shapes, "FREZ", topSpanStart, y1 + offsets[i], topSpanEnd, y1 + offsets[i]);
    }
  }

  if (model.sides.bottom.flanges.length > 0) {
    addLine(shapes, "FREZ", bottomSpanStart, y0, bottomSpanEnd, y0);
    const offsets = getCumulativeOffsets(model.sides.bottom.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addLine(shapes, "FREZ", bottomSpanStart, y0 - offsets[i], bottomSpanEnd, y0 - offsets[i]);
    }
  }

  if (model.sides.left.flanges.length > 0) {
    addLine(shapes, "FREZ", x0, leftSpanBottom, x0, leftSpanTop);
    const offsets = getCumulativeOffsets(model.sides.left.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addLine(shapes, "FREZ", x0 - offsets[i], leftSpanBottom, x0 - offsets[i], leftSpanTop);
    }
  }

  if (model.sides.right.flanges.length > 0) {
    addLine(shapes, "FREZ", x1, rightSpanBottom, x1, rightSpanTop);
    const offsets = getCumulativeOffsets(model.sides.right.flanges);
    for (let i = 0; i < offsets.length - 1; i++) {
      addLine(shapes, "FREZ", x1 + offsets[i], rightSpanBottom, x1 + offsets[i], rightSpanTop);
    }
  }

  for (const y of frezPositions.top) {
    const startX = model.sides.top.frezMode === "outer" ? topSpanStart : x0;
    const endX = model.sides.top.frezMode === "outer" ? topSpanEnd : x1;
    addLine(shapes, "FREZ", startX, y, endX, y);
  }

  for (const y of frezPositions.bottom) {
    const startX = model.sides.bottom.frezMode === "outer" ? bottomSpanStart : x0;
    const endX = model.sides.bottom.frezMode === "outer" ? bottomSpanEnd : x1;
    addLine(shapes, "FREZ", startX, y, endX, y);
  }

  for (const x of frezPositions.left) {
    const startY = model.sides.left.frezMode === "outer" ? leftSpanBottom : y0;
    const endY = model.sides.left.frezMode === "outer" ? leftSpanTop : y1;
    addLine(shapes, "FREZ", x, startY, x, endY);
  }

  for (const x of frezPositions.right) {
    const startY = model.sides.right.frezMode === "outer" ? rightSpanBottom : y0;
    const endY = model.sides.right.frezMode === "outer" ? rightSpanTop : y1;
    addLine(shapes, "FREZ", x, startY, x, endY);
  }

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

  const topOffsets = getCumulativeOffsets(model.sides.top.flanges);
  const bottomOffsets = getCumulativeOffsets(model.sides.bottom.flanges);
  const leftOffsets = getCumulativeOffsets(model.sides.left.flanges);
  const rightOffsets = getCumulativeOffsets(model.sides.right.flanges);

  const topFolds = [y1, ...topOffsets.slice(0, -1).map((o) => y1 + o)];
  const bottomFolds = [y0, ...bottomOffsets.slice(0, -1).map((o) => y0 - o)];
  const leftFolds = [x0, ...leftOffsets.slice(0, -1).map((o) => x0 - o)];
  const rightFolds = [x1, ...rightOffsets.slice(0, -1).map((o) => x1 + o)];

  model.sides.left.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerTop > y1) {
      topNotches.push({ apexX: leftFolds[i], apexY: y1, shoulderY: topShoulderY });
    }
    if (flange.reliefs.end && outerBottom < y0) {
      bottomNotches.push({ apexX: leftFolds[i], apexY: y0, shoulderY: bottomShoulderY });
    }
  });

  model.sides.right.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerTop > y1) {
      topNotches.push({ apexX: rightFolds[i], apexY: y1, shoulderY: topShoulderY });
    }
    if (flange.reliefs.end && outerBottom < y0) {
      bottomNotches.push({ apexX: rightFolds[i], apexY: y0, shoulderY: bottomShoulderY });
    }
  });

  model.sides.top.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerLeft < x0) {
      leftNotches.push({ apexX: x0, apexY: topFolds[i], shoulderX: leftShoulderX });
    }
    if (flange.reliefs.end && outerRight > x1) {
      rightNotches.push({ apexX: x1, apexY: topFolds[i], shoulderX: rightShoulderX });
    }
  });

  model.sides.bottom.flanges.forEach((flange, i) => {
    if (flange.reliefs.start && outerLeft < x0) {
      leftNotches.push({ apexX: x0, apexY: bottomFolds[i], shoulderX: leftShoulderX });
    }
    if (flange.reliefs.end && outerRight > x1) {
      rightNotches.push({ apexX: x1, apexY: bottomFolds[i], shoulderX: rightShoulderX });
    }
  });

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
      finalNotches.push({ apexX: n.apexX, apexY: newApexY, shoulderY: newShoulderY });
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
      finalNotches.push({ apexX: newApexX, apexY: n.apexY, shoulderX: newShoulderX });
    }
    return finalNotches;
  }

  const finalTopNotches = offsetHorizontalNotches(topNotches, 1, outerTop - offset);
  const finalBottomNotches = offsetHorizontalNotches(bottomNotches, -1, outerBottom + offset);
  const finalLeftNotches = offsetVerticalNotches(leftNotches, -1, outerLeft + offset);
  const finalRightNotches = offsetVerticalNotches(rightNotches, 1, outerRight - offset);

  addHorizontalCutEdge(shapes, outerTop, topSpanStart, topSpanEnd, finalTopNotches);
  addHorizontalCutEdge(shapes, outerBottom, bottomSpanStart, bottomSpanEnd, finalBottomNotches);
  addVerticalCutEdge(shapes, outerRight, rightSpanTop, rightSpanBottom, finalRightNotches);
  addVerticalCutEdge(shapes, outerLeft, leftSpanTop, leftSpanBottom, finalLeftNotches);

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
  const zeroLayerShapes = zeroResult.shapes.filter(s => s.layer === "CUT").map(s => ({ ...s, layer: "0" as Layer }));
  const cutLayerShapes = offsetResult.shapes.filter(s => s.layer === "CUT");

  return {
    ...offsetResult,
    shapes: [...frezShapes, ...zeroLayerShapes, ...cutLayerShapes]
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
