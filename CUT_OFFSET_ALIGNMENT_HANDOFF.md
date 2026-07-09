# CUT Offset Alignment Bug in Nesting

## Problem Summary

There is a remaining CUT-layer alignment bug in the Nesting DXF export. This is **not** the earlier double V-notch topology/polyline reconstruction bug from `CUT_LINES_FIX_NESTING.md`; that issue was fixed and pushed. The new issue is that, for some nested sheet-metal parts, the green `CUT` contour is translated or aligned incorrectly relative to the white Layer `0` source contour.

Expected behavior:

- The green `CUT` outline must be the original sheet-metal Layer `0` outline offset outward by exactly `3mm` everywhere.
- In a nested export, Layer `0`, `FREZ`, `HOLES`, labels, and the green `CUT` contour should all transform into sheet space with the same rotation/placement basis.
- The distance from Layer `0` to `CUT` should remain exactly `3mm` on all corresponding edges after nesting.

Actual behavior:

- In the failing nested DXF, parts of the green `CUT` contour are shifted relative to the white Layer `0` geometry.
- In the supplied screenshot:
  - Some locations appear to have about `6mm` offset.
  - Some locations appear correctly offset by `3mm`.
  - On the right side, the green `CUT` line appears to overlap the white Layer `0` line, giving effectively `0mm` offset.
- This suggests a transform, bbox origin, normalization, or rotation-anchor mismatch, rather than a CUT contour generation problem in Sheet Metal.

## Provided Reproduction Assets

Failing nested DXF:

```text
C:/Users/badja/Documents/Projects Dealiante/PROJECTS/Ivan_Burgas/0606DURVO/4_JULY/TESTING/test-bug-wrong-offset.dxf
```

Screenshot showing the offset problem:

```text
C:/Users/badja/AppData/Local/Temp/codex-clipboard-62eae08c-04b0-44c9-906e-c818da6208bc.png
```

In the screenshot:

- White = Layer `0`, the nominal sheet-metal design contour.
- Green = Layer `CUT`, expected to be a uniform outward `3mm` offset from Layer `0`.
- Magenta/cyan lines appear to be other nesting/export layers or nearby geometry.
- The green V/edge geometry is visibly not a uniform offset from the white geometry.

## Important Recent Context

The previous critical CUT-line fixes already landed:

1. Nesting no longer lets same-part CUT deduplication corrupt V-notch contours.
2. Nesting export preserves ordered CUT topology for the double V-notch case.
3. Nesting emits AutoCAD-compatible classic `POLYLINE`/`VERTEX`/`SEQEND` instead of `LWPOLYLINE`.
4. Nesting DXF reader now parses classic `POLYLINE`/`VERTEX`/`SEQEND`.

Do **not** revert those changes. This new bug is about **CUT vs Layer 0 alignment**, not contour ordering or AutoCAD validity.

## Likely Failure Area

The highest-risk area is a mismatch between how non-CUT geometry and CUT geometry are transformed into sheet space.

Relevant files:

```text
alugamma/src/features/nesting/dxf-reader.ts
alugamma/src/features/nesting/dxf-writer.ts
alugamma/src/features/nesting/deduplicator.ts
alugamma/src/features/nesting/preview-canvas.tsx
alugamma/src/features/nesting/types.ts
alugamma/src/features/nesting/constants.ts
alugamma/src/features/sheet-metal/geometry.ts
alugamma/src/features/sheet-metal/dxf.ts
```

Key constants and assumptions:

```ts
// alugamma/src/features/nesting/constants.ts
export const CUT_OFFSET = 3;
```

Potential mismatch to audit:

```text
Non-CUT model path:
  extractDxfModel(part.dxfContent)
  -> makerjs.model.moveRelative(instance, [-part.l0Bbox.x0, -part.l0Bbox.y0])
  -> rotate around origin
  -> move by CUT_OFFSET alignment
  -> move to packX/packY + layout offset

CUT path:
  part.cutLines
  -> getCutInsertPosition(...)
  -> transformCutSegment(...)
  -> emit POLYLINE
```

If `part.cutLines` are already normalized differently from the non-CUT Maker.js model, or if `part.l0Bbox` is computed from the wrong bounds, then the two paths can disagree by exactly one `CUT_OFFSET` or two `CUT_OFFSET`s. That matches the observed `0mm / 3mm / 6mm` symptoms.

## Suspected Root Causes

Investigate these in order:

### 1. Custom DXF Import Normalizes CUT Against the Wrong Bbox

`parseDxfContent()` computes `l0Bbox` from Layer `0` entities and then normalizes CUT lines:

```ts
const localCutLines = cutLines.map((seg) => ({
  x1: seg.x1 - l0Bbox!.x0,
  y1: seg.y1 - l0Bbox!.y0,
  x2: seg.x2 - l0Bbox!.x0,
  y2: seg.y2 - l0Bbox!.y0,
}));
```

This is correct only if:

- `l0Bbox` is truly the nominal Layer `0` bbox.
- The non-CUT model is later normalized with the same exact `l0Bbox`.
- The CUT coordinates from the input are in the same coordinate frame as Layer `0`.

If the imported DXF has text, labels, arrows, sheet frames, or nested sheet entities on Layer `0`, `l0Bbox` may become too large or shifted. Then CUT and non-CUT geometry will be normalized inconsistently.

### 2. Sheet-Metal Project Import May Use Different Local Origins Than DXF Import

`createNestPartFromDesign()` sets:

```ts
l0Width = geometry.totalWidth - 2 * offsetCut;
l0Height = geometry.totalHeight - 2 * offsetCut;
l0Bbox = { x0: 0, y0: 0, x1: l0Width, y1: l0Height };
cutLines = geometry.shapes.filter((s) => s.layer === "CUT")
```

But Sheet Metal geometry can include negative CUT coordinates because the CUT line is offset outward by `offsetCut`. Verify whether `cutLines` are in:

```text
Layer 0 local origin coordinates
```

or:

```text
Geometry total bounds / offset bounds coordinates
```

If this assumption is wrong for some part shapes, Nesting may add `CUT_OFFSET` again, producing a `6mm` offset on one side and `0mm` on the opposite side.

### 3. CUT Insert Position May Double-Apply the Offset

In `dxf-writer.ts`, CUT is transformed with:

```ts
const { insertX, insertY } = getCutInsertPosition(placement, part, layout);
const transformed = part.cutLines.map((seg) =>
  transformCutSegment(seg, insertX, insertY, placement.rotation),
);
```

For rotation `0`, `getCutInsertPosition()` currently returns:

```ts
insertX = placement.packX + layout.offsetX + CUT_OFFSET;
insertY = placement.packY + layout.offsetY + CUT_OFFSET;
```

This assumes local CUT lines are centered around the Layer `0` local origin and include coordinates like `-3` on left/bottom and `width + 3` on right/top. If `cutLines` were already shifted to a CUT bbox origin, adding `CUT_OFFSET` can shift them incorrectly.

Check whether failing parts have `part.cutLines` min/max values like:

```text
Expected project-import local CUT bbox:
  minX = -3
  minY = -3
  maxX = l0Width + 3
  maxY = l0Height + 3
```

or instead:

```text
Suspicious custom/imported local CUT bbox:
  minX = 0
  minY = 0
  maxX = l0Width + 6
  maxY = l0Height + 6
```

Those two coordinate systems require different insert positions.

### 4. Non-CUT Model and CUT Lines May Use Different Normalization

Non-CUT geometry is moved by:

```ts
makerjs.model.moveRelative(instance, [-part.l0Bbox.x0, -part.l0Bbox.y0]);
makerjs.model.moveRelative(instance, [CUT_OFFSET, CUT_OFFSET]);
makerjs.model.moveRelative(instance, [placement.packX + layout.offsetX, placement.packY + layout.offsetY]);
```

CUT geometry is moved by:

```ts
insertX = placement.packX + layout.offsetX + CUT_OFFSET;
insertY = placement.packY + layout.offsetY + CUT_OFFSET;
```

These should be equivalent only if both CUT and non-CUT coordinates are relative to the same `part.l0Bbox` origin. Compare the final transformed Layer `0` vertices and CUT vertices from the failing file.

## Suggested Debug Plan

Use the supplied DXF and dump:

```text
Layer 0 bbox
CUT bbox
FREZ bbox
HOLES bbox
part.l0Bbox
part.l0Width / part.l0Height
part.cutWidth / part.cutHeight
local cutLines min/max before transform
non-CUT model path bounds before/after normalization
transformed Layer 0 vertices
transformed CUT vertices
```

For the failing screenshot area, measure distance from each Layer `0` segment to the corresponding CUT segment. The result should be `3mm`; currently it appears to vary between `0mm`, `3mm`, and `6mm`.

Recommended quick diagnostic script:

```ts
import { parseDxfContent, extractDxfModel } from "@/features/nesting/dxf-reader";
import { writeNestSheetDxf } from "@/features/nesting/dxf-writer";
```

Then:

1. Parse `test-bug-wrong-offset.dxf`.
2. Extract Layer `0` and CUT entities separately.
3. Compute bboxes by layer.
4. Identify corresponding horizontal/vertical/diagonal Layer `0` and CUT segments.
5. Print signed offsets and min/max differences.

## Acceptance Criteria

- In the provided failing DXF, the green `CUT` contour is uniformly `3mm` outward from the white Layer `0` contour.
- No side of the contour has `0mm` offset.
- No side of the contour has `6mm` offset unless the source sheet-metal design intentionally contains that geometry, which is not expected here.
- The fix works for both:
  - Sheet Metal project import into Nesting.
  - Custom DXF import into Nesting.
- Existing double V-notch topology fix remains intact.
- AutoCAD 2025 can still open the exported nested DXF.
- CNC Pipeline can still import the exported nested DXF correctly.

## Tests to Add or Update

Add a focused regression test in:

```text
alugamma/src/features/nesting/dxf-writer.regression.test.ts
```

Suggested test shape:

1. Build or import a part with a known Layer `0` contour and expected `CUT_OFFSET = 3`.
2. Run it through the exact Nesting writer path.
3. Parse the exported DXF.
4. Assert that transformed CUT and transformed Layer `0` are separated by exactly `3mm` on representative edges.

Also add a custom-DXF import regression if the failing file reveals that `parseDxfContent()` is computing `l0Bbox` from the wrong entities.

Run:

```bash
cd alugamma
pnpm dlx vitest run src/features/nesting/dxf-writer.regression.test.ts
pnpm dlx vitest run src/features/nesting/dxf-validation.test.ts
pnpm dlx vitest run src/features/nesting/line-joiner.test.ts
pnpm dlx vitest run src/features/nesting/packer.test.ts
pnpm build
```

If the fix touches shared Sheet Metal geometry:

```bash
pnpm dlx vitest run src/features/sheet-metal/geometry/polylines.test.ts
pnpm dlx vitest run src/features/sheet-metal/dxf-golden.test.ts
```

## Notes for the Next Agent

Be careful not to “fix” this by changing Sheet Metal offset generation unless you prove the standalone Sheet Metal DXF is wrong. The symptom appears after Nesting/export, and other nested designs are correct, so the bug is probably conditional on coordinate origin, Layer `0` bbox, rotation, or import path.

The most likely successful fix is to make Nesting store enough metadata to know which coordinate frame `cutLines` are in:

```text
Layer0-origin local coordinates
vs
CUT-bbox-origin local coordinates
```

Then make `getCutInsertPosition()` / `transformCutSegment()` use that coordinate frame consistently with the non-CUT model transform.

Do not reintroduce `LWPOLYLINE` for CUT export unless the DXF header/tables are upgraded completely. The current AutoCAD-compatible export should remain classic `POLYLINE`/`VERTEX`/`SEQEND`.
