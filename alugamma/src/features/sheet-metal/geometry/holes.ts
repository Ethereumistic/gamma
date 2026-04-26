/**
 * geometry/holes.ts — Hole generation for flanges and inner FREZ lines.
 *
 * Holes are short parallel lines (typically 2 lines per feature) placed in
 * the flange or inner-frez region. They appear on the HOLES layer in the DXF.
 */

import type { LineShape, FlangeMeasurement, SideKey } from "@/features/sheet-metal/types";
import { addLine } from "./edges";

// ---------------------------------------------------------------------------
// Hole line generation
// ---------------------------------------------------------------------------

export function addHoleLines(
  shapes: LineShape[],
  holeData: NonNullable<FlangeMeasurement["holes"]>,
  region: { xMin: number; xMax: number; yMin: number; yMax: number },
  side: SideKey,
): void {
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

/**
 * Process holes for a feature (flange or inner-frez) on a given side.
 * If holes are enabled, draw them in the correct region.
 */
export function processHoles(
  shapes: LineShape[],
  feature: FlangeMeasurement,
  side: SideKey,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): void {
  if (feature.holes?.enabled) {
    addHoleLines(shapes, feature.holes, { xMin, xMax, yMin, yMax }, side);
  }
}