# HOLES Functionality — Implementation Plan

## Objective

Add a "drainage holes" feature to the sheet metal tool. When a user selects any flange (Fn) or inner frez line (Zn) and presses **H**, two hole-lines are rendered on a new **HOLES** DXF layer (yellow-500 / color 2) using the current holes settings. The holes are short line segments (or effectively circular holes when length ≈ 0.001mm). Settings for holes are stored as project defaults and are configurable from the existing Settings dialog.

---

## Architecture Overview

### How the existing features work (reference for implementer)

| Concept | Where it lives | Pattern |
|---|---|---|
| **Type definition** | `types.ts` — e.g. `FlangeMeasurement`, `FrezMeasurement` | Type + `create*()` factory + `normalize*()` |
| **Model field** | `SheetMetalModel.sides[side].flanges[]` / `.innerFrezLines[]` | Array on `SideConfig` |
| **Context actions** | `context.tsx` — `addFlange()`, `updateFlange()`, `removeFlange()` | `patchSide()` helper mutates one side |
| **Geometry rendering** | `geometry.ts` — `_computeSheetMetalGeometry()` | Reads model, emits `LineShape[]` with layer `"CUT"` / `"FREZ"` |
| **DXF export** | `dxf.ts` — `buildDxf()` | Iterates `geometry.shapes`, assigns `line.layer` |
| **Canvas preview** | `preview-canvas.tsx` | Draws all shapes; colors by layer |
| **Hotkey** | `hotkeys.tsx` | `useHotkey("F", ...)` calls context action |
| **UI chip** | `side-editor.tsx` — `FlangeChip` / `InnerFrezChip` | Inline editor per feature |
| **Project defaults** | `workspace/context.tsx` → `ProjectSummary.defaults` + `export-settings-dialog.tsx` | Saved via `updateProjectDefaults` Convex mutation |

The HOLES feature follows this exact pattern but with one key difference: **holes data is stored per-feature (on each flange/inner-frez), not as a separate array on the side**. Each flange or inner frez line can independently have holes attached to it.

---

## Data Model Design

### New types to add in `types.ts`

```
HoleSettings (project-level defaults):
  - placement: "inner" | "outer"
  - orientation: "horizontal" | "vertical"
  - sideOffset: number    (mm, from the sides along the hole-line axis)
  - endOffset: number     (mm, from the INNER or OUTER edge)
  - length: number        (mm, length of each hole line; ~0 = circular)

HoleData (per-feature, attached to flange or inner frez):
  - enabled: boolean
  - placement: "inner" | "outer"
  - orientation: "horizontal" | "vertical"
  - sideOffset: number
  - endOffset: number
  - length: number
```

### Where HoleData is stored

**On each `FlangeMeasurement` and `FrezMeasurement`**, as an optional `holes?: HoleData` field. This way:
- When a user presses H with F2 selected, `model.sides[side].flanges[1].holes` gets set
- When they press H with Z3 selected, `model.sides[side].innerFrezLines[2].holes` gets set
- Each feature independently tracks its own holes

### Why this approach

- No new arrays on `SideConfig` — avoids index-synchronization bugs
- Holes are semantically "attached to" a specific flange/frez — the data model reflects this
- Undo/history (already tracking the whole model) works automatically
- Serialization/persistence works automatically (holes are part of the saved model)
- Normalization and backward-compat: old models without `holes` field just have `undefined` (treated as no holes)

---

## Geometry Algorithm

### Coordinate system recap

The geometry engine uses Cartesian coordinates:
- `x0, y0` = bottom-left of base rectangle
- `x1, y1` = top-right of base rectangle
- Flanges extend outward from base rect edges

### Computing hole positions for a given feature

Given a selected flange or inner frez on a side, the algorithm:

1. **Determine the flange region** — the rectangular area of that flange/frez:
   - For a top-side flange at cumulative offset `foldY` with depth `amount`:
     - Region: `x0..x1` horizontally, `foldY..foldY+amount` vertically
   - For a left-side flange at cumulative offset `foldX` with depth `amount`:
     - Region: `foldX-amount..foldX` horizontally, `y0..y1` vertically
   - (Similar for right, bottom, and inner frez lines)

2. **Determine hole-line orientation** based on side + orientation setting:
   - The `orientation` setting ("horizontal"/"vertical") is **relative to the side**:
     - For top/bottom sides: "horizontal" = lines along X axis, "vertical" = lines along Y axis
     - For left/right sides: "horizontal" = lines along Y axis (rotated), "vertical" = lines along X axis (rotated)
   - This matches the requirement document: LEFT side + HORIZONTAL setting = vertical lines in world coords

3. **Compute the two hole-line positions** using sideOffset and endOffset:
   - `sideOffset` is measured **along the flange edge** (perpendicular to the hole lines)
   - `endOffset` is measured **perpendicular to the flange edge** (along the hole lines)
   - For "outer" placement: endOffset is measured from the outer edge of the flange
   - For "inner" placement: endOffset is measured from the inner edge (base rect side)
   - The two lines are placed symmetrically: one at `sideOffset` from one end, one at `sideOffset` from the other end

4. **Emit two `LineShape` objects** with `layer: "HOLES"` and the computed coordinates

### Detailed position math for each side

**TOP side, flange at foldY, depth D:**
- Flange region: `x=[x0, x1]`, `y=[foldY, foldY+D]`
- HORIZONTAL orientation (lines along X):
  - Lines are horizontal, placed at two Y positions
  - Y positions: `foldY + endOffset` (inner) or `foldY + D - endOffset` (outer)
  - Each line: from `x0 + sideOffset` to `x1 - sideOffset` at that Y
  - Line length = `baseWidth - 2*sideOffset` (clamped to `length` parameter if < baseWidth)
- VERTICAL orientation (lines along Y):
  - Lines are vertical, placed at two X positions
  - X positions: `x0 + sideOffset` and `x1 - sideOffset`
  - Each line starts at `foldY + endOffset` (inner) or `foldY + D - endOffset` (outer), length = `length` param

**BOTTOM side** — mirror of top (Y axis inverted)

**LEFT side, flange at foldX, depth D:**
- Flange region: `x=[foldX-D, foldX]`, `y=[y0, y1]`
- HORIZONTAL setting → lines along Y (vertical in world):
  - Lines are vertical, placed at two X positions
  - X positions: `foldX - D + endOffset` (inner) or `foldX - endOffset` (outer)
  - Each line: from `y0 + sideOffset` to `y1 - sideOffset`
- VERTICAL setting → lines along X (horizontal in world):
  - Lines are horizontal, placed at two Y positions
  - Y positions: `y0 + sideOffset` and `y1 - sideOffset`
  - Each line starts at `foldX - D + endOffset` (inner) or `foldX - endOffset` (outer), length = `length` param

**RIGHT side** — mirror of left

### Key insight from the requirement doc

> "the SIDE and END offsets are ALWAYS measured based on the orientation of the HOLES lines themselves, not the orientation of the horizontal or vertical option"

This means:
- `sideOffset` = distance from the **ends of the hole line** (along the hole-line direction)
- `endOffset` = distance from the **INNER or OUTER edge** (perpendicular to the hole-line direction)

So for a horizontal hole line on the top side:
- `sideOffset` pushes the line endpoints inward from left/right edges (along X)
- `endOffset` positions the line at a distance from the inner or outer edge (along Y)

---

## Implementation Plan

### Phase 1: Types & Data Model (`types.ts`)

- [ ] **1.1** Add `HoleSettings` type with fields: `placement`, `orientation`, `sideOffset`, `endOffset`, `length`
- [ ] **1.2** Add `HoleData` type (same shape as `HoleSettings` + `enabled: boolean`)
- [ ] **1.3** Add optional `holes?: HoleData` field to `FlangeMeasurement` type
- [ ] **1.4** Add optional `holes?: HoleData` field to `FrezMeasurement` type (for inner frez lines)
- [ ] **1.5** Add `createDefaultHoleSettings(): HoleSettings` factory function with sensible defaults (inner, horizontal, 25, 25, 25)
- [ ] **1.6** Add `normalizeHoleData(value: unknown): HoleData | undefined` normalizer for backward compat
- [ ] **1.7** Update `normalizeFlangeMeasurement()` to normalize the new `holes` field
- [ ] **1.8** Update `normalizeFrezMeasurement()` to normalize the new `holes` field
- [ ] **1.9** Add `"HOLES"` to the `Layer` union type: `type Layer = "CUT" | "FREZ" | "0" | "HOLES"`

### Phase 2: Context Actions (`context.tsx`)

- [ ] **2.1** Add `toggleHoles(side: SideKey, featureKind: "flange" | "innerFrez", index: number, settings: HoleSettings)` to context type and implementation
  - When called, sets `holes` on the target feature with `enabled: true` and the provided settings
  - If holes already enabled on that feature, toggles it off (sets `enabled: false`)
- [ ] **2.2** Add `removeHoles(side: SideKey, featureKind: "flange" | "innerFrez", index: number)` — deletes the holes field entirely
- [ ] **2.3** Expose `toggleHoles` and `removeHoles` in the context provider value

### Phase 3: Geometry Engine (`geometry.ts`)

- [ ] **3.1** Create a helper function `addHoleLines(shapes, holeData, flangeRegion, side)` that:
  - Takes the `HoleData`, the flange region coordinates, and the side key
  - Computes the two hole-line positions per the algorithm above
  - Emits `LineShape` objects with `layer: "HOLES"`
- [ ] **3.2** In `_computeSheetMetalGeometry()`, after the existing flange/frez rendering loops:
  - Iterate all flanges on all sides; if `flange.holes?.enabled`, call `addHoleLines`
  - Iterate all inner frez lines on all sides; if `frez.holes?.enabled`, call `addHoleLines`
- [ ] **3.3** Ensure the HOLES shapes are NOT affected by `invertX`/`invertY` (they should be — since the existing inversion loop at lines 777-789 already transforms ALL shapes, this works automatically)
- [ ] **3.4** Add validation warnings for invalid hole configurations (e.g., sideOffset too large, endOffset exceeds flange depth)

### Phase 4: DXF Export (`dxf.ts`)

- [ ] **4.1** Add `"HOLES"` to the `layerOptions` in `buildDxf()` with `color: 2` (yellow in DXF color index — matches yellow-500)
  - Current layer options at `dxf.ts:57-61`: add `HOLES: { color: 2 }`

### Phase 5: Canvas Preview (`preview-canvas.tsx`)

- [ ] **5.1** Update the shape rendering loop to handle the `"HOLES"` layer:
  - Add a color case for HOLES: `strokeStyle = "#eab308"` (Tailwind yellow-500 hex)
  - Use a distinct line width (e.g., 1.8) to differentiate from CUT and FREZ
- [ ] **5.2** Update the z-sorting in the ordered array to draw HOLES on top of FREZ but below CUT (or as the implementer sees fit for visual clarity)

### Phase 6: Hotkey (`hotkeys.tsx`)

- [ ] **6.1** Add `useHotkey("H", ...)` handler:
  - Guard: `isSideSelected` must be true
  - Guard: either `selectedFlangeIndex` or `selectedInnerFrezIndex` must be non-null (a feature must be focused)
  - Determine which feature is selected (flange or inner frez)
  - Read current hole settings from project defaults (via `useWorkspace().selectedProject?.defaults?.holeDefaults`)
  - Call `toggleHoles(side, featureKind, index, settings)`
  - Ignore plain text inputs (same pattern as F and Z)
- [ ] **6.2** Add `useHotkey("Shift+H", ...)` to remove holes from the currently selected feature
- [ ] **6.3** Add `useHotkey("Mod+Shift+H", ...)` to remove holes from ALL features on the selected side

### Phase 7: Project Defaults & Settings UI

- [ ] **7.1** Add `holeDefaults` to the `ProjectSummary.defaults` type in `workspace/context.tsx`:
  ```
  holeDefaults?: HoleSettings;
  ```
- [ ] **7.2** Add a new "HOLES Defaults" section to the "Project Defaults" tab in `export-settings-dialog.tsx`:
  - INNER / OUTER toggle (two-button pill switch, matching existing frez mode UI)
  - HORIZONTAL / VERTICAL toggle (two-button pill switch)
  - Side Offset input (number, mm)
  - End Offset input (number, mm)
  - Length input (number, mm)
- [ ] **7.3** Update `handleSaveDefaults()` to include `holeDefaults` in the mutation payload
- [ ] **7.4** Update the `useEffect` that loads defaults to read `holeDefaults` from the project
- [ ] **7.5** Update the Convex `updateProjectDefaults` mutation and schema to accept `holeDefaults`

### Phase 8: Side Editor Visual Indicator (`side-editor.tsx`)

- [ ] **8.1** Add a small visual indicator (yellow dot or "H" badge) on `FlangeChip` / `FlangeBlock` / `InnerFrezChip` / `InnerFrezBlock` when `holes?.enabled` is true
  - A tiny yellow circle or `H` text next to the existing labels, styled with `text-yellow-500`
- [ ] **8.2** This is purely visual — clicking it is not needed since H hotkey is the primary interaction

### Phase 9: Badge Counter (`sheet-metal.tsx` route)

- [ ] **9.1** Add a HOLES badge to the info bar (alongside existing CUT and FREZ badges):
  - `<Badge variant="holes" className="h-5 text-[10px]">HOLES {countShapes(geometry.shapes, "HOLES")}</Badge>`
- [ ] **9.2** Add the "holes" badge variant to the Badge component if not already present (check `src/components/ui/badge.tsx`)

---

## Verification Criteria

- [ ] Pressing W (select top), F50 (add F1=50mm), H (add holes) renders two yellow lines on the top flange in the preview canvas
- [ ] The two hole lines appear at the correct positions per the ASCII examples in the requirements doc
- [ ] DXF export includes a "HOLES" layer with yellow (color 2) lines
- [ ] Changing project default hole settings and pressing H on a new feature uses the updated settings
- [ ] Pressing H again on the same feature toggles holes off
- [ ] Pressing Shift+H removes holes from the focused feature
- [ ] Holes work on all 4 sides (top, right, bottom, left)
- [ ] Holes work on both flanges (Fn) and inner frez lines (Zn)
- [ ] SIDE and END offsets are measured based on hole-line orientation, not the H/V setting
- [ ] Old saved designs without holes data load correctly (backward compat)
- [ ] Undo (Ctrl+Z) correctly reverses hole additions/removals

---

## Potential Risks and Mitigations

1. **Geometry calculation complexity for different side orientations**
   - Risk: The coordinate transforms for left/right sides with horizontal/vertical swaps are error-prone
   - Mitigation: Implement one side (top) first, test thoroughly, then apply the same pattern with clear comments for the other three sides. Use the existing flange rendering code as a reference for coordinate patterns.

2. **Hole lines overlapping with CUT or FREZ geometry**
   - Risk: Holes placed at certain offsets might visually overlap with existing geometry
   - Mitigation: This is acceptable per the requirements — holes are on their own layer and the CNC pipeline backend can handle multi-layer DXF files. The HOLES layer is independent.

3. **Backward compatibility with saved designs**
   - Risk: Old designs in the database don't have `holes` fields
   - Mitigation: The `holes` field is optional (`holes?: HoleData`). The normalizer returns `undefined` for missing data. All geometry code checks `holes?.enabled` before rendering.

4. **Project defaults schema migration**
   - Risk: Adding `holeDefaults` to the Convex project defaults requires a schema change
   - Mitigation: The field is optional in the type (`holeDefaults?: HoleSettings`). Existing projects without it will use hardcoded defaults. No migration needed.

5. **Hotkey conflicts**
   - Risk: H might conflict with text input in the design name field
   - Mitigation: Follow the exact same pattern as F and Z — check `isPlainTextInput(e)` and return early. Use `ignoreInputs: false`.

---

## Alternative Approaches

1. **Store holes as a separate array on SideConfig** (e.g., `side.holes[]`)
   - Rejected: Would require tracking which flange/frez each hole belongs to via index references, creating synchronization bugs when features are added/removed/reordered.

2. **Store holes globally on the model** (not per-side)
   - Rejected: Holes are inherently per-feature on a specific side. Global storage would require complex referencing.

3. **Use a separate context for hole settings** instead of project defaults
   - Rejected: Project defaults already exist and are the right place for configurable settings that persist across designs. Adding a separate context would increase complexity without benefit.

---

## File Change Summary

| File | Changes |
|---|---|
| `src/features/sheet-metal/types.ts` | Add `HoleSettings`, `HoleData` types; add `holes?` to `FlangeMeasurement` and `FrezMeasurement`; update `Layer` union; add normalizers |
| `src/features/sheet-metal/context.tsx` | Add `toggleHoles`, `removeHoles` actions |
| `src/features/sheet-metal/geometry.ts` | Add `addHoleLines` helper; call it for all features with `holes?.enabled` |
| `src/features/sheet-metal/dxf.ts` | Add `HOLES: { color: 2 }` to layer options |
| `src/features/sheet-metal/preview-canvas.tsx` | Add yellow color for HOLES layer |
| `src/features/sheet-metal/hotkeys.tsx` | Add H, Shift+H, Mod+Shift+H hotkeys |
| `src/features/sheet-metal/export-settings-dialog.tsx` | Add HOLES defaults section in Project Defaults tab |
| `src/features/sheet-metal/side-editor.tsx` | Add visual indicator for holes on feature chips/blocks |
| `src/features/workspace/context.tsx` | Add `holeDefaults` to `ProjectSummary.defaults` type |
| `src/routes/sheet-metal.tsx` | Add HOLES badge to info bar |
| `convex/workspaces.ts` | Update `updateProjectDefaults` mutation to accept `holeDefaults` |
| `convex/schema.ts` | Add `holeDefaults` to project defaults schema (if needed) |

---

## Implementation Order (Recommended)

1. **Types first** — `types.ts` changes (Phase 1) — everything depends on this
2. **Context actions** — `context.tsx` (Phase 2) — enables data manipulation
3. **Geometry** — `geometry.ts` (Phase 3) — makes holes render
4. **DXF + Canvas** — `dxf.ts` + `preview-canvas.tsx` (Phases 4-5) — makes holes visible
5. **Hotkey** — `hotkeys.tsx` (Phase 6) — enables user interaction
6. **Settings UI** — `export-settings-dialog.tsx` + workspace types (Phase 7) — enables configuration
7. **Visual polish** — `side-editor.tsx` + `sheet-metal.tsx` route (Phases 8-9) — indicators and badges
