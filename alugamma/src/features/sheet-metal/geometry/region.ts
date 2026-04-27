/**
 * geometry/region.ts — MetalRegion polygon abstraction.
 *
 * A MetalRegion is a convex/concave polygon representing the valid
 * sheet-metal area. It is built by starting with the outer rectangle
 * and indenting each edge with V-shaped notches.
 *
 * This module replaces the ad-hoc midpoint-sampling trimming system
 * (trim.ts) with a clean polygon-line-clipping approach:
 *   - `buildMetalRegion()` constructs the polygon from notches
 *   - `clipSegment()` clips a line segment against the polygon
 *   - `isPointInside()` tests point-in-polygon
 */

import { type HorizontalNotch, type VerticalNotch } from "./notches";
import type { LineShape, Layer } from "@/features/sheet-metal/types";
import { EPS, flapDiagonal } from "./math";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };

/** A polygon is a closed CCW (counter-clockwise) ring of points. */
export type Polygon = Point[];

/** Result of clipping a segment: zero or more sub-segments. */
export type Segment = { p1: Point; p2: Point };

// ---------------------------------------------------------------------------
// Build the metal region polygon
// ---------------------------------------------------------------------------

/**
 * Build a MetalRegion polygon from the outer rectangle and notch arrays.
 *
 * Strategy:
 * 1. Start with the outer rectangle (CCW).
 * 2. For each edge with notches, insert V-indent vertices.
 * 3. Overlapping notches on the same edge are pre-merged by taking
 *    the deeper (more inward) boundary at each point.
 *
 * The outer rectangle is:
 *   (outerLeft, outerBottom) → (outerRight, outerBottom) → (outerRight, outerTop) → (outerLeft, outerTop)
 *
 * For the top edge (y = outerTop):
 *   - Each top notch at apexX with shoulderY means:
 *     the top edge has a V-indent where the apex stays at (apexX, outerTop)
 *     but the edge dips to shoulderY at apexX ± shoulderOff
 *
 * For the bottom edge (y = outerBottom):
 *   - Each bottom notch means the bottom edge has an upward V-indent
 *
 * For the left edge (x = outerLeft):
 *   - Each left notch means the left edge has a rightward V-indent
 *
 * For the right edge (x = outerRight):
 *   - Each right notch means the right edge has a leftward V-indent
 */
export function buildMetalRegion(opts: {
  outerLeft: number;
  outerBottom: number;
  outerRight: number;
  outerTop: number;
  topNotches: HorizontalNotch[];
  bottomNotches: HorizontalNotch[];
  leftNotches: VerticalNotch[];
  rightNotches: VerticalNotch[];
}): Polygon {
  const { outerLeft, outerBottom, outerRight, outerTop } = opts;

  // Bottom edge: left-to-right (CCW)
  const bottomPoints = buildHorizontalEdgePoints(
    opts.bottomNotches,
    outerLeft, outerRight, outerBottom,
    "bottom", // notches open downward for bottom edge
  );

  // Right edge: bottom-to-top (CCW)
  const rightPoints = buildVerticalEdgePoints(
    opts.rightNotches,
    outerBottom, outerTop, outerRight,
    "right", // notches open rightward for right edge
  );

  // Top edge: right-to-left (CCW)
  const topPoints = buildHorizontalEdgePoints(
    opts.topNotches,
    outerRight, outerLeft, outerTop,
    "top", // notches open upward for top edge
  );

  // Left edge: top-to-bottom (CCW)
  const leftPoints = buildVerticalEdgePoints(
    opts.leftNotches,
    outerTop, outerBottom, outerLeft,
    "left", // notches open leftward for left edge
  );

  // Combine into a closed polygon (CCW order)
  // Start at bottom-left, go right along bottom, up along right,
  // left along top, down along left
  const polygon: Polygon = [];
  for (const pts of [bottomPoints, rightPoints, topPoints, leftPoints]) {
    for (const p of pts) {
      const last = polygon[polygon.length - 1];
      if (last && isNearlyEqual(last, p)) continue; // skip duplicate corner
      polygon.push(p);
    }
  }

  // Remove the duplicate closing point (the first point equals the last)
  // and close the polygon properly
  if (polygon.length > 1 && isNearlyEqual(polygon[0], polygon[polygon.length - 1])) {
    polygon.pop();
  }

  return polygon;
}

// ---------------------------------------------------------------------------
// Edge point generation with V-notches
// ---------------------------------------------------------------------------

/**
 * Generate points along a horizontal edge with V-notch indentations.
 *
 * Handles overlapping notches by using a scanline approach: at each
 * critical X position, evaluate the deepest (most inward) notch boundary
 * across all overlapping notches, and emit a single polygon vertex.
 *
 * For the bottom edge (CCW: left→right), notches open downward:
 *   edge y = outerY, notches indent from outerY toward shoulderY
 *   For notch at apexX: two diagonal shoulders at apexX ± shoulderOff x shoulderY,
 *   apex stays at outerY
 *
 * For the top edge (CCW: right→left), notches open upward:
 *   edge y = outerY, notches indent from outerY toward shoulderY
 */
function buildHorizontalEdgePoints(
  notches: HorizontalNotch[],
  startX: number,
  endX: number,
  edgeY: number,
  edgeSide: "top" | "bottom",
): Point[] {
  if (notches.length === 0) {
    return [{ x: startX, y: edgeY }, { x: endX, y: edgeY }];
  }

  // Filter out zero-width notches
  const validNotches = notches.filter(n => Math.abs(n.shoulderY - n.apexY) > EPS);
  if (validNotches.length === 0) {
    return [{ x: startX, y: edgeY }, { x: endX, y: edgeY }];
  }

  // For each notch, compute its boundary function.
  // For a horizontal notch at apexX with shoulderOff:
  //   boundaryY(x) = apexY + sign * (|x - apexX| + D)   where sign = ±1
  //   For top edge (notches open upward): boundaryY > edgeY  → sign = +1
  //   For bottom edge (notches open downward): boundaryY < edgeY → sign = -1
  // When notches overlap, the effective boundary is the deeper one
  // (further from edgeY).

  // Collect all critical X positions (shoulder boundaries, apexes, flap transitions)
  const xCrits = new Set<number>();
  xCrits.add(startX);
  xCrits.add(endX);

  for (const n of validNotches) {
    const shoulderOff = Math.abs(n.shoulderY - n.apexY);
    const D = flapDiagonal(n.flap);
    xCrits.add(n.apexX - shoulderOff);
    xCrits.add(n.apexX + shoulderOff);
    xCrits.add(n.apexX);
    if (D > 0) {
      xCrits.add(n.apexX - Math.max(0, shoulderOff - D));
      xCrits.add(n.apexX + Math.max(0, shoulderOff - D));
    }
    // Also compute intersection points between overlapping notch diagonals
    for (const m of validNotches) {
      if (n === m) continue;
      const mOff = Math.abs(m.shoulderY - m.apexY);
      if (mOff < EPS) continue;
      // Where the two notch diagonals cross:
      // n.boundary(x) = m.boundary(x)
      // apexY_n + sign*(|x-apexX_n|+D_n) = apexY_m + sign*(|x-apexX_m|+D_m)
      // For same-edge notches with same sign, the intersection is at:
      //   x = (apexX_n + apexX_m + sign*(apexY_m - apexY_n) + D_m - D_n) / 2
      // or x = (apexX_n + apexX_m - sign*(apexY_m - apexY_n) + D_n - D_m) / 2
      // For simplicity, just check both intersection equations depending on
      // which side of each apex we're on. We add a few candidate Xs.
      const Dn = flapDiagonal(n.flap);
      const Dm = flapDiagonal(m.flap);
      // Both left-side diagonals (simplest case)
      xCrits.add((n.apexX + m.apexX - Math.abs(n.apexY - m.apexY) - Dn + Dm) / 2);
      xCrits.add((n.apexX + m.apexX + Math.abs(n.apexY - m.apexY) + Dn - Dm) / 2);
    }
  }

  // Sort and deduplicate critical X positions
  const sortedXCrits = [...xCrits]
    .filter(x => x >= Math.min(startX, endX) - EPS && x <= Math.max(startX, endX) + EPS)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]) > EPS);

  // Evaluate the effective boundary Y at a given X position.
  // For a single V-notch: boundaryY(x) = shoulderY + (|x-apexX|/shoulderOff)*(apexY-shoulderY)
  // A "deeper" boundary is one further from edgeY (= apexY).
  // When notches overlap, we take the deepest boundary at each X.
  function getEffectiveBoundaryY(x: number): number {
    let boundaryY = edgeY; // default: at the edge (no notch indentation)
    for (const n of validNotches) {
      const shoulderOff = Math.abs(n.shoulderY - n.apexY);
      if (shoulderOff < EPS) continue;
      const dist = Math.abs(x - n.apexX);
      if (dist > shoulderOff + EPS) continue; // outside this notch's influence

      let ny: number;
      const flapD = flapDiagonal(n.flap);
      if (flapD > 0 && dist <= Math.max(0, shoulderOff - flapD) + EPS) {
        // Inside the flat-bottom region of a V-with-flap
        ny = n.shoulderY;
      } else {
        // On the diagonal shoulder(s)
        // For a flap: the effective distance from the flat region edge
        const effDist = flapD > 0 ? dist - Math.max(0, shoulderOff - flapD) : dist;
        // Linear interpolation: at dist=0 → shoulderY, at dist=shoulderOff → apexY
        ny = n.shoulderY + (effDist / shoulderOff) * (n.apexY - n.shoulderY);
      }

      // Take the deeper boundary (further from edgeY, which equals apexY)
      const deeper = Math.abs(ny - edgeY) > Math.abs(boundaryY - edgeY);
      if (deeper) {
        boundaryY = ny;
      }
    }
    return boundaryY;
  }

  // Walk along the edge, emitting vertices at every critical X transition
  // goingLeft = true for top edge (right→left), false for bottom edge (left→right)
  const goingLeft = startX > endX;
  const orderedCrits = goingLeft ? [...sortedXCrits].reverse() : sortedXCrits;

  const points: Point[] = [{ x: orderedCrits[0], y: edgeY }];

  for (let i = 0; i < orderedCrits.length; i++) {
    const x = orderedCrits[i];
    const y = getEffectiveBoundaryY(x);

    // Collapse consecutive points that are at the same position
    const last = points[points.length - 1];
    if (Math.abs(x - last.x) < EPS && Math.abs(y - last.y) < EPS) continue;

    // If we're at the start of the edge and the boundary is already notched,
    // or if there's a transition from/to the edge level, emit a point
    if (i === 0 || Math.abs(y - edgeY) > EPS || Math.abs(last.y - edgeY) > EPS) {
      points.push({ x, y });
    }
  }

  // Ensure the final point is at endX, edgeY
  const last = points[points.length - 1];
  if (Math.abs(last.x - endX) > EPS || Math.abs(last.y - edgeY) > EPS) {
    points.push({ x: endX, y: edgeY });
  }

  // Remove duplicate of first point if present
  if (points.length > 1 && Math.abs(points[0].x - points[1].x) < EPS &&
      Math.abs(points[0].y - points[1].y) < EPS) {
    points.shift();
  }

  return points;
}

/**
 * Generate points along a vertical edge with V-notch indentations.
 *
 * For the right edge (CCW: bottom→top), notches open rightward.
 * For the left edge (CCW: top→bottom), notches open leftward.
 */
function buildVerticalEdgePoints(
  notches: VerticalNotch[],
  startY: number,
  endY: number,
  edgeX: number,
  edgeSide: "left" | "right",
): Point[] {
  if (notches.length === 0) {
    return [{ x: edgeX, y: startY }, { x: edgeX, y: endY }];
  }

  // Sort notches by apexY
  const sorted = [...notches].sort((a, b) => a.apexY - b.apexY);

  const points: Point[] = [{ x: edgeX, y: startY }];

  for (const n of sorted) {
    const shoulderOff = Math.abs(n.shoulderX - n.apexX);
    if (shoulderOff < EPS) continue;

    const flapD = flapDiagonal(n.flap);
    const topShoulderY = n.apexY + shoulderOff;
    const bottomShoulderY = n.apexY - shoulderOff;

    const notchX = n.shoulderX;

    // Start shoulder
    if (edgeSide === "left") {
      // CCW: top→bottom, so we encounter topShoulderY first
      points.push({ x: edgeX, y: topShoulderY });
    } else {
      // CCW: bottom→top, so we encounter bottomShoulderY first
      points.push({ x: edgeX, y: bottomShoulderY });
    }

    if (flapD > 0) {
      const flatTopY = n.apexY + Math.max(0, shoulderOff - flapD);
      const flatBottomY = n.apexY - Math.max(0, shoulderOff - flapD);

      if (shoulderOff > flapD + EPS) {
        if (edgeSide === "left") {
          points.push({ x: notchX, y: flatTopY });
          points.push({ x: notchX, y: flatBottomY });
        } else {
          points.push({ x: notchX, y: flatBottomY });
          points.push({ x: notchX, y: flatTopY });
        }
      } else {
        points.push({ x: notchX, y: n.apexY });
      }
    } else {
      points.push({ x: notchX, y: n.apexY });
    }

    // End shoulder
    if (edgeSide === "left") {
      points.push({ x: edgeX, y: bottomShoulderY });
    } else {
      points.push({ x: edgeX, y: topShoulderY });
    }
  }

  points.push({ x: edgeX, y: endY });
  return points;
}

// ---------------------------------------------------------------------------
// Point-in-polygon test (ray casting)
// ---------------------------------------------------------------------------

/**
 * Test whether a point is inside a polygon using the ray-casting algorithm.
 * Handles concave polygons correctly.
 *
 * Points that lie exactly on a polygon edge (within EPS) are considered inside,
 * which is critical for FREZ fold lines that run colinear with an edge.
 */
export function isPointInside(poly: Polygon, p: Point): boolean {
  if (isOnBoundary(poly, p)) return true;

  let inside = false;
  const n = poly.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;

    if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Test whether a point lies on any edge of the polygon (within EPS tolerance).
 * A point on the boundary is considered part of the polygon for clipping purposes.
 */
export function isOnBoundary(poly: Polygon, p: Point): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = poly[i];
    const b = poly[j];

    // Check if point p is within EPS of the line segment a→b
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < EPS * EPS) continue; // degenerate edge

    // Project p onto the segment, clamped to [0,1]
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const distSq = (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
    if (distSq < EPS * EPS) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Line-polygon intersection (Sutherland-Hodgman adapted for clipping)
// ---------------------------------------------------------------------------

/**
 * Find the intersection point of two INFINITE lines (p1→p2) and (p3→p4).
 * Returns the intersection point, or null if lines are parallel.
 * Also returns the parameter `t` on each line where the intersection occurs:
 *   intersection on line1 = p1 + t * (p2 - p1)
 *   intersection on line2 = p3 + u * (p4 - p3)
 */
function lineIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point,
): { point: Point; t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  const PARALLEL_EPS = 1e-12;
  if (Math.abs(denom) < PARALLEL_EPS) return null; // parallel

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  return {
    point: { x: p1.x + t * d1x, y: p1.y + t * d1y },
    t,
    u,
  };
}

/**
 * Clip a line segment against a concave polygon.
 *
 * Uses a parametric walk: split the segment at every polygon edge crossing,
 * then keep only the sub-segments whose midpoint is inside the polygon.
 *
 * This is robust for concave polygons (unlike Sutherland-Hodgman which
 * assumes convex input).
 */
export function clipSegment(poly: Polygon, p1: Point, p2: Point): Segment[] {
  if (poly.length < 3) return [{ p1, p2 }];

  // Collect all intersection parameters along the segment
  const params: number[] = [0, 1];
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const result = lineIntersection(p1, p2, poly[i], poly[j]);

    if (result) {
      const { t, u } = result;

      // Check that the intersection is within the polygon edge segment [0, 1]
      // (with epsilon tolerance) and within the clip segment [0, 1]
      if (u > -EPS && u < 1 + EPS && t > -EPS && t < 1 + EPS) {
        params.push(Math.max(0, Math.min(1, t)));
      }
    }
  }

  // Sort and deduplicate parameters
  params.sort((a, b) => a - b);
  const uniqueParams = params.filter(
    (t, i) => i === 0 || Math.abs(t - params[i - 1]) > EPS,
  );

  // For each sub-segment, test if its midpoint is inside the polygon
  const result: Segment[] = [];
  for (let i = 0; i < uniqueParams.length - 1; i++) {
    const tA = uniqueParams[i];
    const tB = uniqueParams[i + 1];
    const tMid = (tA + tB) / 2;

    const mid: Point = {
      x: p1.x + tMid * (p2.x - p1.x),
      y: p1.y + tMid * (p2.y - p1.y),
    };

    if (isPointInside(poly, mid)) {
      result.push({
        p1: { x: p1.x + tA * (p2.x - p1.x), y: p1.y + tA * (p2.y - p1.y) },
        p2: { x: p1.x + tB * (p2.x - p1.x), y: p1.y + tB * (p2.y - p1.y) },
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// High-level API: Clip a line and emit LineShapes
// ---------------------------------------------------------------------------

/**
 * Clip a line segment against the metal region polygon and emit
 * the surviving sub-segments as LineShape objects.
 *
 * This replaces the old `addTrimmable*` functions from trim.ts.
 * Instead of ad-hoc midpoint sampling, we use exact polygon-line
 * clipping via `clipSegment`.
 */
export function clipFrezLine(
  shapes: LineShape[],
  layer: LineShape["layer"],
  x1: number, y1: number,
  x2: number, y2: number,
  poly: Polygon,
): void {
  const segments = clipSegment(poly, { x: x1, y: y1 }, { x: x2, y: y2 });
  for (const seg of segments) {
    shapes.push({ type: "line", layer, x1: seg.p1.x, y1: seg.p1.y, x2: seg.p2.x, y2: seg.p2.y });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isNearlyEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}