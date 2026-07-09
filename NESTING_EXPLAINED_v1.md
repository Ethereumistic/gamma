# Nesting Feature Explained

## Purpose

Nesting is the second step in the fenestration production workflow:

```text
SHEETS -> NESTING -> CNC PIPELINE -> production
```

It takes flat sheet-metal parts, arranges required quantities onto 1250 x 3200 mm ACM stock sheets, previews the layouts, and exports one DXF per unique sheet layout. Operators then cut each exported layout according to its repeat count.

The core packing flow runs in the browser. Nesting does not currently persist jobs to Convex; it keeps one local `NestJob` in React state.

## Main Files

- `alugamma/src/routes/nesting.tsx`: route layout with toolbar, parts panel, preview canvas, sheet list, and export dialog.
- `alugamma/src/features/nesting/context.tsx`: local job state, part management, packing, selected sheet, and export actions.
- `alugamma/src/features/nesting/types.ts`: `NestPart`, `Placement`, `SheetLayout`, `NestJob`, filename parser, direction-to-rotation mapping, and mode detection.
- `alugamma/src/features/nesting/constants.ts`: sheet dimensions, margins, offsets, tolerances, layers, and colors.
- `alugamma/src/features/nesting/packer.ts`: pure TypeScript MaxRects packing implementation.
- `alugamma/src/features/nesting/dxf-reader.ts`: DXF import, saved sheet-metal design import, and non-CUT Maker.js model extraction.
- `alugamma/src/features/nesting/dxf-writer.ts`: sheet DXF export, labels, layer table handling, CUT polyline emission, ZIP export.
- `alugamma/src/features/nesting/deduplicator.ts`: transforms placed CUT lines into sheet space and removes coincident shared cuts.
- `alugamma/src/features/nesting/line-joiner.ts`: layer-aware joining for CNC-friendly non-CUT line output.
- `alugamma/src/features/nesting/preview-canvas.tsx`: Y-flipped canvas preview that mirrors DXF output.
- `alugamma/src/features/nesting/part-list.tsx` and `sheet-list.tsx`: import/configure parts and review layouts.

## Inputs and Part Model

A `NestPart` represents one part type and a required `count`.

Important fields:

- `name` and `filename`: display/export identity.
- `direction`: `T`, `R`, `B`, `L`, or `null`.
- `count`: number of instances needed.
- `rotationLocked` and `allowedRotation`: whether the packer can rotate the part.
- `l0Width` and `l0Height`: nominal Layer 0 bounding box dimensions.
- `cutWidth` and `cutHeight`: packing footprint, computed as `l0 + 2 * CUT_OFFSET`.
- `cutLines`: CUT geometry in part-local coordinates.
- `dxfContent`: source DXF used to preserve Layer 0, FREZ, HOLES, and custom non-CUT geometry.
- `source`: `sheet-metal` or `custom-dxf`.
- `designId`: Convex design link for sheet-metal sourced parts.

`CUT_OFFSET` is 3 mm. The packer places by CUT footprint, not just nominal Layer 0 size.

## Import Paths

Nesting accepts two real input paths.

Custom DXF import uses `createNestPartFromFile()`. The DXF parser extracts:

- Layer `0` bounds for nominal part size; if missing, it falls back to all parsed entity bounds.
- `CUT` layer segments for the cutting contour.
- Raw DXF content so non-CUT layers can be reinserted into exported sheet layouts.

The parser handles common entity types: `LINE`, `LWPOLYLINE`, `ARC`, `CIRCLE`, `SPLINE`, and `ELLIPSE` for segment extraction. Export model extraction keeps non-CUT `LINE`, `CIRCLE`, `ARC`, and `LWPOLYLINE` geometry, including LWPOLYLINE bulge arcs.

Sheet-metal project import uses `createNestPartFromDesign()`. It regenerates geometry from the saved `SheetMetalModel` by calling `computeSheetMetalGeometry()` and `buildDxf()`. The saved parametric model is the source of truth; no stored DXF file is required.

When importing project designs, the dialog has a "Respect direction" checkbox. If enabled, the part is rotation locked so its arrow points up on the nested sheet. If disabled, the packer can rotate it freely.

## Filename Metadata Contract

Nesting shares the sheet-metal filename convention:

```text
basename_<DIR>_x<count>
```

Examples:

```text
panel_T_x18.dxf
corner_x8.dxf
fascia_R.dxf
```

`parseFilename()` supports:

- `name_DIR_xCount`: explicit direction and count.
- `name_xCount`: count only, direction defaults to `T`.
- `name_DIR`: direction only, count defaults to 1.
- any other name: direction defaults to `T`, count defaults to 1.

Direction maps to the rotation needed to make the arrow point up:

| Direction | Rotation |
| --- | --- |
| `T` | 0 degrees |
| `R` | 90 degrees |
| `B` | 180 degrees |
| `L` | 270 degrees |
| `null` | free rotation |

Keep this contract compatible with sheet-metal export names and project import.

## Packing Behavior

`packAllParts(parts)` expands each part by `count`, sorts instances by area descending, detects a packing mode, runs three MaxRects heuristics, and keeps the result with the fewest sheets.

The three heuristics are:

- `bssf`: best short side fit.
- `baf`: best area fit.
- `blsf`: best long side fit.

Mode detection:

- Mode A uses the standard usable area: `1180 x 3130`, from a 35 mm margin on all sides.
- Mode B uses the full `1250 x 3200` sheet when a part or pair of parts cannot fit inside Mode A constraints.

Mode A layouts use `offsetX = 35`, `offsetY = 35`, alignment `margin`.

Mode B layouts choose alignment per layout:

- `centered` when utilization is at least 70%.
- `bottom-left` when utilization is below 70%, with offsets clamped so geometry stays inside the sheet.

Each generated bin starts with `repeatCount = 1`. After packing, identical layouts are merged by fingerprint and their repeat counts are summed. This gives operators fewer DXF files: one repeated layout can represent many physical sheets.

`validateProduction()` checks final layouts against requested part counts and reports under-production or acceptable over-production warnings.

## Coordinate Spaces

There are three spaces:

- Part-local: CUT and non-CUT geometry relative to the part's Layer 0 origin.
- Packing space: MaxRects placement coordinates inside the selected bin area.
- Sheet space: final DXF coordinates on the physical 1250 x 3200 sheet.

Transforms must stay consistent between:

- `deduplicator.ts`, which transforms CUT segments mathematically.
- `dxf-writer.ts`, which transforms non-CUT Maker.js models.
- `preview-canvas.tsx`, which renders the same placement visually.

The preview flips Y for canvas display. DXF output keeps Y-up sheet coordinates.

## Exported DXF Semantics

`writeNestSheetDxf(layout, parts)` creates a manufacturing sheet DXF.

It writes:

- Sheet boundary and layout guide rectangles on `SHEETS`.
- Per-part non-CUT geometry from source DXF content: Layer `0`, `FREZ`, `FREZ_135`, `HOLES`, and custom layers.
- CUT contours as explicit `LWPOLYLINE` entities when `computeCutPolylines()` can build polylines from transformed part CUT lines.
- Fallback CUT `LINE` entities if polyline reconstruction fails.
- Sheet title above the sheet, part labels centered in each part, and repeat count below the sheet.

Known layer colors are preserved through `constants.ts`. Unknown layers default to orange ACI 30. The writer also ensures known layer table entries exist and injects a `NestLabel` text style.

Export-all creates `nesting_sheets.zip`; each DXF filename is based on:

```text
{sheetNumber}_r{repeat}_{mode}_p{partCount}_u{utilization}.dxf
```

Example:

```text
1_r4_A_p6_u83.dxf
```

## CUT Deduplication and Line Joining

`collectAndDeduplicate()` transforms every placed part's CUT lines into sheet space and merges coincident shared edges within `COINCIDENCE_TOL = 0.01` mm. This prevents the CNC pipeline from cutting the same shared boundary twice.

Non-CUT line joining happens separately in `dxf-writer.ts` through `applyLineJoining()`:

- `SHEETS` and `0`: skipped.
- `FREZ` and `FREZ_135`: orientation-aware joining.
- `HOLES` and custom layers: full collinear joining.

CUT contours are intentionally handled as polylines instead of going through this general line-joining path.

## UI Workflow

Users add parts through drag-and-drop DXF import, file picker, project-design import, or demo parts. They can edit counts, clear the job, run packing, select sheet layouts, inspect warnings, and export all layouts as a ZIP.

Keyboard shortcuts are wired through `hotkeys.tsx`:

- `Cmd/Ctrl+P`: pack.
- `Cmd/Ctrl+E`: open export.
- `Cmd/Ctrl+N`: clear parts/new job.
- `C`: center preview.
- `+` / `-`: zoom.

## Testing Guidance

Run tests from `alugamma/`.

Useful focused tests:

```bash
pnpm vitest run src/features/nesting/packer.test.ts
pnpm vitest run src/features/nesting/line-joiner.test.ts
pnpm vitest run src/features/nesting/dxf-writer.regression.test.ts
pnpm vitest run src/features/nesting/dxf-validation.test.ts
pnpm vitest run src/features/nesting/probe-user-check.test.ts
```

For packing changes, test repeat counts, rotations, Mode A/B selection, and production warnings. For export changes, inspect generated DXF structure, layer names, CUT polylines, labels, and CNC-oriented joining behavior.

## Agent Notes

Preserve these invariants:

- Sheet size remains 1250 x 3200 mm.
- Mode A margin remains 35 mm unless production rules change.
- `CUT`, `FREZ`, `FREZ_135`, `HOLES`, `0`, and `SHEETS` layer names remain stable.
- `CUT_OFFSET` remains aligned with sheet-metal output expectations.
- Filename metadata remains compatible with sheet-metal import/export.
- Rotation transforms match across preview, deduplication, and DXF writing.
- Repeat counts represent how many times to cut a unique exported layout.

When changing import/export geometry, prefer targeted regression tests and inspect at least one generated DXF. Nesting is a bridge between design and machining, so small layer or transform mistakes can create expensive production mistakes.
