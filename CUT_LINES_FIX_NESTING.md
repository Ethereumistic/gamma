# CUT Lines Fix in Nesting

## Problem Summary

There is a CUT-line geometry regression in the nesting feature. A sheet-metal design with double V-notch reliefs renders correctly in the Sheet Metal editor and exports correctly as a standalone sheet-metal DXF, but the same part becomes malformed after entering the Nesting feature.

Known failing formula:

```text
875x1790 W F10 Q E F90 Q E A F25 F20 S F308 Q E D F20
```

Expected behavior: the double V-notch relief should remain a continuous, correctly offset green `CUT` contour around the notch, matching the Sheet Metal preview/export.

Actual behavior in Nesting: the notch CUT contour is redrawn incorrectly. The V-notch area shows broken/misaligned green segments and the nested preview/export no longer matches the Sheet Metal DXF.

This happens through both nesting import paths:

- Importing the saved design from the Sheet Metal project.
- Exporting the same sheet-metal DXF, then importing it as a custom DXF into Nesting.

That strongly suggests the Sheet Metal geometry generator is not the culprit. The problematic area is likely Nesting's CUT extraction, coordinate normalization, transformation, deduplication, or polyline reconstruction.

## Visual Reference

Expected Sheet Metal rendering/export:

```text
C:/Users/badja/AppData/Local/Temp/codex-clipboard-7bba80b2-dc75-4aa1-a7e3-62b73c7f5d91.png
```

Broken Nesting rendering:

```text
C:/Users/badja/AppData/Local/Temp/codex-clipboard-d3ab5f33-811a-42b0-a007-a96249642a82.png
```

In the expected image, the green CUT contour follows the entire double V-notch relief. In the broken image, the notch contour appears partially disconnected/reinterpreted, with incorrect vertical and diagonal CUT segments.

## Relevant Feature Context

Workflow:

```text
SHEETS -> NESTING -> CNC PIPELINE
```

Sheet Metal creates the part geometry and exports DXF layers:

- `CUT`: actual cutting contour.
- `FREZ`: bend/groove lines.
- `HOLES`: optional marks.
- `0`: nominal/reference layer, text, arrows.

Nesting imports the part, packs it onto 1250 x 3200 mm sheets, and exports nested sheet DXFs for CNC. Nesting must preserve the `CUT` contour exactly, except for placement/rotation into sheet space and intentional shared-edge deduplication.

## Key Files to Inspect

Sheet Metal source of truth:

- `alugamma/src/features/sheet-metal/geometry.ts`
- `alugamma/src/features/sheet-metal/dxf.ts`
- `SHEET_METAL_EXPLAINED_v1.md`

Nesting import/export path:

- `alugamma/src/features/nesting/dxf-reader.ts`
- `alugamma/src/features/nesting/deduplicator.ts`
- `alugamma/src/features/nesting/dxf-writer.ts`
- `alugamma/src/features/nesting/preview-canvas.tsx`
- `alugamma/src/features/nesting/types.ts`
- `NESTING_EXPLAINED_v1.md`

Shared helper currently used by both features:

- `alugamma/src/features/sheet-metal/geometry/polylines.ts`

Existing tests to extend:

- `alugamma/src/features/nesting/dxf-writer.regression.test.ts`
- `alugamma/src/features/nesting/dxf-validation.test.ts`
- `alugamma/src/features/nesting/line-joiner.test.ts`
- `alugamma/src/features/sheet-metal/dxf-golden.test.ts`

## Suspected Failure Points

### 1. Custom DXF Import CUT Parsing

`dxf-reader.ts` parses imported DXF content and extracts `CUT` segments from entities.

Check `parseDxfContent()` and `extractSegmentsFromEntity()`.

The Sheet Metal DXF may export the CUT contour as many `LINE` entities or as geometry with a particular ordering. Nesting only stores `cutLines` as unordered segments. If notch segments are later stitched incorrectly, the parser may not preserve enough contour intent.

Important: because the bug also occurs when importing a generated custom DXF, the parser path must be tested directly.

### 2. Sheet Metal Project Import CUT Extraction

`createNestPartFromDesign()` regenerates sheet-metal geometry and extracts:

```ts
geometry.shapes.filter((s) => s.layer === "CUT")
```

These segments are passed into Nesting as `cutLines`. Since the standalone Sheet Metal DXF is correct, compare these extracted `cutLines` against the original `geometry.shapes` before any nesting transform. If they already differ, the problem is in this bridge. If they match, continue downstream.

### 3. CUT Transform Into Sheet Space

Nesting transforms local CUT segments in:

- `deduplicator.ts` via `computeInsertPosition()` and `transformCutSegment()`.
- `dxf-writer.ts` via similar `getCutInsertPosition()` and `transformCutSegment()`.

The math must match the non-CUT Maker.js model transform used for preview/export:

```text
normalize -> rotate/align by CUT_OFFSET -> translate to packX + offsetX, packY + offsetY
```

For the failing design, first test rotation `0`. If the bug appears without rotation, the issue is not direction rotation. If it only appears after `R/B/L` imports, inspect 90/180/270 insert offsets.

### 4. CUT Deduplication

`collectAndDeduplicate()` merges coincident CUT segments. It is intended to remove duplicate shared edges between adjacent nested parts.

For a single part on a sheet, deduplication should not alter notch geometry except removing exact duplicates. Check whether the double V-notch contains overlapping or touching segments that `deduplicateCutSegments()` incorrectly merges into longer vertical/horizontal pieces.

Diagnostic: temporarily compare preview/export with raw transformed CUT segments versus deduplicated segments for one failing placement.

### 5. CUT Polyline Reconstruction

`dxf-writer.ts` currently emits CUT contours as `LWPOLYLINE` entities when possible:

```ts
computeCutPolylines(transformed)
emitCutPolylineDxf(...)
```

The helper comes from:

```ts
alugamma/src/features/sheet-metal/geometry/polylines.ts
```

This may be the highest-risk area. The double V-notch contour contains close, adjacent, and intersecting-looking relief geometry. If `computeCutPolylines()` walks an unordered endpoint graph incorrectly, it may connect the wrong branches at the double notch.

Diagnostic: for the failing design, dump the transformed CUT segments around the notch and the resulting `Polyline.points`. Verify whether the polyline walker chooses the wrong path at vertices with degree greater than 2 or near-coincident points.

Important: preview currently draws deduplicated CUT lines, while export emits polylines per placement when possible. If the preview is already broken, inspect whether preview is drawing `collectAndDeduplicate()` output. If exported nested DXF is also broken, inspect both dedup and polyline output.

## Reproduction Plan

1. In Sheet Metal, create a design from:

   ```text
   875x1790 W F10 Q E F90 Q E A F25 F20 S F308 Q E D F20
   ```

2. Verify the Sheet Metal preview and standalone DXF show the correct double V-notch.

3. Import the saved design into Nesting with a single count and no neighboring parts.

4. Run packing.

5. Observe the broken CUT contour in the Nesting preview.

6. Export the nested DXF and inspect the `CUT` layer in CAD or with a parser.

7. Repeat by importing the standalone Sheet Metal DXF as a custom DXF. The same breakage should occur.

## Suggested Debug Instrumentation

Add a temporary focused test or debug helper that captures these stages for the failing design:

```text
sheetMetalGeometry.shapes where layer === CUT
createNestPartFromDesign(...).cutLines
collectAndDeduplicate(...) raw transformed segments before dedup
collectAndDeduplicate(...) final deduped segments
computeCutPolylines(transformed).points
final emitted CUT entities in writeNestSheetDxf()
```

Compare segment counts, bounding boxes, and endpoint connectivity at each stage.

For endpoint graph debugging, compute vertex degrees after snapping with the current polyline tolerance. Double V-notch areas may create vertices where a naive graph walk has multiple valid next edges. Those must not be arbitrarily connected.

## Likely Fix Direction

Prefer preserving the original CUT contour topology over reconstructing it later from unordered segments.

Potential fixes, in order of preference:

1. Preserve ordered CUT contours from Sheet Metal into Nesting if possible.
2. Improve `computeCutPolylines()` so it handles branching or degree-greater-than-2 vertices deterministically without crossing to the wrong notch edge.
3. Make Nesting export CUT as transformed original segments for problematic contours instead of forcing polyline reconstruction.
4. Ensure deduplication does not merge non-shared notch segments within the same part. Dedup may need to run only across different placements, not within one placement, or use stricter checks.

Do not fix this by changing Sheet Metal V-notch generation unless a direct mismatch is proven before Nesting import.

## Acceptance Criteria

- The failing formula's double V-notch looks identical in:
  - Sheet Metal preview.
  - Sheet Metal standalone DXF.
  - Nesting preview after project import.
  - Nesting preview after custom DXF import.
  - Nesting exported sheet DXF.
- Single-part nesting must not change the part's CUT contour.
- Multi-part nesting still deduplicates true shared CUT edges.
- `FREZ`, `HOLES`, `0`, and custom non-CUT layers remain preserved in nested export.
- Existing nesting tests pass.
- Add or update a regression test that specifically protects the double V-notch case.

## Commands

Run from `alugamma/`:

```bash
pnpm vitest run src/features/nesting/dxf-writer.regression.test.ts
pnpm vitest run src/features/nesting/dxf-validation.test.ts
pnpm vitest run src/features/nesting/line-joiner.test.ts
pnpm vitest run src/features/nesting/packer.test.ts
```

If touching shared sheet-metal polyline code, also run:

```bash
pnpm vitest run src/features/sheet-metal/geometry/polylines.test.ts
pnpm vitest run src/features/sheet-metal/dxf-golden.test.ts
```

## Notes for the Fixing Agent

This is a production geometry bug, not a cosmetic canvas issue. The nested DXF must preserve the manufacturing CUT contour. Be suspicious of any code that converts ordered part geometry into unordered segments and later attempts to infer contour order. The failing double V-notch is likely exposing an ambiguity in segment joining, deduplication, or graph walking.
