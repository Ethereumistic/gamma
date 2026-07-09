// ────────────────────────────────────────────────────────────────────────────────
// Nesting Feature — CUT Line Deduplicator
//
// When two parts share a CUT edge (placed flush), both contribute a line at
// the boundary. The CNC should only traverse that path once, so we merge
// coincident segments.
//
// Plan refs: PLAN_03, PLAN_0 §4
// ────────────────────────────────────────────────────────────────────────────────

import { COINCIDENCE_TOL, CUT_OFFSET } from "./constants";
import type { Segment, Placement, NestPart, PackingMode } from "./types";

// ── Geometric Predicates ──────────────────────────────────────────────────

/** Check if two segments are collinear within tolerance */
function areCollinear(s1: Segment, s2: Segment, tol: number = COINCIDENCE_TOL): boolean {
  // Direction vector of s1
  const dx = s1.x2 - s1.x1;
  const dy = s1.y2 - s1.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1e-10) return false;

  // Unit direction
  const ux = dx / length;
  const uy = dy / length;

  // Perpendicular distance of s2 endpoints from s1's infinite line
  const d1 = Math.abs((s2.x1 - s1.x1) * uy - (s2.y1 - s1.y1) * ux);
  const d2 = Math.abs((s2.x2 - s1.x1) * uy - (s2.y2 - s1.y1) * ux);

  return d1 < tol && d2 < tol;
}

/** Compute 1D overlap union of intervals [a0,a1] and [b0,b1].
 *  Returns [lo, hi] if they overlap (or just touch), or null if not. */
function overlap1D(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  tol: number = COINCIDENCE_TOL,
): [number, number] | null {
  const loA = Math.min(a0, a1);
  const hiA = Math.max(a0, a1);
  const loB = Math.min(b0, b1);
  const hiB = Math.max(b0, b1);

  // Check overlap (allow touching within tolerance)
  if (hiA + tol < loB || hiB + tol < loA) {
    return null; // no overlap
  }

  return [Math.min(loA, loB), Math.max(hiA, hiB)];
}

/** Check if two segments are coincident (collinear + overlapping) */
function segmentsAreCoincident(s1: Segment, s2: Segment): boolean {
  if (!areCollinear(s1, s2)) return false;

  const dx = Math.abs(s1.x2 - s1.x1);
  const dy = Math.abs(s1.y2 - s1.y1);

  if (dx > dy) {
    // Mostly horizontal — project onto X axis
    return overlap1D(s1.x1, s1.x2, s2.x1, s2.x2) !== null;
  } else {
    // Mostly vertical — project onto Y axis
    return overlap1D(s1.y1, s1.y2, s2.y1, s2.y2) !== null;
  }
}

/** Merge two collinear overlapping segments into their union span */
function mergeCollinearSegments(s1: Segment, s2: Segment): Segment {
  const dx = Math.abs(s1.x2 - s1.x1);
  const dy = Math.abs(s1.y2 - s1.y1);

  if (dx > dy) {
    // Horizontal-ish: project onto X axis, merge X, average Y
    const [lo, hi] = overlap1D(s1.x1, s1.x2, s2.x1, s2.x2)!;
    const yAvg = (s1.y1 + s1.y2 + s2.y1 + s2.y2) / 4;
    return { x1: lo, y1: yAvg, x2: hi, y2: yAvg };
  } else {
    // Vertical-ish: project onto Y axis, merge Y, average X
    const [lo, hi] = overlap1D(s1.y1, s1.y2, s2.y1, s2.y2)!;
    const xAvg = (s1.x1 + s1.x2 + s2.x1 + s2.x2) / 4;
    return { x1: xAvg, y1: lo, x2: xAvg, y2: hi };
  }
}

// ── Deduplication Function ─────────────────────────────────────────────────

export function deduplicateCutSegments(segments: Segment[]): Segment[] {
  if (segments.length === 0) return [];

  // Filter out zero-length segments
  const valid = segments.filter((s) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    return Math.sqrt(dx * dx + dy * dy) > COINCIDENCE_TOL;
  });

  if (valid.length === 0) return [];

  const consumed = new Set<number>();
  const result: Segment[] = [];

  for (let i = 0; i < valid.length; i++) {
    if (consumed.has(i)) continue;

    let current = valid[i];

    for (let j = i + 1; j < valid.length; j++) {
      if (consumed.has(j)) continue;
      if (segmentsAreCoincident(current, valid[j])) {
        current = mergeCollinearSegments(current, valid[j]);
        consumed.add(j);
      }
    }

    result.push(current);
  }

  return result;
}

type OwnedSegment = Segment & { owner: number };

function deduplicateOwnedCutSegments(segments: OwnedSegment[]): Segment[] {
  if (segments.length === 0) return [];

  const valid = segments.filter((s) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    return Math.sqrt(dx * dx + dy * dy) > COINCIDENCE_TOL;
  });

  if (valid.length === 0) return [];

  const consumed = new Set<number>();
  const result: Segment[] = [];

  for (let i = 0; i < valid.length; i++) {
    if (consumed.has(i)) continue;

    let current: Segment = valid[i];
    const owners = new Set([valid[i].owner]);

    for (let j = i + 1; j < valid.length; j++) {
      if (consumed.has(j) || owners.has(valid[j].owner)) continue;
      if (segmentsAreCoincident(current, valid[j])) {
        current = mergeCollinearSegments(current, valid[j]);
        owners.add(valid[j].owner);
        consumed.add(j);
      }
    }

    result.push(current);
  }

  return result;
}

// ── Transform Part CUT Lines to Sheet Space ────────────────────────────────

function transformCutSegment(
  localSeg: Segment,
  insertX: number,
  insertY: number,
  rotation: 0 | 90 | 180 | 270,
): Segment {
  if (rotation === 0) {
    return {
      x1: insertX + localSeg.x1,
      y1: insertY + localSeg.y1,
      x2: insertX + localSeg.x2,
      y2: insertY + localSeg.y2,
    };
  } else if (rotation === 90) {
    // 90° CCW: (x,y) → (-y, x) relative to insert point
    return {
      x1: insertX - localSeg.y1,
      y1: insertY + localSeg.x1,
      x2: insertX - localSeg.y2,
      y2: insertY + localSeg.x2,
    };
  } else if (rotation === 180) {
    // 180°: (x,y) → (-x, -y) relative to insert point
    return {
      x1: insertX - localSeg.x1,
      y1: insertY - localSeg.y1,
      x2: insertX - localSeg.x2,
      y2: insertY - localSeg.y2,
    };
  } else {
    // 270° CCW: (x,y) → (y, -x) relative to insert point
    return {
      x1: insertX + localSeg.y1,
      y1: insertY - localSeg.x1,
      x2: insertX + localSeg.y2,
      y2: insertY - localSeg.x2,
    };
  }
}

/** Compute the block insert position in sheet space for a placement.
 *  The insert position anchors the CUT boundary to the pack rectangle.
 *  For 0° and 180° rotations, dimensions are (cutWidth × cutHeight).
 *  For 90° and 270° rotations, dimensions are (cutHeight × cutWidth).
 */
function computeInsertPosition(
  placement: Placement,
  offsetX: number,
  offsetY: number,
  part: NestPart,
): { insertX: number; insertY: number } {
  if (placement.rotation === 90) {
    // After 90° CCW rotation, the geometry shifts left by l0Height.
    // Adding (l0Height + CUT_OFFSET) to X and CUT_OFFSET to Y realigns
    // the CUT bbox with the pack rectangle.
    return {
      insertX: placement.packX + offsetX + part.l0Height + CUT_OFFSET,
      insertY: placement.packY + offsetY + CUT_OFFSET,
    };
  } else if (placement.rotation === 180) {
    // After 180° rotation, geometry shifts left by l0Width and down by l0Height.
    // Adding (l0Width + CUT_OFFSET) to X and (l0Height + CUT_OFFSET) to Y realigns.
    return {
      insertX: placement.packX + offsetX + part.l0Width + CUT_OFFSET,
      insertY: placement.packY + offsetY + part.l0Height + CUT_OFFSET,
    };
  } else if (placement.rotation === 270) {
    // After 270° CCW rotation, geometry shifts down by l0Width.
    // Adding CUT_OFFSET to X and (l0Width + CUT_OFFSET) to Y realigns.
    return {
      insertX: placement.packX + offsetX + CUT_OFFSET,
      insertY: placement.packY + offsetY + part.l0Width + CUT_OFFSET,
    };
  }
  // 0° rotation: straightforward
  return {
    insertX: placement.packX + offsetX + CUT_OFFSET,
    insertY: placement.packY + offsetY + CUT_OFFSET,
  };
}

// ── Collect and Deduplicate All CUT Lines for a Sheet ──────────────────────

export function collectAndDeduplicate(
  placements: Placement[],
  parts: NestPart[],
  mode: PackingMode,
  offsetX: number,
  offsetY: number,
): Segment[] {
  const partMap = new Map(parts.map((p) => [p.id, p]));
  const allSegments: OwnedSegment[] = [];

  for (let owner = 0; owner < placements.length; owner++) {
    const placement = placements[owner];
    const part = partMap.get(placement.partId);
    if (!part) continue;

    const { insertX, insertY } = computeInsertPosition(placement, offsetX, offsetY, part);

    for (const localSeg of part.cutLines) {
      const sheetSeg = transformCutSegment(localSeg, insertX, insertY, placement.rotation);
      allSegments.push({ ...sheetSeg, owner });
    }
  }

  return deduplicateOwnedCutSegments(allSegments);
}
