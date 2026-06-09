// ────────────────────────────────────────────────────────────────────────────────
// Sheet-Metal — Per-Part Layer Joining
//
// Joins line segments per-part (not per-sheet) using the same strategies
// as nesting/line-joiner.ts but scoped to a single part's shapes.
//
// Plan refs: TASK 10 §4.2
// ────────────────────────────────────────────────────────────────────────────────

import type { LineShape, Layer } from "@/features/sheet-metal/types";
import type { Segment } from "@/features/nesting/types";
import {
  joinSegments,
  type JoinStrategy,
} from "@/features/nesting/line-joiner";

import { LAYER_CUT, LAYER_FREZ, LAYER_FREZ_135, LAYER_HOLES, LAYER_SHEETS, LAYER_ZERO } from "@/features/nesting/constants";

// ── Join strategy per layer ───────────────────────────────────────────────────

/** Same strategy table as nesting/line-joiner.ts, kept in sync.
 *  CUT → full (but CUT is handled by polyline closure, not this function)
 *  FREZ, FREZ_135 → orientation
 *  HOLES → full
 *  Layer 0, SHEETS → skip
 */
export function joinStrategyForLayer(layer: Layer | string): JoinStrategy {
  if (layer === LAYER_SHEETS || layer === LAYER_ZERO) return "skip";
  if (layer === LAYER_FREZ || layer === LAYER_FREZ_135) return "orientation";
  if (layer === LAYER_CUT) return "full"; // CUT uses full join at sheet level for OVERKILL
  if (layer === LAYER_HOLES) return "full";
  // Unknown/custom layers → full join
  return "full";
}

// ── Per-part joining ──────────────────────────────────────────────────────────

/** Group shapes by layer, then apply the per-layer strategy.
 *  Returns a per-layer map of joined segments.
 *
 *  NOTE: CUT layer joining is NOT the same as polyline closure.
 *  CUT segments joined here are for the joinedByLayer field, which
 *  is consumed by the nesting writer for per-sheet dedup (OVERKILL).
 *  The actual per-part CUT closure is done by computeCutPolylines().
 */
export function joinShapesPerLayer(
  shapes: LineShape[],
  tol?: number,
): Record<string, Segment[]> {
  // Group shapes by layer
  const byLayer = new Map<string, Segment[]>();
  for (const shape of shapes) {
    const layer = shape.layer;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push({
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
    });
  }

  const result: Record<string, Segment[]> = {};
  for (const [layer, segments] of byLayer) {
    const strategy = joinStrategyForLayer(layer);
    result[layer] = joinSegments(segments, strategy);
  }

  return result;
}