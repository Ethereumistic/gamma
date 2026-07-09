# Sheet Metal Feature Explained

## Purpose

The sheet metal feature is the first step in the internal fenestration workflow:

```text
SHEETS -> NESTING -> CNC PIPELINE -> production
```

It lets users define ACM sheet-metal parts as 2D flat patterns, preview them, save them to a project, and export DXF files. Those DXF files are later imported into nesting, then into the CNC pipeline to produce `.nc` machining programs.

This is not a 3D unfolding system. The user describes a rectangular base panel plus flanges, bend/groove lines, reliefs, flaps, and hole markings. The app directly generates the 2D manufacturing geometry.

## Main Files

- `alugamma/src/routes/sheet-metal.tsx`: page layout. The center is the preview canvas; editors for top/right/bottom/left surround it.
- `alugamma/src/features/sheet-metal/context.tsx`: feature state, save/load/export actions, design-name metadata, undo, project defaults.
- `alugamma/src/features/sheet-metal/types.ts`: model shape and normalization for saved designs.
- `alugamma/src/features/sheet-metal/geometry.ts`: main geometry computation and public `computeSheetMetalGeometry` API.
- `alugamma/src/features/sheet-metal/geometry/`: extracted geometry helpers for math, edges, notches, holes, trimming, regions, joining, and polylines.
- `alugamma/src/features/sheet-metal/dxf.ts`: serializes computed line shapes to DXF with Maker.js.
- `alugamma/src/features/sheet-metal/preview-canvas.tsx`: renders the same geometry interactively in the browser.
- `alugamma/src/features/sheet-metal/side-editor.tsx`: side-specific controls for flanges, FREZ, inner FREZ, holes, reliefs, and flaps.

## Core Domain Model

The source of truth is `SheetMetalModel` in `types.ts`.

The model has:

- `baseWidth` and `baseHeight`: the central panel dimensions in millimeters.
- `offsetCut`: outward compensation for the exported CUT contour, usually 3 mm.
- `invertX` and `invertY`: mirror the generated geometry before export.
- `includeName`, `includeArrow`, `arrowDirection`: metadata drawn on DXF layer `0`.
- `metadataCount`: quantity used with the filename suffix convention.
- `sides`: four `SideConfig` objects: `top`, `right`, `bottom`, `left`.
- `cornerReliefs`: legacy corner flags still normalized for compatibility.
- `rubberband`: UI/model flag retained in the saved model.

Each side can contain:

- `flanges`: outward material bands that will be bent. Their cumulative amounts define the outward depth of that side.
- `frezLines`: additional bend/groove lines, either `inner` or `outer` depending on `frezMode`.
- `innerFrezLines`: bend/groove lines inside the base panel. They can optionally span into adjacent flange areas.

Feature-level options:

- Flanges support `reliefs.start/end` for V-notch reliefs, `flaps.start/end` for diagonal flap FREZ lines, and optional hole marks.
- FREZ and inner FREZ lines support `notches.start/end`; inner FREZ also supports `spanStart/spanEnd`.
- Holes are not circular geometry. They are short line markings on the `HOLES` layer with placement, orientation, offsets, and line enable toggles.

## Geometry Output

`computeSheetMetalGeometry(model)` returns a `GeometryResult`:

- `shapes`: line primitives with layer names.
- `baseRect`: the true central panel rectangle.
- `bounds`: full generated part bounds.
- `totalWidth` and `totalHeight`: exported flat-pattern size.
- `flangeDepths`: total flange depth per side.
- `frezOffsets`: cumulative outer/inner FREZ offsets.
- `warnings`: validation messages shown in the editor.

The important DXF layers are:

| Layer | Meaning |
| --- | --- |
| `CUT` | Actual outside contour sent downstream for cutting |
| `FREZ` | Bend/groove machining lines |
| `HOLES` | Optional hole/marking guide lines |
| `0` | Reference geometry, labels, and direction arrow |

Downstream nesting and CNC code depend on these layer names. Do not rename them casually.

## Geometry Rules That Matter

Coordinates use millimeters and a Cartesian Y-up model. The canvas adapts this for display; the DXF export keeps the geometry coordinates.

The base rectangle is shifted inward by left and bottom flange depths so that outward flanges can be represented in positive part-local coordinates. Top and right flanges extend toward increasing coordinates; bottom and left flanges extend toward decreasing directions from the base edge before final bounds are calculated.

The engine emits line segments, not arbitrary CAD entities. CUT, FREZ, and HOLES are all represented as `LineShape` values. `dxf.ts` converts them into Maker.js line paths.

V-notch reliefs are generated from flange reliefs and FREZ notch flags. FREZ and flap lines are trimmed so they do not continue through notch voids. Some of this trimming is still an ad-hoc midpoint/critical-point system in `geometry/trim.ts`; comments there mark it as temporary.

When `offsetCut > 0`, the public geometry API performs a zero-offset pass first. FREZ, HOLES, and nominal reference CUT geometry come from that zero-offset pass. The final `CUT` layer is then produced by offsetting the zero CUT contour with `clipper-lib` through `computeCutPolylines`; if that fails to produce a closed contour, the code falls back to the older direct offset computation.

This means agents changing CUT generation must check both:

- the nominal zero layer and bend-line positions
- the offset CUT contour used by nesting/CNC

## Save, Export, and Filename Metadata

Designs are saved through Convex from `context.tsx` using the selected workspace project. The saved model is normalized before persistence to keep old designs compatible.

The design name is the practical source of truth for direction and quantity. The suffix convention is:

```text
basename_<DIR>_x<count>
```

Example:

```text
panel-7_T_x18.dxf
```

`T`, `R`, `B`, and `L` map to `top`, `right`, `bottom`, and `left`. This same convention is parsed by nesting, so keep filename changes compatible with `parseFilename` in the nesting feature.

Exporting a DXF also saves the design and marks it exported. `buildDxf` writes:

- layer-colored geometry
- optional centered name text on layer `0`
- optional direction arrow on layer `0`

## UI Workflow

The editor is spatial: the top, right, bottom, and left side editors surround the live preview. Users select a project, create or load a design, set base dimensions, add side features, preview warnings, save, and export DXF.

Side controls mutate the shared model through `useSheetMetal`. The preview always renders `computeSheetMetalGeometry(model)`, so UI changes are immediately reflected in the output.

Project defaults can override new design dimensions and common flange/FREZ presets. When adding flanges or FREZ lines, the context tries to apply project presets while preserving user-customized values.

## Testing Guidance

Run frontend tests from `alugamma/`.

Useful focused tests:

```bash
pnpm vitest run src/features/sheet-metal/geometry/math.test.ts
pnpm vitest run src/features/sheet-metal/geometry/polylines.test.ts
pnpm vitest run src/features/sheet-metal/geometry/trim-bug.test.ts
pnpm vitest run src/features/sheet-metal/dxf-golden.test.ts
```

For geometry work, prefer adding focused tests beside the helper being changed. For export changes, run golden DXF tests. Update golden fixtures only when the DXF change is intentional and review the generated file before committing.

## Agent Notes

Preserve manufacturing semantics over visual appearance. A pretty preview is not enough; the generated DXF layers must remain useful for nesting and CNC.

Be careful with:

- layer names and colors
- closed CUT contours
- zero-offset versus offset geometry
- design-name direction/count suffixes
- saved-model normalization for older designs
- side orientation differences between top/right/bottom/left

Before large refactors, inspect the current tests and fixture DXFs. This feature has accumulated production edge cases around V-notches, flaps, line trimming, golden DXF output, and nested-sheet compatibility.
