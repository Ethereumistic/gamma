// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — Line Joiner
//
// Joins collinear line segments on a per-layer basis, preparing DXF output
// for the CNC pipeline. Different layers have different joining strategies:
//
//   CUT, HOLES, custom layers  →  Full join (merge all collinear segments
//                                    that overlap or touch end-to-end)
//   FREZ, FREZ_135             →  Orientation-aware join (merge collinear
//                                    segments that share the same angle)
//   SHEETS, 0                  →  No joining (skip)
//
// The orientation-aware strategy ensures that horizontal FREZ lines are only
// joined with horizontal lines, 45° diagonals with 45° diagonals, etc.
// A 33° line will NOT be joined with a 45° line, even if they are collinear.
//
// Plan refs: NESTING_EXPLAINED v1 §7, §8
// ────────────────────────────────────────────────────────────────────────────────

import type { Segment } from "./types";
import { COINCIDENCE_TOL, LAYER_FREZ, LAYER_FREZ_135, LAYER_CUT, LAYER_HOLES, LAYER_SHEETS, LAYER_ZERO } from "./constants";

// ── Joining strategy ─────────────────────────────────────────────────────────

/** Strategy for joining line segments. */
export type JoinStrategy = "full" | "orientation" | "skip";

/** Which join strategy to use for each layer. */
export function joinStrategyForLayer(layer: string): JoinStrategy {
  if (layer === LAYER_SHEETS || layer === LAYER_ZERO) return "skip";
  if (layer === LAYER_FREZ || layer === LAYER_FREZ_135) return "orientation";
  // CUT, HOLES, and any custom/unknown layer → full join
  return "full";
}

// ── Geometric helpers ─────────────────────────────────────────────────────────

/** Tolerance for end-to-end gap (touching segments within this distance are joined). */
const JOIN_GAP_TOL = COINCIDENCE_TOL; // 0.01 mm

/** Tolerance for angle grouping in orientation-aware join (degrees). */
const ANGLE_TOL = 0.5; // degrees

/** Compute the angle of a segment in [0, 180) degrees.
 *  A segment from (0,0)→(10,10) and (10,10)→(0,0) both return ~45°. */
function segmentAngle(s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return 0;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle < 0) angle += 180;
  return angle % 180;
}

/** Check if two angles are considered the same (within ANGLE_TOL degrees). */
function anglesMatch(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  // Both are in [0, 180), so the wraparound distance is min(diff, 180 - diff)
  return Math.min(diff, 180 - diff) < ANGLE_TOL;
}

/** Check if two segments are collinear (all four endpoints lie on the same
 *  infinite line within tolerance). */
function areCollinear(s1: Segment, s2: Segment, tol: number = JOIN_GAP_TOL): boolean {
  const dx = s1.x2 - s1.x1;
  const dy = s1.y2 - s1.y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return false;

  // Unit direction vector
  const ux = dx / len;
  const uy = dy / len;

  // Perpendicular distance of s2 endpoints from s1's infinite line
  const d1 = Math.abs((s2.x1 - s1.x1) * uy - (s2.y1 - s1.y1) * ux);
  const d2 = Math.abs((s2.x2 - s1.x1) * uy - (s2.y2 - s1.y1) * ux);

  return d1 < tol && d2 < tol;
}

/** Compute the direction angle of a segment in [0, 180) degrees.
 *  Used for perpendicular distance and projection calculations. */
function segmentDirection(s: Segment): { ux: number; uy: number; len: number } {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return { ux: 1, uy: 0, len: 0 };
  return { ux: dx / len, uy: dy / len, len };
}

/** Check if two 1D intervals overlap or touch within tolerance.
 *  Returns the union [lo, hi] if they overlap/touch, or null if not. */
function overlapOrTouch1D(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  tol: number = JOIN_GAP_TOL,
): [number, number] | null {
  const loA = Math.min(a0, a1);
  const hiA = Math.max(a0, a1);
  const loB = Math.min(b0, b1);
  const hiB = Math.max(b0, b1);

  // Segments overlap/touch if the gap between them is within tolerance
  if (hiA + tol < loB || hiB + tol < loA) {
    return null; // no overlap or touch
  }

  return [Math.min(loA, loB), Math.max(hiA, hiB)];
}

/** Project a point onto a direction vector, returning the scalar parameter t
 *  such that point ≈ ref + t * dir. */
function projectPoint(px: number, py: number, rx: number, ry: number, ux: number, uy: number): number {
  return (px - rx) * ux + (py - ry) * uy;
}

/** Check if two segments are joinable:
 *  - They must be collinear (within tolerance)
 *  - Their projections on the shared direction must overlap or touch (within tolerance)
 */
function segmentsAreJoinable(s1: Segment, s2: Segment): boolean {
  if (!areCollinear(s1, s2)) return false;

  // Project all 4 endpoints onto the direction of s1
  const { ux, uy } = segmentDirection(s1);
  const rx = s1.x1;
  const ry = s1.y1;

  const t1 = projectPoint(s1.x1, s1.y1, rx, ry, ux, uy);
  const t2 = projectPoint(s1.x2, s1.y2, rx, ry, ux, uy);
  const t3 = projectPoint(s2.x1, s2.y1, rx, ry, ux, uy);
  const t4 = projectPoint(s2.x2, s2.y2, rx, ry, ux, uy);

  const range1lo = Math.min(t1, t2);
  const range1hi = Math.max(t1, t2);
  const range2lo = Math.min(t3, t4);
  const range2hi = Math.max(t3, t4);

  return overlapOrTouch1D(range1lo, range1hi, range2lo, range2hi) !== null;
}

/** Merge two joinable collinear segments into their union span.
 *  Projects all 4 endpoints onto the shared direction and creates a
 *  single segment from min to max projection, preserving the line direction. */
function mergeJoinableSegments(s1: Segment, s2: Segment): Segment {
  const { ux, uy } = segmentDirection(s1);
  const rx = s1.x1;
  const ry = s1.y1;

  // Project all 4 endpoints onto the direction
  const t1 = projectPoint(s1.x1, s1.y1, rx, ry, ux, uy);
  const t2 = projectPoint(s1.x2, s1.y2, rx, ry, ux, uy);
  const t3 = projectPoint(s2.x1, s2.y1, rx, ry, ux, uy);
  const t4 = projectPoint(s2.x2, s2.y2, rx, ry, ux, uy);

  const minT = Math.min(t1, t2, t3, t4);
  const maxT = Math.max(t1, t2, t3, t4);

  // The merged segment preserves the direction and spans min..max
  return {
    x1: rx + minT * ux,
    y1: ry + minT * uy,
    x2: rx + maxT * ux,
    y2: ry + maxT * uy,
  };
}

// ── Joining algorithms ─────────────────────────────────────────────────────────

/** Full join: merge all collinear overlapping/touching segments.
 *  This is equivalent to an AutoCAD "OVERKILL" + "JOIN" operation.
 *  Used for CUT, HOLES, and custom layers. */
function joinCollinear(segments: Segment[]): Segment[] {
  if (segments.length === 0) return [];

  // Filter out zero-length segments
  const valid = segments.filter((s) => {
    const ddx = s.x2 - s.x1;
    const ddy = s.y2 - s.y1;
    return Math.sqrt(ddx * ddx + ddy * ddy) > JOIN_GAP_TOL;
  });

  if (valid.length === 0) return [];

  const consumed = new Set<number>();
  const result: Segment[] = [];

  for (let i = 0; i < valid.length; i++) {
    if (consumed.has(i)) continue;

    let current = valid[i];
    const group = [i]; // Track segments merged into this group

    for (let j = i + 1; j < valid.length; j++) {
      if (consumed.has(j)) continue;
      if (segmentsAreJoinable(current, valid[j])) {
        current = mergeJoinableSegments(current, valid[j]);
        consumed.add(j);
      }
    }

    // Multi-pass: re-scan for segments that now touch the merged result
    // (needed when merging creates a longer segment that connects previously-separate groups)
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < valid.length; j++) {
        if (consumed.has(j) || j === i) continue;
        if (segmentsAreJoinable(current, valid[j])) {
          current = mergeJoinableSegments(current, valid[j]);
          consumed.add(j);
          changed = true;
        }
      }
    }

    result.push(current);
  }

  return result;
}

/** Orientation-aware join: group by angle, then merge collinear segments
 *  within each group. This prevents joining lines at different angles
 *  even if they happen to be near-collinear.
 *  Used for FREZ and FREZ_135 layers. */
function joinByOrientation(segments: Segment[]): Segment[] {
  if (segments.length === 0) return [];

  // Filter out zero-length segments
  const valid = segments.filter((s) => {
    const ddx = s.x2 - s.x1;
    const ddy = s.y2 - s.y1;
    return Math.sqrt(ddx * ddx + ddy * ddy) > JOIN_GAP_TOL;
  });

  if (valid.length === 0) return [];

  // Group by angle (within ANGLE_TOL)
  type AngleGroup = { angle: number; segments: Segment[] };
  const groups: AngleGroup[] = [];

  for (const seg of valid) {
    const angle = segmentAngle(seg);
    let foundGroup = false;
    for (const group of groups) {
      if (anglesMatch(angle, group.angle)) {
        group.segments.push(seg);
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      groups.push({ angle, segments: [seg] });
    }
  }

  // Join within each group
  const result: Segment[] = [];
  for (const group of groups) {
    const joined = joinCollinear(group.segments);
    result.push(...joined);
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Join line segments using the specified strategy.
 *
 *  - "full": merge all collinear overlapping/touching segments.
 *    Used for CUT, HOLES, and custom layers.
 *
 *  - "orientation": group by angle first, then merge collinear segments
 *    within each group. Used for FREZ and FREZ_135.
 *
 *  - "skip": return segments unchanged. Used for SHEETS and 0 layers.
 */
export function joinSegments(
  segments: Segment[],
  strategy: JoinStrategy,
): Segment[] {
  if (strategy === "skip" || segments.length <= 1) return segments;

  if (strategy === "full") {
    return joinCollinear(segments);
  }

  if (strategy === "orientation") {
    return joinByOrientation(segments);
  }

  return segments;
}

/** Join line segments for a specific layer, choosing the strategy automatically. */
export function joinSegmentsForLayer(segments: Segment[], layer: string): Segment[] {
  return joinSegments(segments, joinStrategyForLayer(layer));
}



