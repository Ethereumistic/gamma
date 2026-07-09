# CUT OVERKILL / Deduplication Plan

## Goal

Move CUT-layer deduplication out of the browser nesting exporter and into an isolated Python CNC-prep step.

The browser should export faithful nested geometry:

- Each sheet-metal part keeps its own correct `CUT` contour.
- Layer `0`, `FREZ`, `HOLES`, labels, and sheet frames stay aligned and readable.
- The exporter avoids risky cross-part topology edits.

The Python prep step should take the already-exported nested DXF and produce a CNC-ready DXF where overlapping `CUT` segments have been removed/unioned.

```text
Nesting browser export
  -> nested_sheet.dxf
  -> Python CUT OVERKILL step
  -> nested_sheet.cnc-ready.dxf
  -> CNC pipeline upload/import
```

## Why This Belongs Outside the Browser

Browser-side CUT deduplication has conflicting responsibilities:

- CAD preview wants closed per-part contours.
- CNC cutting wants shared overlapping edges traversed only once.
- Removing one shared edge from one part can make a contour visually open.
- Keeping one owner polyline plus one standalone edge is fragile and hard to reason about.
- Browser geometry dependencies have not been robust enough for this use case.

A post-export Python step is safer because all geometry is already in final sheet coordinates. There is no part-local origin, packing rotation, layout offset, or Layer `0` alignment problem left to solve.

## Scope

The first version should deduplicate only the `CUT` layer.

It should preserve all non-CUT entities exactly as much as practical:

- Layer `0`
- `FREZ`
- `FREZ_135`
- `HOLES`
- `SHEETS`
- labels/text
- layer tables/header metadata

It should not attempt toolpath ordering, lead-ins, feed/speed logic, or CNC optimization. Those are separate concerns.

## Recommended Location

Add the implementation under the backend/tooling side, not the frontend:

```text
cnc-pipeline-backend/
  cnc_pipeline/
    cut_overkill.py
  tests/
    test_cut_overkill.py
```

Optional CLI wrapper:

```text
cnc-pipeline-backend/
  scripts/
    overkill_cut.py
```

The module should be importable by the CNC pipeline later, and runnable as a standalone tool during debugging.

## Dependencies

Use `ezdxf` for DXF reading/writing.

Prefer a custom segment dedup algorithm for the first version instead of relying on heavyweight geometric union libraries. The `CUT` output currently consists of straight polyline/line segments, so a deterministic tolerance-based algorithm is easier to inspect and test.

Possible future dependency:

- `shapely`: useful if curved geometry, polygon unions, or more advanced geometry operations become necessary.

Do not start with Shapely unless the segment-only approach proves insufficient.

## Input Geometry Handling

Read modelspace entities on layer `CUT`.

Support:

- `LINE`
- classic `POLYLINE` / `VERTEX` / `SEQEND`
- `LWPOLYLINE`

For closed polylines, emit the closing segment from the last vertex to the first.

For unsupported `CUT` entities:

- Preserve them unchanged in v1, or fail loudly if preserving would make the output misleading.
- Log/report their type.
- Do not silently delete them.

Arcs on `CUT` should be treated as a later enhancement unless they are present in real files. If needed, flatten arcs with a small chord tolerance and document that behavior.

## Core Algorithm

Work in final sheet-space coordinates.

1. Extract all `CUT` entities and flatten supported entities into segments.
2. Remove the original supported `CUT` entities from the output document.
3. Normalize points using a tolerance grid.
4. Group segments by their infinite supporting line.
5. Within each line group, project segments to 1D intervals.
6. Split overlapping intervals into atomic spans.
7. Keep each atomic span exactly once when it is covered by one or more source segments.
8. Emit deduplicated `CUT` geometry back into the DXF.

### Tolerance

Recommended initial tolerance:

```text
0.01 mm
```

Make it configurable:

```text
--tol 0.01
```

Use this tolerance for:

- endpoint snapping
- collinearity grouping
- zero-length filtering
- interval boundary merging

### Why Atomic Intervals

Avoid simple pairwise merge/delete logic.

Pairwise overlap handling can fail when there are partial overlaps:

```text
A: 0 ---- 100
B:      50 ---- 150
```

The correct deduped result is:

```text
0 ---- 50
50 --- 100
100 -- 150
```

with each span emitted once. It may later be joined back into:

```text
0 ---- 150
```

only if doing so is safe for the CNC import path.

The first implementation may emit atomic spans as `LINE` entities. This is easier to verify and avoids accidentally creating invalid or misleading polylines.

## Geometric Grouping Details

For each segment:

- Drop it if length <= tolerance.
- Compute direction vector `(dx, dy)` and normalize.
- Canonicalize direction so equivalent reversed lines share the same key.
- Compute a signed perpendicular distance from origin.
- Quantize direction and distance using the tolerance.

For mostly horizontal/vertical geometry, the grouping will be simple. For diagonal V-notch edges, the same algorithm still works if direction and distance are canonicalized carefully.

Inside a group:

- Choose a unit direction vector.
- Project each endpoint onto that vector to get interval coordinates.
- Sort all interval endpoints.
- Merge endpoints within tolerance.
- For each adjacent pair, keep the span if its midpoint is covered by at least one original interval.

When reconstructing each atomic span:

- Convert projected scalar coordinates back to XY using the group line origin and unit direction.
- Round output coordinates to a reasonable precision, for example 6 decimal places.

## Output Strategy

Recommended v1 output:

- Preserve the DXF document.
- Delete supported original `CUT` entities.
- Add deduped `CUT` spans as `LINE` entities.
- Keep layer name `CUT`.
- Keep existing layer table color if present.

This means the CNC-ready file may not preserve per-part closed polylines on `CUT`. That is acceptable because this file is for CNC ingestion, not human part-topology inspection.

Keep the original browser-exported DXF as the visual/audit file.

Suggested filenames:

```text
1_r12_A_p6_u83.dxf
1_r12_A_p6_u83.cnc-ready.dxf
```

## CLI Design

Example:

```bash
cd cnc-pipeline-backend
python -m cnc_pipeline.cut_overkill input.dxf output.dxf --layer CUT --tol 0.01
```

Optional batch mode:

```bash
python -m cnc_pipeline.cut_overkill ./nested_exports ./cnc_ready --layer CUT --tol 0.01
```

The CLI should print a concise report:

```text
input: 1_r12_A_p6_u83.dxf
layer: CUT
source entities removed: 48
source segments: 912
deduped segments: 874
overlapping spans removed: 38
unsupported CUT entities preserved: 0
output: 1_r12_A_p6_u83.cnc-ready.dxf
```

## Integration Options

### Option A: Manual Pre-Upload Step

Lowest risk.

User exports nesting DXFs, runs Python overkill script, then uploads `.cnc-ready.dxf` to CNC pipeline.

Pros:

- Easy to debug.
- No backend API changes.
- Keeps original and CNC-ready files side by side.

Cons:

- Manual step.

### Option B: CNC Pipeline Import Preprocessor

When a DXF is uploaded to the CNC pipeline, the backend automatically runs CUT overkill before parsing.

Pros:

- User workflow is simple.
- CNC pipeline always sees deduped CUT.

Cons:

- Hidden transformation unless the UI exposes it.
- Need good diagnostics and download access to the processed DXF.

### Option C: Browser Export Calls Backend Processor

The frontend exports the nested DXF, sends it to the backend for processing, then downloads both original and CNC-ready files.

Pros:

- Nice UX.
- Keeps browser exporter simple.

Cons:

- Requires backend availability from nesting.
- More moving pieces.

Recommended rollout:

1. Build Option A first.
2. Add tests and prove it on real nested sheets.
3. Integrate as Option B or C only after the algorithm is trusted.

## Testing Plan

Add focused unit tests with synthetic DXFs:

1. Exact duplicate line, same direction.
2. Exact duplicate line, reversed direction.
3. Partial overlap.
4. Three-way partial overlap.
5. Touching end-to-end segments that do not overlap.
6. Diagonal overlap.
7. Closed rectangular polylines from two adjacent parts sharing one edge.
8. Classic `POLYLINE` input.
9. `LWPOLYLINE` input.
10. Non-CUT layers remain present.
11. Unsupported CUT entities are reported and preserved or rejected according to chosen v1 behavior.

Add a fixture test using a real nested DXF once available:

```text
tests/fixtures/nesting/shared-cut-before.dxf
tests/fixtures/nesting/shared-cut-after.expected.json
```

The expected JSON should include counts and representative segment coordinates rather than requiring byte-for-byte DXF equality.

## Validation Plan

For each real nested export:

1. Run the overkill step.
2. Parse the output with the CNC pipeline DXF reader.
3. Verify no duplicate or overlapping `CUT` spans remain within tolerance.
4. Verify Layer `0` to `CUT` offset is still visually correct in the original nesting export.
5. Open the CNC-ready DXF in AutoCAD 2025.
6. Run AutoCAD OVERKILL manually as a comparison check. It should report little or nothing left to remove on `CUT`.

## Important Non-Goals

Do not use this step to fix CUT offset alignment bugs.

Do not move, rotate, scale, or normalize any geometry.

Do not deduplicate Layer `0`, `FREZ`, `HOLES`, or labels in v1.

Do not try to preserve per-part closed CUT polylines in the CNC-ready output. The original nested DXF remains the topology/audit artifact.

Do not reorder CNC toolpaths in v1.

## Risks

### Tolerance Too Large

Could merge nearby but intentional separate lines.

Mitigation:

- Default to `0.01mm`.
- Make tolerance configurable.
- Report how many spans were removed.
- Keep original file unchanged.

### Tolerance Too Small

Could miss duplicates caused by tiny floating-point drift.

Mitigation:

- Add diagnostics for near-overlaps.
- Test `0.001mm`, `0.01mm`, and `0.05mm` on real exports.

### Partial Overlap Bugs

Naive merge logic can erase or overextend geometry.

Mitigation:

- Use atomic interval decomposition.
- Test partial overlap cases heavily.

### CNC Reader Expectations

The CNC pipeline may prefer polylines or may accept lines equally.

Mitigation:

- Start with `LINE` output because it is explicit and simple.
- Verify with `cnc_pipeline/dxf_reader.py`.
- Add a later optional join step only if needed.

## Suggested Implementation Sequence

1. Add `ezdxf` to backend requirements.
2. Create `cnc_pipeline/cut_overkill.py`.
3. Implement DXF extraction for `LINE`, `POLYLINE`, and `LWPOLYLINE` on `CUT`.
4. Implement point snapping and segment normalization.
5. Implement line grouping.
6. Implement atomic interval decomposition.
7. Emit deduped `CUT` as `LINE` entities.
8. Add CLI entrypoint.
9. Add synthetic pytest coverage.
10. Test against a real nested export.
11. Add CNC pipeline integration only after manual CLI validation.

## Success Criteria

- Original browser-exported DXF remains visually faithful.
- CNC-ready DXF has no exact or partial overlapping `CUT` spans within configured tolerance.
- Non-CUT layers survive the transformation.
- AutoCAD opens the processed DXF.
- CNC pipeline imports the processed DXF.
- The process reports what it changed clearly enough to audit.

