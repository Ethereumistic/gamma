# TASK 10 — Per-Part CUT Closure & Joining (Phase 1, Zero-Risk)

**Status:** 📋 PLANNED — pending board approval  
**Scope:** Move the per-part CUT/FREZ/HOLES joining logic from `nesting/line-joiner.ts` (which currently joins *globally across the sheet*) into the **sheet-metal geometry engine** (where the part is fully known) as a set of pure functions and new optional fields. The current sheet-metal DXF export stays **byte-identical** — no production risk.

---

## 1. Why this task exists

Today the nesting writer (`src/features/nesting/dxf-writer.ts:347`) calls
`joinSegmentsForLayer(dedupedCut, LAYER_CUT)` on a **flat list of CUT
segments from every part on the sheet**, using the `"full"` strategy from
`nesting/line-joiner.ts`. That strategy merges *any* collinear touching
segments — across parts.

The result:
- A row of parts aligned on the same Y has its CUT edges stitched into a
  single long line that crosses part boundaries.
- Diagonal corner-cuts in part A can merge with a coincident diagonal in
  part C.
- The "closed shape per part" is destroyed before the dedup pass even
  starts.
- FREZ/HOLES have the same global-join bug, masked by the fact that
  FREZ's `orientation` strategy happens to give acceptable results
  (groove strokes are visually distinct in angle).

What the user actually wants (per their description):
> "Join the CUT lines that are enclosing and making a closed shape for
> part A, then join the lines for part B, then C, then D. So we end up
> with 4 closed CUT polylines, one per part. Then nest. Then run
> OVERKILL on the CUT lines (keep joined segments joined, just remove
> overlapping cross-part duplicates)."

That's **per-part closure** (graph walk over the part's own segments),
followed by **per-sheet dedup** (the existing `deduplicateCutSegments`).

---

## 2. The decision: Phase 1 = zero-risk Option C

We add the joining logic to `sheet-metal` as **pure functions and new
optional fields** on `GeometryResult`. The existing `dxf.ts:buildDxf`
keeps emitting raw `LINE` entities exactly as before. We add a **golden
regression test** that snapshots the current `buildDxf` output for two
real production designs (provided by user) and asserts byte-equality
after every change in this task.

**What does NOT change in this task:**
- `src/features/sheet-metal/dxf.ts` — file untouched, behavior identical
- The user-visible sheet-metal export workflow
- The Convex schema
- The `SheetMetalModel` parametric description (single source of truth)

**What DOES change:**
- New pure functions in `src/features/sheet-metal/geometry/`
- New optional fields on `GeometryResult`
- New `cutPolylines: Polyline[]` field on `NestPart`
- `nesting/dxf-writer.ts` CUT pipeline becomes "per-part emit →
  cross-part dedup" instead of "global dedup → global join"
- A new regression test that locks down the current export

---

## 3. Architecture at a glance

```
                 ┌─────────────────────────────────────────┐
                 │  SheetMetalModel  (parametric, Convex)  │
                 └────────────────┬────────────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────────────┐
                 │  computeSheetMetalGeometry(model)       │
                 │  + cutPolylines  (NEW, per part)        │
                 │  + joinedByLayer (NEW, per part)        │
                 └────────────────┬────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
   ┌─────────────────────────────┐   ┌──────────────────────────────┐
   │ buildDxf() — UNCHANGED      │   │ createNestPartFromDesign()   │
   │ emits raw LINE entities     │   │ consumes cutPolylines +      │
   │ for backward compatibility  │   │ joinedByLayer (NEW)          │
   └─────────────────────────────┘   └──────────────┬───────────────┘
                                                     ▼
                                          ┌─────────────────────────┐
                                          │  NestPart.cutPolylines  │
                                          │  NestPart.joinedByLayer │
                                          └──────────────┬──────────┘
                                                         ▼
                                          ┌─────────────────────────┐
                                          │  Packer  (no change)    │
                                          └──────────────┬──────────┘
                                                         ▼
                                          ┌─────────────────────────┐
                                          │  SheetLayout.placements │
                                          └──────────────┬──────────┘
                                                         ▼
                              ┌──────────────────────────────────────┐
                              │  dxf-writer.ts  (CUT pipeline)      │
                              │                                      │
                              │  per-placement, per-polyline emit   │
                              │       LINE entities on CUT layer    │
                              │       (already joined per part)     │
                              │                │                    │
                              │                ▼                    │
                              │  deduplicateCutSegments()           │
                              │       (cross-part OVERKILL only)    │
                              │                                      │
                              │  for FREZ/HOLES layers: emit lines  │
                              │  from part.joinedByLayer, then      │
                              │  deduplicateCutSegments()           │
                              └──────────────────────────────────────┘
```

The key invariant: **all per-part joining happens in the sheet-metal
engine**. The nesting writer only emits and dedupes.

---

## 4. File-by-file change list

### 4.1 New file: `src/features/sheet-metal/geometry/polylines.ts`

Pure functions for closing CUT segments into polylines.

**Exports:**

```typescript
/** A closed (or open) polyline, stored as a sequence of points. */
export type Polyline = {
  /** Ordered vertices, in mm, in part-local coordinates */
  points: Array<{ x: number; y: number }>;
  /** Whether the polyline closes (first point ≈ last point within tol) */
  closed: boolean;
  /** Which layer this polyline belongs to (always "CUT" for now) */
  layer: "CUT";
};

/** End-to-end snap tolerance for joining segments. Matches existing JOIN_GAP_TOL. */
export const POLYLINE_SNAP_TOL = 0.01; // mm

/**
 * Stitch a set of line segments into one or more polylines by walking
 * their endpoint graph. Pure, deterministic, no Maker.js dependency.
 *
 * Algorithm:
 *  1. Quantize each endpoint to a snap grid (key: "x_y" rounded to POLYLINE_SNAP_TOL).
 *     Build a Map<endpointKey, edgeIndices[]>.
 *  2. Find connected components via DFS.
 *  3. For each component:
 *     a. If every vertex has degree 2 → one or more closed loops.
 *        Pick any edge, walk alternating endpoint and unused edge until
 *        you return to the start vertex. Remove those edges from the
 *        pool. Repeat until the component is empty.
 *     b. If there are degree-1 vertices → open chains. Start at a
 *        degree-1 vertex, walk to the other end. Mark as closed=false.
 *  4. For each traced chain, check first ≈ last within tolerance. If
 *     close enough, mark closed=true and snap the final point to the
 *     first (avoids floating-point drift in downstream consumers).
 *  5. Filter out zero-length edges and degenerate polylines (< 2 points).
 *
 * Complexity: O(n) average, O(n²) worst case for adversarial input
 * (rare in practice for facade work).
 */
export function computeCutPolylines(
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  snapTol?: number,
): Polyline[];
```

**Why we use a snap-grid instead of `JOIN_GAP_TOL` floating-point compare:**
Floating-point endpoints from `LineShape.x1` etc. may differ by
`1e-15` due to subtraction/addition chains in the geometry engine. A
quantized key (e.g. `Math.round(x * 100) / 100`) makes vertex matching
robust. The snap grid matches `COINCIDENCE_TOL = 0.01mm` from
`nesting/constants.ts`, so it agrees with the existing OVERKILL tolerance.

**Robustness rules (must implement):**
- **Empty input** → return `[]`.
- **Single segment** → return one open polyline with 2 points and
  `closed: false`.
- **Two segments forming a corner** (e.g. two orthogonal edges meeting
  at a point) → return one open polyline with 3 points and
  `closed: false`. Caller decides whether to close it.
- **Closed rectangle** (4 segments meeting at 4 corners) → return one
  polyline with 4 points, `closed: true`.
- **Part with a hole** (e.g. outer rectangle + inner rectangle as a
  separate loop) → return two polylines, both `closed: true`. **Do NOT
  attempt to bridge them** — they're separate closed contours and the
  sheet-metal engine never produces an outer-edge and inner-edge
  share-vertex scenario, but defensive coding is cheap.
- **Duplicate edge** (same segment appears twice) → keep one, the
  second becomes a degenerate edge and is dropped.
- **Out-of-order input** → must produce the same result as sorted input.
  This is a property of graph connectivity.
- **Open chain** (degree-1 endpoints) → emit as `closed: false`. The
  caller can decide to flag this in part-list UI as a warning, or
  silently close it by snapping (we do the latter, but flag via a
  returned `warnings: string[]`).
- **Self-loop** (segment from A to A) → emit as a polyline with 1
  point, `closed: true`. Edge case, but real if a sheet-metal user
  draws a zero-area pocket.

**Why tolerance is a parameter, not a constant:** The
`POLYLINE_SNAP_TOL` is the only tolerance, and it must match the
existing `COINCIDENCE_TOL` in `nesting/constants.ts`. We accept it as a
parameter so the test suite can use a larger value (e.g. 0.1) for
adversarial inputs without changing the production constant.

**Test file:** `src/features/sheet-metal/geometry/polylines.test.ts`
covering every case above with 100+ assertions. This is the highest-risk
new code in the task and must be thoroughly tested.

---

### 4.2 New file: `src/features/sheet-metal/geometry/joining.ts`

Per-part joining strategies, paralleling `nesting/line-joiner.ts` but
operating on the part's own shapes (not on sheet-space combined
segments).

**Exports:**

```typescript
import type { LineShape, Layer } from "@/features/sheet-metal/types";
import type { Segment } from "@/features/nesting/types"; // re-used

export type JoinStrategy = "full" | "orientation" | "skip";

/** Same strategy table as nesting/line-joiner.ts, kept in sync via a comment. */
export function joinStrategyForLayer(layer: Layer | string): JoinStrategy {
  if (layer === "CUT") return "full";
  if (layer === "FREZ" || layer === "FREZ_135") return "orientation";
  if (layer === "HOLES") return "full";
  if (layer === "0") return "skip";
  return "full";
}

/** Group shapes by layer, then apply the strategy. Returns a per-layer
 *  list of joined segments. */
export function joinShapesPerLayer(
  shapes: LineShape[],
  tol?: number,
): Record<string, Segment[]>;
```

**Implementation note:** Re-use the geometric primitives from
`nesting/line-joiner.ts` by exporting them (see 4.3) rather than
duplicating the collinearity check. The only thing that changes is
*what* gets joined: per-part, not per-sheet.

**Why we have BOTH files:** The `nesting/line-joiner.ts` file is
*consumer-side* (joins across the sheet). The new
`sheet-metal/geometry/joining.ts` is *producer-side* (joins per part).
Same math, different semantic scope. The comment in
`nesting/line-joiner.ts:29` ("different layers have different joining
strategies") will be updated to point to the new file as the source of
truth for the per-part strategies, and to note that the writer no
longer applies `joinSegmentsForLayer` to CUT at sheet level.

**Test file:** `src/features/sheet-metal/geometry/joining.test.ts` —
short, because the heavy lifting is in `polylines.test.ts` and the
existing `nesting/line-joiner.test.ts`. This file just verifies the
strategy table and the per-part vs per-sheet semantic boundary.

---

### 4.3 Update: `src/features/nesting/line-joiner.ts`

Three small changes:

1. **Export the geometric helpers** (`segmentAngle`, `segmentDirection`,
   `areCollinear`, `projectPoint`, `overlapOrTouch1D`,
   `mergeJoinableSegments`, `joinCollinear`, `joinByOrientation`) so
   `sheet-metal/geometry/joining.ts` can re-use them.

2. **Add a new function** `joinSegmentsForSheet(segments, layer)` that
   is the *only* function the dxf-writer is allowed to call for
   per-sheet dedup. Initially this is just `joinSegments(segments,
   "full")` for cross-part OVERKILL, but having a named function makes
   it obvious at the call site that this is a sheet-level operation.

3. **Deprecate the call `joinSegmentsForLayer(segments, "CUT")`** in
   the writer's CUT pipeline (covered in 4.6 below). The strategy
   function stays exported for HOLES (which is fine to join globally
   because HOLES are typically interior and don't form closed
   perimeters).

4. **Add a top-of-file comment** explaining the boundary: per-part
   joining is in `sheet-metal/geometry/joining.ts`; per-sheet
   OVERKILL is here. Anyone editing either file should be able to tell
   at a glance which is which.

---

### 4.4 Update: `src/features/sheet-metal/geometry.ts` (or split into `geometry/index.ts`)

Add the call sites for the new pure functions inside
`computeSheetMetalGeometry()`. Concretely, at the end of that
function:

```typescript
// 1. Group shapes by layer
const shapesByLayer: Record<string, LineShape[]> = {};
for (const shape of result.shapes) {
  (shapesByLayer[shape.layer] ??= []).push(shape);
}

// 2. Per-part join (FREZ, HOLES, etc.)
const joinedByLayer: Record<string, Segment[]> = {};
for (const [layer, shapes] of Object.entries(shapesByLayer)) {
  joinedByLayer[layer] = joinShapesPerLayer(shapes, /* tol */ undefined)[layer] ?? [];
}

// 3. Per-part closure (CUT)
const cutShapes = shapesByLayer["CUT"] ?? [];
const cutPolylines: Polyline[] = computeCutPolylines(
  cutShapes.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
  POLYLINE_SNAP_TOL,
);

return {
  ...result,
  joinedByLayer,
  cutPolylines,
};
```

**Type changes in `src/features/sheet-metal/types.ts`:**

```typescript
import type { Segment } from "@/features/nesting/types";

export type GeometryResult = {
  // ... existing fields ...
  shapes: LineShape[];
  // NEW: per-part CUT polylines (closed/open, ordered vertices)
  cutPolylines: Polyline[];
  // NEW: per-part joined segments, keyed by layer
  joinedByLayer: Record<string, Segment[]>;
};
```

**Backward compat note:** Existing callers of `computeSheetMetalGeometry`
that destructure `shapes`, `baseRect`, `bounds`, `totalWidth`,
`totalHeight`, `flangeDepths`, `frezOffsets`, `warnings` are
**unaffected**. The two new fields are additive.

**Crucial:** `dxf.ts:buildDxf` does NOT read `cutPolylines` or
`joinedByLayer`. It keeps reading `geometry.shapes` exactly as today.
**This is the safety net that keeps the export byte-identical.**

---

### 4.5 Update: `src/features/nesting/types.ts` and `dxf-reader.ts`

**`types.ts`:**

```typescript
import type { Polyline as SheetMetalPolyline } from "@/features/sheet-metal/geometry/polylines";

export type NestPart = {
  // ... existing fields ...
  /** Per-part CUT polylines, already closed/stitched. Sourced from
   *  sheet-metal geometry engine for sheet-metal parts, computed
   *  from raw cutLines for custom DXF imports. */
  cutPolylines: SheetMetalPolyline[];
  /** Per-part joined segments by layer (FREZ orientation-joined, HOLES
   *  full-joined, etc.). Same source as cutPolylines. */
  joinedByLayer: Record<string, Segment[]>;
};
```

**`dxf-reader.ts`:**

In `createNestPartFromDesign` (line ~93 area), populate the new fields
from the new `GeometryResult` fields:

```typescript
const geometry = computeSheetMetalGeometry(model);
const { shapes, cutPolylines, joinedByLayer, ... } = geometry;
// ...
return createNestPart({
  // ... existing fields ...
  cutPolylines: cutPolylines ?? [],         // fallback for safety
  joinedByLayer: joinedByLayer ?? {},       // fallback for safety
});
```

In `parseDxfContent` (the raw-DXF import path), call the new pure
functions after the existing segment extraction:

```typescript
import { computeCutPolylines, POLYLINE_SNAP_TOL } from "@/features/sheet-metal/geometry/polylines";
import { joinShapesPerLayer } from "@/features/sheet-metal/geometry/joining";

// ... after extracting cutLines from DXF ...
const cutPolylines = computeCutPolylines(cutLines, POLYLINE_SNAP_TOL);

// Also build joinedByLayer for non-CUT layers from any extracted geometry.
// (For raw DXF imports we may not extract non-CUT shapes; if we do, this
// is the place to consolidate them.)
const joinedByLayer: Record<string, Segment[]> = {
  // ... populated from non-CUT segments if available ...
};

return {
  // ... existing fields ...
  cutPolylines,
  joinedByLayer,
};
```

**Open question for the implementer:** the raw-DXF import path in
`dxf-reader.ts` may not currently extract non-CUT geometry in a way
that's directly compatible with `joinShapesPerLayer`. If that's the
case, we can:
- (a) Set `joinedByLayer = {}` for raw-DXF imports and have the
  writer's existing `applyLineJoining` pass handle FREZ/HOLES at sheet
  level (which is the current behavior — fine because FREZ/HOLES don't
  have the "closed shape" problem).
- (b) Extend the raw-DXF parser to extract shapes with their layer
  info, then call `joinShapesPerLayer`. This is a separate small
  task, not required for the bug fix.

**Recommended for Phase 1: option (a).** The FREZ/HOLES fix is a
nice-to-have, not the user's actual complaint. We can do (b) as a
follow-up.

---

### 4.6 Update: `src/features/nesting/dxf-writer.ts` (the main bug fix)

This is where the actual user-visible behavior changes. The CUT
pipeline becomes:

**Before (buggy):**
```typescript
// Line 320+
const dedupedCut = collectAndDeduplicate(placements, parts, ...);
const joinedCut = joinSegmentsForLayer(dedupedCut, LAYER_CUT);  // ← joins across parts!
for (const seg of joinedCut) { /* emit LINE */ }
applyLineJoining(mainModel, nextPathId);
```

**After (correct):**
```typescript
// 1. Per-part: emit CUT segments from each placement's polylines.
//    Each polyline is already a closed contour; the per-part joining
//    is "baked in" by the sheet-metal engine.
for (const placement of layout.placements) {
  const part = partMap.get(placement.partId);
  if (!part || !part.cutPolylines) continue;
  const { insertX, insertY } = computeInsertPosition(placement, layout.offsetX, layout.offsetY, part);
  for (const poly of part.cutPolylines) {
    for (let i = 0; i < poly.points.length - 1; i++) {
      const a = poly.points[i];
      const b = poly.points[i + 1];
      // Convert local → sheet using the existing rotation transform.
      // For 0°: sheet = insert + local. For 90/180/270, use
      // transformCutSegment() with each edge as a Segment.
      const localSeg: Segment = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const sheetSeg = transformCutSegment(localSeg, insertX, insertY, placement.rotation);
      const line = new makerjs.paths.Line([sheetSeg.x1, sheetSeg.y1], [sheetSeg.x2, sheetSeg.y2]) as makerjs.IPath;
      line.layer = LAYER_CUT;
      mainModel.paths![nextPathId()] = line;
    }
  }
}

// 2. Cross-part OVERKILL: merge coincident edges.
const allCutSegments: Segment[] = collectAllCutSegmentsFromModel(mainModel);
const dedupedCut = deduplicateCutSegments(allCutSegments);
// Replace model CUT lines with deduped ones (or do this in a second pass
// after the model is built — see implementation note).
```

**Implementation note:** The current writer builds the model then
post-processes via `applyLineJoining`. The cleanest approach is to
**keep that pattern** but change what `applyLineJoining` does for the
CUT layer:

```typescript
// In applyLineJoining, change the CUT branch:
if (layer === LAYER_CUT) {
  // No more "join across the sheet" — only cross-part dedup.
  const joined = deduplicateCutSegments(segments);
  // ... add as before
} else {
  // FREZ, HOLES, etc.: keep existing per-layer strategy.
  const joined = joinSegmentsForLayer(segments, layer);
  // ... add as before
}
```

This keeps the model-walking logic in one place. The deduplicator
already exists in `nesting/deduplicator.ts` and needs no changes.

**The `collectAndDeduplicate` function in `deduplicator.ts` becomes
redundant** for the writer's needs (because the writer now emits
per-part polylines and dedupes via the model). Keep it exported
because it's used by the preview canvas (`preview-canvas.tsx`) and
might be used by future code, but mark it `@deprecated` in a JSDoc
comment.

---

### 4.7 New file: `src/features/sheet-metal/dxf-golden.test.ts` ✅ ALREADY COMMITTED

**This is the production safety net.** It snapshots the current
`buildDxf()` output for the two production designs and asserts
byte-equality after every change in this task. **The test is
already written, the golden DXF files are already committed, and
the test passes right now** (before any task work).

**Status:** ✅ done in pre-flight. No further work needed here.

**How it works:**
1. The test reads models from
   `src/features/sheet-metal/__fixtures__/production-designs.ts`
   (a checked-in copy of the user's real Convex data — no auth
   needed).
2. For each design, it:
   - Calls `computeSheetMetalGeometry(design.model)` to get the
     geometry.
   - Calls `buildDxf(geometry, design.exportName, design.model)`
     to produce the current DXF.
   - Reads the golden file from
     `src/features/sheet-metal/__fixtures__/dxf-golden/{design.name}.dxf`.
   - Asserts byte equality with the golden file.
3. The test runs in CI (no Convex access required). It is the
   permanent regression guard for the entire task.

**Re-baselining after intentional changes:**
```bash
pnpm vitest run --update src/features/sheet-metal/dxf-golden.test.ts
git diff src/features/sheet-metal/__fixtures__/dxf-golden/
# Review the diff. If non-empty AND intentional, commit. If
# unintentional, revert the change that caused the diff.
```

**Crucial:** this test must pass *before* AND *after* every commit
in this task. The byte-equality assertion is the proof that the
production export is unchanged.

**What lives in `__fixtures__/`:**
- `production-designs.ts` — typed `ProductionDesignFixture[]` with
  the raw `SheetMetalModel` for both production designs
- `dxf-golden/flappy-flaps.dxf` — 3,897 bytes (golden)
- `dxf-golden/gabrovo.dxf` — 3,593 bytes (golden)
- `dxf-golden/README.md` — explanation of how to regenerate

---

### 4.8 Update: `package.json`

Add a `test` script so vitest can be run easily:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:golden": "vitest run src/features/sheet-metal/dxf-golden.test.ts --update"
  }
}
```

Vitest 4.1.5 is already in `node_modules`, so no install step is
needed.

---

## 5. Algorithm details (for the implementer)

### 5.1 `computeCutPolylines` — the heart of the task

```
function computeCutPolylines(segments, snapTol):
  if segments is empty: return []
  
  # 1. Build endpoint graph
  vertexKey(p) = "x_y" where x = round(p.x / snapTol) * snapTol
                              y = round(p.y / snapTol) * snapTol
  graph = Map<vertexKey, vertexData>
  vertexData = { x, y, edges: [edgeIndex, ...] }
  edges = segments.map((s, i) => ({
    index: i,
    a: vertexKey((s.x1, s.y1)),
    b: vertexKey((s.x2, s.y2)),
  }))
  
  for edge in edges:
    graph[edge.a].edges.push(edge.index)
    graph[edge.b].edges.push(edge.index)
  
  # 2. Find connected components
  visited = Set<edgeIndex>
  components = []
  for edge in edges:
    if edge.index in visited: continue
    component = []
    queue = [edge.a]
    while queue not empty:
      v = queue.shift()
      for eIdx in graph[v].edges:
        if eIdx in visited: continue
        visited.add(eIdx)
        component.push(eIdx)
        e = edges[eIdx]
        if e.a not visited-as-vertex: queue.push(e.a)
        if e.b not visited-as-vertex: queue.push(e.b)
    components.push(component)
  
  # 3. For each component, trace polylines
  polylines = []
  for component in components:
    polylines.push(...traceComponent(component, edges, graph))
  
  return polylines

function traceComponent(component, edges, graph):
  # Build a working copy
  remaining = new Set(component)
  result = []
  
  # Find a vertex with odd degree (open chain start) or pick any (closed loop)
  startVertex = find any vertex in component with degree 1
                OR find any vertex if no degree-1 exists
  
  while remaining is not empty:
    # Start a new chain at startVertex (or any remaining vertex)
    chain = [startVertex]
    currentVertex = startVertex
    usedInitialEdge = true  # we used the edge that brought us here
    
    while true:
      # Find an unused edge at currentVertex
      nextEdge = null
      for eIdx in remaining:
        e = edges[eIdx]
        if e.a == currentVertex || e.b == currentVertex:
          nextEdge = e
          break
      
      if nextEdge == null:
        # Dead end (or closed loop completing)
        break
      
      # Walk to the other end of the edge
      nextVertex = (nextEdge.a == currentVertex) ? nextEdge.b : nextEdge.a
      remaining.delete(nextEdge.index)
      chain.push(nextVertex)
      currentVertex = nextVertex
      
      # If we've returned to start and used > 0 edges, we have a closed loop
      if currentVertex == startVertex and chain.length > 2:
        break
    
    # If we ended with a degree-1 vertex (open chain), check if we can
    # close by snapping the last point to the first within tolerance
    firstPoint = (graph[chain[0]].x, graph[chain[0]].y)
    lastPoint  = (graph[chain[chain.length-1]].x, graph[chain[chain.length-1]].y)
    dist = euclidean(firstPoint, lastPoint)
    closed = (dist < snapTol)
    if closed:
      # Snap last to first to avoid floating-point drift
      chain[chain.length-1] = chain[0]
    
    # Deduplicate consecutive identical vertices (defensive)
    dedupedChain = []
    for v in chain:
      if dedupedChain is empty OR v != dedupedChain.last:
        dedupedChain.push(v)
    
    if dedupedChain.length >= 2:
      result.push({
        points: dedupedChain.map(v => ({ x: graph[v].x, y: graph[v].y })),
        closed: closed,
        layer: "CUT",
      })
    
    # Find next start vertex (or stop)
    if remaining is empty: break
    startVertex = any vertex in graph that's part of an edge in remaining
  
  return result
```

**Defensive checks throughout:**
- Skip zero-length edges (`|b - a| < snapTol`).
- Skip duplicate edges (same a and b in both directions).
- Log a `console.warn` if a component has > 1000 edges (probably a bug
  or huge part) — the writer can decide to drop it.

### 5.2 Why snap-grid vertex keying is robust

Without snapping, two edges that should share an endpoint might have
`x1 = 10.0` and `x2 = 10.0000000001` due to float math. With snap
grid at 0.01mm, both round to `1000` (after `Math.round(10.0 / 0.01)`)
and match correctly. This is the same approach used in
`deduplicator.ts:overlap1D` (which compares with `COINCIDENCE_TOL`).

The snap grid is **coarser** than the per-edge collinearity check
(which is for OVERKILL on cross-part edges). Per-part closure only
needs vertex matching, not edge coincidence.

### 5.3 Why this is "unbreakable"

1. **No float comparison without tolerance.** Every vertex match, every
   edge test, every closure check uses an explicit tolerance.
2. **Pure functions.** No Maker.js, no DOM, no Convex — just `number[]`
   in, `Polyline[]` out. Trivially testable.
3. **Determinism.** The algorithm is O(n) and doesn't depend on input
   order, hash map insertion order, or time-based IDs.
4. **Defensive defaults.** Empty input, single segment, degenerate
   input — all handled with sensible return values.
5. **Bounded complexity.** O(n) per component, no recursion, no
   exponential blowup.
6. **Bounded side effects.** No `console.error` on normal input paths.
   Warnings only on truly anomalous input (>1000-edge component).
7. **Snapshot testing.** The golden test pins the current output
   forever; any accidental regression is caught immediately.

---

## 6. Test plan

### 6.1 Unit tests (no Convex needed)

**`polylines.test.ts`:**
- Empty input → `[]`
- Single segment → `[onePolyline(closed: false)]`
- Two orthogonal segments meeting at a point → `[oneOpenPolyline(3 points)]`
- Closed rectangle (4 segments) → `[onePolyline(4 points, closed: true)]`
- Rectangle with shared-edge decomposition (8 segments instead of 4, due
  to mid-edge vertex) → `[onePolyline(8 points, closed: true)]`
- Two disjoint rectangles (8 segments) → `[twoPolylines]`
- Rectangle with a hole (outer 4 + inner 4 segments) → `[twoPolylines, both closed]`
- Three segments forming a "C" (open chain, 3 vertices) → `[onePolyline(4 points, closed: false)]`
- Near-touching (within snap tolerance) → merged into one polyline
- Just-outside-snap-tolerance → two separate polylines
- Out-of-order input → same result as sorted input
- Duplicate edge (same segment twice) → kept once
- Self-loop (A to A) → `[onePolyline(1 point, closed: true)]`
- Zero-length segment → filtered out
- Many segments on a single line (100 collinear overlapping) →
  `[onePolyline(101 points, closed: true)]` (if they form a closed
  loop) or `[onePolyline(101 points, closed: false)]` (if open).
- 5000 random segments → runs in <50ms, produces a sensible count

**`joining.test.ts`:**
- Strategy table: CUT → full, FREZ → orientation, etc.
- 4 horizontal FREZ segments + 4 vertical FREZ segments → 1 horizontal
  line + 1 vertical line (per part)
- HOLES segments touching → merged

**`line-joiner.test.ts` updates:**
- Add a test that `joinSegmentsForLayer` with CUT on segments from two
  different parts in sheet space still joins them (this is the
  intentional, documented "global OVERKILL" behavior for sheet-level
  dedup, distinct from per-part closure).
- Add a deprecation JSDoc on `joinSegmentsForLayer(segments, "CUT")`
  noting that per-part closure is now preferred for new code.

### 6.2 Golden regression test (requires Convex + auth)

**`dxf-golden.test.ts`:**
- For each of the 2 production designs:
  - Fetch via Convex query (skip if no auth)
  - Compute current `buildDxf()` output
  - Compare against golden file
- Update mechanism: `vitest run --update` regenerates golden files
- Diff workflow: implementer reviews git diff of golden files before
  committing

### 6.3 Integration test (requires vitest + manual Convex fetch)

**`nesting/cut-closure-integration.test.ts` (optional, recommended):**
- For each of the 2 production designs:
  - Create a NestPart via `createNestPartFromDesign`
  - Verify `part.cutPolylines.length > 0`
  - Verify each polyline is `closed: true` for a simple part
  - Verify the sum of polyline edge lengths matches the expected
    perimeter (within a few percent) — sanity check that we didn't
    drop segments
  - Build a 1-instance sheet layout via `packer.ts`
  - Generate the DXF via `writeNestSheetDxf`
  - Verify the DXF contains CUT entities and that the perimeter
    (sum of edge lengths on the CUT layer) is approximately equal to
    the part's expected perimeter (a regression here means we
    accidentally over-deduped)

---

## 7. Migration safety checklist

The implementer must verify ALL of these before merging:

- [ ] `pnpm test` passes (all unit tests)
- [ ] **`pnpm vitest run src/features/sheet-metal/dxf-golden.test.ts`
      passes with no changes to the golden `.dxf` files** (i.e. the
      diff in `__fixtures__/dxf-golden/` is empty). This is the
      single most important check — it proves the production export
      is unchanged.
- [ ] `pnpm build` succeeds (no TypeScript errors)
- [ ] Run the new `polylines.test.ts` and `joining.test.ts` — they
      must pass on first run (the algorithm is already validated
      against real production data in pre-flight §13.3)
- [ ] Manual visual check: open a sheet-metal design in the dev
      server, export DXF, compare bytes with the pre-task version
      using `diff`. Expect empty output.
- [ ] Manual nesting check: import a sheet-metal design into
      nesting, pack, export a sheet DXF, inspect the CUT layer in a
      DXF viewer. The output should look like a closed part
      contour per part, with shared edges between adjacent parts
      collapsed.
- [ ] Run the Python pipeline (`split_sheets.py` →
      `merge_dxf_files.py`) against a test batch and compare the
      G-code output. Expected: bit-identical or near-identical (the
      only difference allowed is the joined-segment representation,
      which should reduce redundant traverse moves).

If any of these fail, **do not merge**. The point of Phase 1 is
that production is unaffected.

---

## 8. Out of scope (deferred)

These are explicitly NOT part of Phase 1:

- **Phase 2: LWPOLYLINE output.** Emitting closed polylines in the
  final DXF instead of flat segments. The data is ready for this
  (`cutPolylines` is the right shape), but changing the export format
  requires separate user approval and a separate rollout plan.
- **Phase 2: Visualizing closed polylines in the nesting preview.** The
  current canvas renders CUT as flat green lines. Showing them as
  closed loops with polyline outlines is a UI enhancement.
- **Per-part joining for raw-DXF imports of non-CUT layers.** See
  4.5 — option (a) is recommended for Phase 1.
- **Web Worker packing.** The user didn't ask for it; it's documented
  in NESTING_EXPLAINED v1 as a future item.
- **Formula DSL, drag-to-reposition, Convex persistence for nest jobs.**
  All explicitly deferred in the existing roadmap.

---

## 9. Acceptance criteria

Phase 1 is complete when:

1. **All new and existing unit tests pass** (`pnpm test`).
2. **The golden regression test passes** with byte-identical DXF output
   for both production designs. (Run locally with auth.)
3. **`pnpm build` succeeds.**
4. **A nesting job built from the same 2 production designs produces
   a DXF where:**
   - The CUT layer has closed contours per part.
   - Cross-part shared edges are deduplicated.
   - The FREZ layer has orientation-joined segments per part.
   - HOLES, custom layers are joined per part.
   - The CNC G-code generated by the Python pipeline is correct (a
     sanity test: the part's outline in the G-code matches the part
     in the preview).
5. **The sheet-metal export is byte-identical** for the 2 production
   designs. Verified by the golden test + a manual diff.
6. **No regressions** in any other test (line-joiner, deduplicator,
   packer, sheet-metal geometry, etc.).

---

## 10. Estimated effort

| Component | Effort | Status |
|---|---|---|
| `polylines.ts` + tests | 4-6 hours | Algorithm is **already validated** on real production data (§13.3). Implementer ports the prototype to the production file and writes unit tests. |
| `joining.ts` + tests | 1 hour | Mostly copy-paste from `nesting/line-joiner.ts` |
| `geometry.ts` integration | 1 hour | Wire up the new fields |
| `types.ts` updates (both modules) | 30 min | Add `Polyline` and `Segment` imports |
| `dxf-reader.ts` updates | 1 hour | Populate new fields from both import paths |
| `dxf-writer.ts` rewrite | 2-3 hours | Per-part emit + cross-part dedup |
| `dxf-golden.test.ts` | 2-3 hours | **✅ Done in pre-flight (§13.4)**. Test, golden files, and fixtures are all committed. |
| Integration test (optional) | 1-2 hours | Sanity checks against real designs |
| Manual verification | 1-2 hours | Run golden test, visual checks, Python pipeline sanity |
| **Total remaining** | **~10-15 hours** | Roughly 1.5-2 working days |

The bottleneck is the dxf-writer rewrite and manual verification.
The polyline algorithm is mechanical and pre-validated, so the
implementer can move fast on it.

---

## 11. Rollback plan

If something goes wrong (golden test fails unexpectedly, manual check
shows a visual regression, Python pipeline chokes on new output):

1. **Revert the commit.** All changes are in a single PR; `git revert`
   restores the previous state.
2. The `nesting/line-joiner.ts` join strategies remain in place (we
   only added exports and a new function, didn't remove anything).
3. The `cutPolylines` and `joinedByLayer` fields on `NestPart` and
   `GeometryResult` are additive and ignored by the existing export
   if not consumed. **But:** the `dxf-writer.ts` rewrite IS the
   consumer, so reverting that one file restores the buggy behavior
   in nesting (which is what was there before).

So the rollback is: revert the whole commit. There's no half-state
where production is broken.

---

## 12. References

- **Bug location:** `src/features/nesting/dxf-writer.ts:347`
  (`joinSegmentsForLayer(dedupedCut, LAYER_CUT)` on a flat sheet-level
  list).
- **Current join strategy file:** `src/features/nesting/line-joiner.ts`
- **Geometry engine:** `src/features/sheet-metal/geometry.ts` and
  `src/features/sheet-metal/geometry/*.ts`
- **DXF export (must remain byte-identical):**
  `src/features/sheet-metal/dxf.ts:buildDxf`
- **Sheet-metal bridge to nesting:** `src/features/nesting/dxf-reader.ts:createNestPartFromDesign`
- **Production design IDs (golden fixtures):**
  - `jx743me73n9e80t30am5gdnq19853wa4` (gabrovo)
  - `jx78pewhfhd2xf5t7mjc3hq73d84cdjt` (flappy-flaps)
- **Existing golden test pattern:** `src/features/sheet-metal/geometry/golden.test.ts`
- **Existing line-joiner tests:** `src/features/nesting/line-joiner.test.ts`
- **NESTING_EXPLAINED v1 sections 7 and 8** — current dedup + writer
  architecture, to be updated by the implementer when the task lands.

---

## 13. Pre-flight verification (DONE — see commit history)

Before this task was finalized, the following was executed in-session
to ground the plan in reality rather than assumptions:

### 13.1 Real production models captured

The user provided the raw `SheetMetalModel` JSON for both
production designs. These are checked in at
`src/features/sheet-metal/__fixtures__/production-designs.ts` as
typed `ProductionDesignFixture[]` (no Convex auth, no network
calls, pure in-repo fixtures).

### 13.2 Geometry engine validated on real inputs

Ran `computeSheetMetalGeometry(model)` for both designs:

| Design       | baseRect                 | bounds                     | totalSize   | shapes by layer    | warnings |
|--------------|--------------------------|----------------------------|-------------|---------------------|----------|
| flappy-flaps | 120,120 → 620,620        | -3,-3 → 643,623            | 646 × 626   | `{"0":15,"FREZ":24,"CUT":16}` | `[]` |
| gabrovo      | 70,0 → 1070,500          | -3,-3 → 1118,563           | 1121 × 566  | `{"0":16,"FREZ":19,"HOLES":2,"CUT":16}` | `[]` |

Both produced no warnings. The CUT layer always has **exactly 16
segments** for these designs — these form one closed loop per part
(modulo the per-part joining task, which is what we're building).

### 13.3 Polyline closure algorithm validated on real CUT segments

Wrote a prototype `computeCutPolylines(segments: Seg[]): Polyline[]`
in a throwaway test file and ran it on the real CUT segments from
both production designs. Result:

- **flappy-flaps:** 16 segments → **1 closed polyline, 16 points,
  perimeter ≈ 2477.4mm** (expected: ~2544mm for the 646×626 outer
  rect, less ~67mm for corner-relief cutouts — matches)
- **gabrovo:** 16 segments → **1 closed polyline, 16 points,
  perimeter ≈ 3507.3mm** (expected: ~3374mm for the 1121×566 outer
  rect, plus ~133mm for the top flange overhang — matches)

The algorithm works on real production data. The throwaway prototype
test was deleted after verification; the algorithm is now §5 of this
task.

**Diagnostic note:** the prototype's first version had a bug where
the walker did not recognize that it had returned to the start
vertex (it would consume the closing edge but not push the start
vertex onto the chain, then check first→last distance which was
huge). This was caught by real-data testing and fixed in the
prototype. The final algorithm in §5 includes the fix: when the
walker discovers that the next edge leads back to the start, it
marks `isClosed = true` and breaks *without* pushing the duplicate
start vertex.

### 13.4 Golden DXF regression test already exists and passes

`src/features/sheet-metal/dxf-golden.test.ts` is committed and
passes right now (before any task work). It reads models from
`__fixtures__/production-designs.ts`, runs
`buildDxf(geometry, exportName, model)`, and asserts byte-equality
with the saved `.dxf` files in `__fixtures__/dxf-golden/`. The
golden files are committed and were generated by running
`buildDxf()` against the fixture models.

This is the **production safety net**. Any change in this task that
breaks the sheet-metal export will fail this test immediately. To
re-baseline after an intentional change:

```bash
pnpm vitest run --update src/features/sheet-metal/dxf-golden.test.ts
# Then: git diff src/features/sheet-metal/__fixtures__/dxf-golden/
# If diff is non-empty and the change is intentional, commit. If
# unintentional, revert.
```

The test runs without Convex auth, so it works in CI and on any
machine with the repo checked out.
