# NESTING EXPLAINED v1.0

> How the Nesting feature works, top to bottom, and how all the pieces wire together.

---

## 1. What Is Nesting?

Nesting takes a pile of flat sheet-metal DXF parts and **arranges them as tightly as possible onto 1250×3200mm ACM sheet stock**, producing one DXF output per sheet layout with repeat counts. The CNC operator then cuts each sheet layout N times.

The feature runs **entirely in the browser** — no backend round-trip needed for the core packing operation.

---

## 2. File Map

```
src/features/nesting/
├── constants.ts          Every magic number, layer name, and color
├── types.ts              Data model, filename parser, mode detection, helpers
├── packer.ts             MaxRects bin packing engine (pure math, zero deps)
├── deduplicator.ts       CUT line coincident-segment merging
├── dxf-writer.ts         Generates DXF strings using Maker.js exporter (same method as sheet-metal feature)
│                         + injectBeforeEndsec() for labels + downloadDxf/exportAllSheetsAsZip
├── dxf-reader.ts          Parses imported DXF files → bbox + CUT segments
│                         + createNestPartFromDesign() bridge from sheet-metal
│                         + extractDxfModel() → Maker.js IModel for rendering/output
├── context.tsx            NestingProvider + useNesting() React context
├── preview-canvas.tsx     HTML5 Canvas renderer with pan/zoom
├── part-list.tsx          Left sidebar — import DXF, import from project, manage parts
├── sheet-list.tsx         Right sidebar — sheet layout thumbnails + stats
├── export-dialog.tsx      Export settings + ZIP download
└── hotkeys.tsx            Keyboard shortcuts

src/features/sheet-metal/
├── dxf.ts                buildDxf() — generates DXF from parametric model
├── export-settings-dialog.tsx  Settings modal with includeMetadata toggle
└── context.tsx            SheetMetalProvider + exportDxf with metadata filenames

src/routes/
└── nesting.tsx            Route component (/nesting)

src/lib/navigation.ts     Added "Nesting" nav item with Layers icon
src/app.tsx               Added /nesting route (authenticated + unauthenticated)
```

---

## 3. Data Model

### 3.1 Core Types (from `types.ts`)

```
NestPart ── the input (one DXF part type)
  id: string                    unique per part type
  name: string                  e.g. "1335", "corner"
  filename: string              original filename without extension
  direction: "T"|"B"|"L"|"R"|null    arrow direction from filename
  count: number                 how many instances required
  rotationLocked: boolean       true if direction is set
  allowedRotation: 0|90|-1      0=upright, 90=rotated, -1=both free
  l0Width, l0Height: number     Layer 0 bounding box
  cutWidth, cutHeight: number   l0 + 2×CUT_OFFSET on each axis
  source: "sheet-metal"|"custom-dxf"
  cutLines: Segment[]           CUT layer geometry in local coords
  l0Bbox: Rect                  Layer 0 bounding box in local coords
  dxfContent?: string           raw DXF string (for Maker.js model extraction)
  designId?: string             link to Convex sheet-metal design
  blockDxfContent?: string      (reserved, not currently used in output)

PackItem ── internal packer input (expanded from NestPart.count)
  rid: string                  unique key "{partId}_{instanceIndex}"
  partId: string               references back to the part
  partName: string              for display/logging
  instanceIndex: number         which copy of this part type
  w, h: number                 dimensions in packing space (possibly swapped)
  rotated: boolean              true if pre-rotated 90° (allowedRotation=90)
  partData: NestPart           reference to original part

Placement ── one part instance on a sheet
  partId, instanceIndex         references back to the part
  packX, packY                 position in packing space
  packWidth, packHeight        dimensions in packing space
  rotation: 0|90

SheetLayout ── one unique arrangement on a sheet
  id: string                   layout identifier
  sheetIndex: number
  mode: "A"|"B"                A=margin, B=full-span (centered or bottom-left)
  alignment: "margin"|"centered"|"bottom-left"  how offsets were chosen
  placements: Placement[]
  repeatCount: number          how many times to cut this exact sheet
  sheetName: string            e.g. "1_r12_A_p6_u83"
  offsetX, offsetY: number     packing→sheet coordinate offset
  dedupedCutSegments: Segment[] filled after deduplication
  utilizationPercent: number   material utilization as % (0–100, rounded)

NestJob ── top-level state object
  id, name: string
  parts: NestPart[]             the input parts
  layouts: SheetLayout[]        the output layouts (populated after packing)
  mode: "A"|"B"
  status: "idle"|"packing"|"done"|"error"
  warnings: string[]
  totalSheetsToCut: number
  createdAt, updatedAt: number
```

### 3.2 Geometric Primitives

```typescript
type Segment = { x1, y1, x2, y2: number }  // a line segment
type Rect = { x0, y0, x1, y1: number }      // axis-aligned bounding box
type FreeRect = { x, y, w, h: number }      // packer free-rectangle (internal)
type PackResult = { x, y, width, height, rid, rotated: boolean }  // packer result (rotated = true if w↔h swapped)
```

### 3.3 Coordinate Spaces

There are **three** coordinate systems. Keeping them distinct is critical:

| Space | Origin | What lives here |
|-------|--------|-----------------|
| **Part-local** | Bottom-left of Layer 0 bbox | CUT segments, Layer 0 geometry |
| **Packing space** | (0,0) = bottom-left of usable bin area | MaxRects placements |
| **Sheet space** | (0,0) = bottom-left of the physical 1250×3200 sheet | DXF output |

**Transforms:**
- **Mode A Packing → Sheet:** `sheet_x = pack_x + 35`, `sheet_y = pack_y + 35`
- **Mode B Packing → Sheet:** `sheet_x = pack_x + offset_x`, `sheet_y = pack_y + offset_y` (bottom-left or centered, computed per-layout based on utilization)
- **Part-local → Sheet (0°):** `sheet_x = pack_x + offset_x + CUT_OFFSET + local_x`, `sheet_y = pack_y + offset_y + CUT_OFFSET + local_y`
- **Part-local → Sheet (90°):** `sheet_x = pack_x + offset_x + l0Height + CUT_OFFSET − local_y`, `sheet_y = pack_y + offset_y + CUT_OFFSET + local_x`

Where `insert_x = pack_x + offset_x + CUT_OFFSET` and `insert_y = pack_y + offset_y + CUT_OFFSET`.

For 0° rotation, the local origin (0,0) maps to (insert_x, insert_y), placing the CUT bbox at [pack_x + offset_x, pack_x + offset_x + cutWidth] × [pack_y + offset_y, pack_y + offset_y + cutHeight].

For 90° rotation, the local origin (0,0) maps to (pack_x + offset_x + l0Height + CUT_OFFSET, pack_y + offset_y + CUT_OFFSET), which compensates for the leftward bbox shift caused by CCW rotation. The CUT bbox lands at [pack_x + offset_x, pack_x + offset_x + cutHeight] × [pack_y + offset_y, pack_y + offset_y + cutWidth].

**Maker.js Transform Pipeline (non-CUT geometry):**
Both the DXF writer and preview canvas apply the same 3-step transform to part geometry using Maker.js operations:
1. **Normalize** — `moveRelative([-l0Bbox.x0, -l0Bbox.y0])` shifts the L0 lower-left to (0,0) (effectively a no-op since `l0Bbox` is always `{x0:0, y0:0}` after normalization in `parseDxfContent`)
2. **Rotate & align** — 0°: `moveRelative([CUT_OFFSET, CUT_OFFSET])`; 90°: `rotate(90, [0,0])` then `moveRelative([l0Height+CUT_OFFSET, CUT_OFFSET])`
3. **Translate to sheet** — `moveRelative([packX+offsetX, packY+offsetY])`

The deduplicator uses the mathematical equivalent of this pipeline via `computeInsertPosition()` + `transformCutSegment()`, which compute the same final coordinates using direct arithmetic instead of Maker.js transforms.

---

## 4. Constants (from `constants.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `SHEET_WIDTH` | 1250 | Physical sheet width in mm |
| `SHEET_HEIGHT` | 3200 | Physical sheet height in mm |
| `MARGIN` | 35 | Margin for Mode A placement |
| `BOTTOM_LEFT_THRESHOLD` | 70 | Utilization % below which Mode B uses bottom-left alignment |
| `USABLE_WIDTH` | 1180 | Sheet width minus 2×margin |
| `USABLE_HEIGHT` | 3130 | Sheet height minus 2×margin |
| `CUT_OFFSET` | 3 | CUT layer offset outward from Layer 0 |
| `COINCIDENCE_TOL` | 0.01 | Dedup tolerance in mm |
| `MAX_SHEETS` | 200 | Maximum bins the packer opens |

DXF layer colors (ACI codes and canvas CSS):
- `CUT` → ACI 3 (green) / canvas `#22c55e`
- `0` → ACI 7 (white/black) / canvas `#ffffff`
- `FREZ` → ACI 6 (magenta) / canvas `#d946ef`
- `FREZ_135` → ACI 1 (red) / canvas `#ef4444`
- `HOLES` → ACI 2 (yellow) / canvas `#eab308`
- `SHEETS` → ACI 4 (cyan) / canvas `rgb(39,118,187)`
- Custom/unknown layers → ACI 30 (orange) / canvas `#f97316`

The canvas uses the exact RGB values for each layer, while DXF output uses the closest ACI color codes for maximum compatibility across all CAD software. Unknown or custom-named layers default to orange (ACI 30). Helper functions `getAciColor(layer)` and `getCanvasColor(layer)` in `constants.ts` resolve the correct color for any layer name.

---

## 5. Filename Parser

The parser is a **4-tier fallthrough** — it never throws an error:

| Pattern | Example | Result |
|---------|---------|--------|
| `name_DIR_xCount.dxf` | `1335_B_x50.dxf` | name="1335", dir=B, count=50 |
| `name_xCount.dxf` | `corner_x8.dxf` | name="corner", dir=T, count=8 |
| `name_DIR.dxf` | `panel_R.dxf` | name="panel", dir=R, count=1 |
| *any other filename* | `test-0.dxf` | name="test-0", dir=T, count=1 |

**Default direction is T (top/upright).** When no direction suffix exists, the part is locked upright (rotationLocked=true, allowedRotation=0).

The `direction` → rotation mapping:
- T or B → `rotationLocked: true`, `allowedRotation: 0` (stay upright)
- L or R → `rotationLocked: true`, `allowedRotation: 90` (already rotated 90°)
- null → `rotationLocked: false`, `allowedRotation: -1` (packer can rotate freely)

---

## 6. Packing Engine (from `packer.ts`)

### 6.1 Algorithm: MaxRects Bin Packing

The packer is a pure-TypeScript implementation with **zero external dependencies**. It uses the MaxRects algorithm with three heuristics run in parallel:

1. **BSSF** (Best Short Side Fit) — minimize the shorter leftover side of the chosen free rectangle
2. **BAF** (Best Area Fit) — minimize the leftover area
3. **BLSF** (Best Long Side Fit) — minimize the longer leftover side

All three are run, and the result with the **fewest sheets** wins.

### 6.2 Packing Flow

```
Input: NestPart[] (parts with counts)
      │
      ▼
[1] Expand by count → flat list of PackItems
      │   (e.g., "1335_B_x50" → 50 PackItems)
      │
      ▼
[2] Sort by CUT area descending
      │   (largest items first = better packing)
      │
      ▼
[3] Detect Mode A or Mode B
      │   A: everything fits in 1180×3130 usable area
      │   B: some part or pair spans the full sheet
      │
      ▼
[4] For each item, find best free rectangle using BSSF/BAF/BLSF
      │   Rotation-free items: allow rotation=True, packer may swap w↔h
      │   Locked items: fixed dimensions
      │
      ▼
[5] Place item, split overlapping free rectangles, prune
      │
      ▼
[6] Build SheetLayouts from packed bins
      │   - Compute alignment offset (Mode B: bottom-left or centered; Mode A: margin)
      │   - Compute repeat count per sheet (bottleneck determines repeats)
      │   - Validate production: warn on under/over-production
      │
      ▼
Output: { layouts: SheetLayout[], mode: "A"|"B", warnings: string[] }
```

### 6.3 Free Rectangle Management

The packer maintains a list of free rectangles per bin. When an item is placed:
1. All free rectangles that overlap the placed item are **split** into up to 4 sub-rectangles (left, right, top, bottom remainders)
2. Free rectangles entirely contained within other free rectangles are **pruned**
3. New bins are created on demand (up to `MAX_SHEETS = 200`)
4. Console errors are logged when a part fails to place (instead of silently dropping it)

### 6.4 Rotation Handling

- `allowedRotation === 0` → dimensions are `cutWidth × cutHeight` (upright only)
- `allowedRotation === 90` → dimensions are `cutHeight × cutWidth` (pre-rotated), `item.rotated = true`
- `allowedRotation === -1` → both orientations tried; if packer swaps w↔h, `BestPosition.rotated = true`

In `packAllParts`, the final `rotation` field on each Placement is computed from both sources:
```
rotationDeg = rect.rotated || item.rotated ? 90 : 0
```
- `rect.rotated` — set by the MaxRects packer when it swaps w↔h for a rotation-allowed item
- `item.rotated` — set in `buildItems` when `allowedRotation === 90` (pre-rotated parts)

This is more reliable than comparing dimensions, which fails for near-square parts where `cutWidth ≈ cutHeight`.

### 6.5 Repeat Count Computation

For each sheet layout:
```
For each part type on this sheet:
    instances_on_sheet = count of that part's placements on this sheet
    repeats_needed = ceil(total_required / instances_on_sheet)

sheet.repeat_count = min(repeats_needed across all part types on this sheet)
```

The **bottleneck part** (the one that requires the most repeats) determines how many times the sheet is cut. Over-production of other parts is acceptable waste.

### 6.6 Mode B Alignment (Bottom-Left / Centered)

After all items are placed in Mode B, the packer computes **per-layout utilization** and chooses an alignment:

```
utilization = (Σ packWidth × packHeight) / (SHEET_WIDTH × SHEET_HEIGHT) × 100
```

**If utilization < 70% (BOTTOM_LEFT_THRESHOLD):**

The layout is sparse, so parts are anchored at the **bottom-left** of the sheet with a MARGIN offset, clamped so parts never exceed sheet boundaries:

```
offset_x = Math.min(MARGIN, Math.max(0, (SHEET_WIDTH - layout_w) / 2))
offset_y = Math.max(0, SHEET_HEIGHT - layout_h - Math.min(MARGIN, Math.max(0, (SHEET_HEIGHT - layout_h) / 2)))
alignment = "bottom-left"
```

X offset works like a hard margin from the left: MARGIN (35mm) when the layout is narrow, shrinking toward centering when the layout is wide.

Y offset anchors the layout toward the **bottom** of the sheet (high Y in the coordinate system where Y increases downward on screen and in DXF output). When the layout is short, there's a MARGIN gap at the bottom; as the layout fills the sheet, offset smoothly approaches centering.

**If utilization ≥ 70%:**

The layout uses most of the sheet, so parts are **centered** with equal margins:

```
offset_x = (SHEET_WIDTH - layout_w) / 2
offset_y = (SHEET_HEIGHT - layout_h) / 2
alignment = "centered"
```

**Mode A** always uses `offset_x = offset_y = MARGIN` with `alignment = "margin"`.

The `alignment` field on `SheetLayout` is consumed by the UI (badge in sheet-list, label in export-dialog, indicator in preview-canvas) and the DXF writer (suffix on the sheet label: `_M`, `_BL`, `_C`)

#### Edge-case safety (bottom-left clamp)

| Scenario | layout_w | `(SHEET_WIDTH - layout_w) / 2` | `Math.min(MARGIN, ...)` | Result |
|----------|----------|--------------------------------|------------------------|--------|
| Small layout | 500 | 375 | 35 | Left-anchored with 35mm margin |
| Wide layout | 1220 | 15 | 15 | Near-centering, stays in bounds |
| Full-width | 1250 | 0 | 0 | Offset 0, flush to edge |

The Y clamp follows the same pattern from the bottom edge:

| Scenario | layout_h | Bottom margin | Result |
|----------|----------|--------------|--------|
| Short layout | 500 | 35 | Bottom-anchored with 35mm margin |
| Tall layout | 2800 | 35 | Bottom-anchored with 35mm margin |
| Near-full | 3130 | 35 | Bottom-anchored with 35mm gap |
| Full-height | 3200 | 0 | Offset 0, flush to edge |

---

## 7. CUT Line Deduplication (from `deduplicator.ts`)

### 7.1 Why Dedup?

When two parts share a CUT edge (placed flush against each other), both contribute a line at that boundary. The CNC would cut the same line twice — wasted machining time. Deduplication merges these coincident segments into one.

### 7.2 Algorithm

Two segments are **coincident** when:
1. They are **collinear** — all endpoints lie on the same infinite line (perpendicular distance < `COINCIDENCE_TOL = 0.01mm`)
2. Their **1D projections overlap** along the shared axis (not just touch at a point)

When coincident, the retained segment spans the **union** of both overlapping projections. The average Y (for horizontal segments) or X (for vertical) is used.

### 7.3 Dedup Flow

```
For each placement on a sheet:
    ┌─────────────────────────────────────────────────────┐
    │ Compute insert position via computeInsertPosition(): │
    │ • 0°: insert = (packX + offsetX + CUT_OFFSET,       │
    │               packY + offsetY + CUT_OFFSET)          │
    │ • 90°: insert = (packX + offsetX + l0Height + CO,   │
    │                packY + offsetY + CUT_OFFSET)         │
    │                                                     │
    │ Transform CUT segments from part-local → sheet:    │
    │ • 0°: sheet = insert + local                        │
    │ • 90°: sheet_x = insertX − local_y                  │
    │         sheet_y = insertY + local_x                 │
    └─────────────────────────────────────────────────────┘
            │
            ▼
    Collect all CUT segments into flat array
            │
            ▼
    For each unprocessed segment:
        Find coincident segments (O(n²))
        Merge into union span
        Mark consumed
            │
            ▼
    Return deduplicated list
```

Complexity is O(n²) worst case, but typical sheets have <200 segments, so it runs in <10ms.

### 7.4 Coordinate Transform for 90° Rotation

The `computeInsertPosition()` function computes the alignment point in sheet space, taking the part's `l0Height` into account. For 0° rotation, the insert point is straightforward: pack position + layout offset + CUT_OFFSET. For 90° rotation, the leftward bbox shift from CCW rotation requires an additional `l0Height + CUT_OFFSET` shift in X.

```
90° rotation transform:
  sheet_x = insertX − local_y
  sheet_y = insertY + local_x

Where insertX and insertY come from computeInsertPosition():
  0°:  insertX = packX + offsetX + CUT_OFFSET
       insertY = packY + offsetY + CUT_OFFSET
  90°: insertX = packX + offsetX + l0Height + CUT_OFFSET
       insertY = packY + offsetY + CUT_OFFSET

The (l0Height + CUT_OFFSET) X-shift for 90° rotation compensates for
the leftward bbox shift caused by CCW rotation around the origin. Without
this compensation, parts would extend l0Height mm past the left boundary.
The CUT bbox lands at [packX+offsetX, packX+offsetX+cutHeight] ×
[packY+offsetY, packY+offsetY+cutWidth] for 90°, matching the pack rectangle.
```

---

## 8. DXF Writer (from `dxf-writer.ts`)

### 8.1 Output Structure

Each `SheetLayout` produces one `.dxf` file generated in two stages:

1. **Maker.js model construction** — Build an `IModel` containing all geometry (sheet frame lines, per-part non-CUT geometry as sub-models, deduplicated CUT line paths)
2. **Maker.js DXF export** — `makerjs.exporter.toDXF()` converts the model to a complete DXF string with proper layers and colors
3. **Label injection** — TEXT entities for the sheet title, per-part name labels, and repetition count are injected into the DXF string before ENDSEC
4. **Layer color post-processing** — Unknown/custom layer colors are changed to ACI 30 (orange) in the LAYER table entries for maximum DXF compatibility

The approach mirrors the sheet-metal feature, which also uses Maker.js for DXF output.

### 8.2 Key Design Decisions

**CUT lines are written directly as LINE paths in the Maker.js model, NOT as block/INSERT references.** This enables deduplication — shared edges become single LINE entities. All other geometry (Layer 0, FREZ, FREZ_135, HOLES) is extracted from the source DXF via `extractDxfModel()` and rendered through Maker.js sub-models with per-placement transformations.

**Non-CUT geometry uses Maker.js sub-models, not DXF INSERT/BLOCK references.** Each unique part type has its non-CUT geometry extracted into a Maker.js `IModel` (via `extractDxfModel`), which is cached, deep-cloned per placement, transformed (normalize → rotate → shift → translate), and added to the main model as a sub-model named `{partId}_{placementIndex}`. Maker.js handles the rendering of all path types (lines, arcs, circles, polylines) to DXF entities automatically.

**Parts without source DXF content fall back to a simple L0 rectangle.** If `part.dxfContent` is empty/null but `part.l0Bbox` exists, the writer creates a 4-line rectangle model on the `0` layer as a visual placeholder.

### 8.3 DXF Construction Pipeline

The writer builds the DXF in these steps:

```
1. Create main Maker.js IModel: { paths: {}, models: {} }
      │
      ▼
2. Add sheet frame (4 LINE paths via addRectLines)
   ┌─ Mode A: outer 1250×3200 + inner 1180×3130 margin rectangle
   └─ Mode B: outer 1250×3200 + inner guide rectangle (positioned by offsetX/offsetY)
      │
      ▼
3. For each placement, add per-part non-CUT geometry:
   a. Extract base Maker.js model from part.dxfContent (cached per part ID)
   b. Deep-clone the base model
   c. Normalize: moveRelative([-l0Bbox.x0, -l0Bbox.y0])
      (Shifts L0 lower-left to (0,0) — effectively a no-op since l0Bbox
       is always {x0:0, y0:0} after parseDxfContent normalizes it)
   d. Rotate and align:
      ┌─ 0°: moveRelative([CUT_OFFSET, CUT_OFFSET])
      └─ 90°: rotate(90, [0,0]) then moveRelative([l0Height+CUT_OFFSET, CUT_OFFSET])
   e. Translate to sheet position: moveRelative([packX+offsetX, packY+offsetY])
   f. Add as sub-model to main model
      │
      ▼
4. Add deduplicated CUT lines (collectAndDeduplicate → LINE paths on LAYER_CUT)
      │
      ▼
5. Export via Maker.js: makerjs.exporter.toDXF(mainModel, { units, layerOptions })
      │
      ▼
6. Walk model to collect all used layer names → build complete layerOptions map
      │   (known layers get their ACI colors; unknown layers get ACI 30 = orange)
      │
      ▼
7. Export via Maker.js: makerjs.exporter.toDXF(mainModel, { units, layerOptions })
      │
      ▼
8. Post-process DXF string:
      │   - Change unknown layer ACI colors to 30 (orange)
      │
      ▼
9. Inject TEXT entities before ENDSEC:
      │   - Sheet title at top-left (left-aligned)
      │   - Per-part name labels at center of each part's L0 bbox
      │   - Repetition count at bottom-right (right-aligned)
      │
      ▼
10. Return complete DXF string
```

### 8.4 Label Injection & DXF Entities

Three types of TEXT entities are injected into the DXF output:

**1. Sheet Title** — positioned at top-left of the sheet, left-aligned:
- Position: `(10, SHEET_HEIGHT + 80)` (just above the sheet, left margin)
- Text: the sheet name in the format `{number}_r{repeat}_{mode}_p{parts}_u{util}%`
- Example: `1_r12_A_p6_u83` — sheet 1, repeat 12 times, mode A, 6 parts, 83% utilization
- Layer: SHEETS, height: 50mm
- Horizontal alignment: left (default)

**2. Per-Part Name Labels** — positioned at the center of each part's L0 bbox:
- For 0° rotation: center of `(packX + offsetX + CUT_OFFSET + l0Width/2, packY + offsetY + CUT_OFFSET + l0Height/2)`
- For 90° rotation: center accounts for the `l0Height` X-shift and swapped dimensions
- Layer: SHEETS, height: 20mm
- Horizontal alignment: center (DXF group code 72=1, with second alignment point 11/21)
- These labels are crucial for production so operators can mark parts during cutting

**3. Repetition Count Label** — positioned at the bottom-right, below the sheet:
- Position: `(SHEET_WIDTH − 10, −80)` (bottom-right, below the sheet)
- Text: just the repeat count number (e.g., `12` or `33`)
- Layer: SHEETS, height: 80mm
- Horizontal alignment: right (DXF group code 72=2, with second alignment point 11/21)
- This provides a clear, large-number indicator for how many times the CNC operator must run this sheet

Since Maker.js doesn't support TEXT entities natively, all labels are injected by the `injectBeforeEndsec()` helper, which finds the ENTITIES section header and the next ENDSEC, then splices the entity DXF text in between.

### 8.4.1 Sheet Naming Format

The sheet name follows a structured format that encodes all production metadata directly in the filename and the sheet title:

```
{sheet_number}_r{repeat_count}_{mode}_{parts_inside}_u{utilization_percent}
```

Examples:
- `1_r12_A_p6_u83` — first sheet, repeat 12 times, mode A (margin), 6 parts, 83% utilization
- `35_r2_A_p1_u17` — 35th sheet, repeat 2 times, mode A, 1 part, 17% utilization
- `3_r1_B_p4_u62` — 3rd sheet, repeat once, mode B (full-span), 4 parts, 62% utilization

This format is generated by `formatSheetTitle(layout)` in `types.ts` and used consistently across:
- DXF file filenames (e.g., `1_r12_A_p6_u83.dxf`)
- Sheet title labels inside the DXF
- Canvas preview labels
- Sheet list panel display names
- ZIP export filenames

The `utilizationPercent` field on `SheetLayout` is computed during packing as `Math.round(partArea / sheetArea × 100)`, where `sheetArea = 1250 × 3200 mm²`.

### 8.5 Sheet Frame Drawing

**Mode A:**
- Outer 1250×3200 rectangle on SHEETS layer (4 LINE paths via `addRectLines`)
- Inner 1180×3130 dashed margin rectangle on SHEETS layer (4 LINE paths)

**Mode B:**
- Outer 1250×3200 rectangle
- Inner dashed rectangle around the layout (positioned by `offsetX`, `offsetY`, and the max extent of all placements). For `bottom-left` alignment this rectangle hugs the bottom-left of the sheet; for `centered` alignment it is centered.

Note: The inner rectangle dimensions are computed from the actual placements in the layout (`Math.max(...placements.map(pl => pl.packX + pl.packWidth))`), not stored as layout properties.

### 8.6 Export Functions

- `writeNestSheetDxf(layout, parts)` → builds Maker.js model, exports to DXF string, post-processes layer colors, injects labels (title + per-part + repetition), returns the complete DXF string
- `downloadDxf(content, filename)` → creates a Blob and triggers browser download
- `exportAllSheetsAsZip(layouts, parts)` → creates a ZIP of all DXF files using JSZip, filenames use `formatSheetTitle()` format, triggers download

---

## 9. DXF Reader (from `dxf-reader.ts`)

### 9.1 Purpose

When the user imports a DXF file, we need to:
1. Extract the **Layer 0 bounding box** (to know the part dimensions)
2. Extract **CUT layer line segments** (for deduplication during output)
3. Extract **non-CUT geometry** as a Maker.js model (for DXF output and canvas rendering)

### 9.2 Entity Support

| Entity Type | Bbox Extraction | Segment Extraction | Model Extraction |
|-------------|----------------|-------------------|------------------|
| LINE | ✅ | ✅ | ✅ |
| LWPOLYLINE | ✅ | ✅ (vertices + closed) | ✅ (with bulge → arc support) |
| ARC | ✅ (bounding box) | ✅ (64-division arc) | ✅ |
| CIRCLE | ✅ (bounding box) | ✅ (64-division circle) | ✅ |
| SPLINE | ✅ (control points) | ✅ (between control points) | ❌ (skipped) |
| ELLIPSE | ✅ (bounding box) | ✅ (64-division) | ❌ (skipped) |
| POLYLINE | ❌ | ❌ (not yet) | ❌ |
| TEXT/MTEXT | ❌ | ❌ | ❌ (skipped) |

### 9.3 Critical Implementation Detail

DXF stores LWPOLYLINE vertices as **multiple group code 10/20 pairs** within a single entity. A naive `Map<number, value>` would clobber all but the last vertex. The parser uses an **ordered array of code/value pairs** (`entity.pairs`) alongside a `firstValue` map, with a `getAllValues(entity, code)` helper to correctly collect all values for repeated group codes.

### 9.4 Coordinate Normalization

When extracting CUT segments and the L0 bounding box, the reader **normalizes coordinates to part-local space**: all segment coordinates are shifted by `(-l0Bbox.x0, -l0Bbox.y0)`, and the returned `l0Bbox` is always `{x0: 0, y0: 0, x1: l0Width, y1: l0Height}`. This ensures that:
- CUT lines are stored in part-local coordinates where the L0 origin is at `(0, 0)`
- The transform pipeline can apply `moveRelative([-l0Bbox.x0, -l0Bbox.y0])` as a normalization step without effect (since `l0Bbox.x0 = l0Bbox.y0 = 0`), keeping code paths uniform

### 9.5 Fallback Behavior

If the DXF cannot be parsed (binary DXF, unsupported entities, etc.), the reader falls back to **placeholder dimensions (500×500mm)** so the part still appears in the UI and the user can proceed. A console warning is emitted.

### 9.6 DXF Model Extraction (`extractDxfModel`)

The `extractDxfModel()` function converts raw DXF content into a Maker.js `IModel` for use by both the DXF writer and the preview canvas. This enables rendering of non-CUT geometry (Layer 0 outlines, FREZ, FREZ_135, HOLES) without manual DXF construction.

**Processing:**
1. Parse DXF entities using `parseDxfEntities()`
2. Skip entities on the CUT layer and DEFPOINTS/empty layers
3. Convert each entity to Maker.js path objects:
   - LINE → `makerjs.paths.Line`
   - CIRCLE → `makerjs.paths.Circle`
   - ARC → `makerjs.paths.Arc`
   - LWPOLYLINE → individual `Line` segments (with bulge support → `Arc` via chord/sagitta math)
4. Assign the original DXF layer to each path's `layer` property (preserves layer/color info for rendering)
5. Return the assembled `IModel`, or `null` if no valid paths were found

**LWPOLYLINE bulge handling:** When a polyline vertex has a non-zero bulge value (group code 42), the `addLwPolylineSegment()` function computes the arc center, radius, and start/end angles from the chord and bulge. This correctly renders filleted corners and arcs in imported DXF part geometry.

**Caching:** Both the DXF writer and preview canvas cache the extracted model per part ID, so `extractDxfModel()` is called only once per unique part.

---

## 10. React Context & State (from `context.tsx`)

### 10.1 NestingProvider

Wraps the entire Nesting feature. Provides:

```typescript
useNesting() → {
  job: NestJob,               // the full state object
  setJobName,                 // rename the job
  addPart,                    // add or merge a NestPart
  removePart,                 // remove by ID
  updatePartCount,            // change the required count
  clearParts,                 // start over
  runPacking,                 // triggers packer → updates job.layouts, shows toast on success/error
  exportSheet,                // download single DXF
  exportAllSheets,            // download ZIP of all DXFs
  selectedSheetIndex,         // which layout is shown in canvas
  setSelectedSheet,           // select a layout
  totalMaterialUsed,          // utilization percentage
  totalSheetsToCut,           // sum of all repeat counts
  productionWarnings,         // under/over-production warnings
}
```

### 10.2 State Shape

```typescript
job: NestJob (single state object)
selectedSheetIndex: number | null
```

No Convex persistence yet (Task 09 is deferred). All state is local React state.

### 10.3 Packing Lifecycle

```
[Add parts] → [Configure] → [Run packing] → [Review layouts] → [Export]
      ↑              ↑            │                  │               │
      └──────────────┴────────────┴──────────────────┴───────────────┘
                          (user can re-configure and re-pack at any time)
```

`runPacking()` is **synchronous** (the packer runs on the main thread, <100ms for <200 parts). The context is structured to support async packing via a web worker in the future.

### 10.4 Merge-on-Add

When `addPart` is called with a part whose `id` already exists, the counts are **summed** rather than creating a duplicate entry. This allows the user to import the same file multiple times.

---

## 11. UI Components

### 11.1 Route: `/nesting`

```
<NestingProvider>
  └── NestingAppInner
      ├── NestingHotkeys (Cmd+P/E/N, +/− zoom, C center)
      ├── Toolbar (job name, Pack button, Export, New)
      └── 3-column grid:
          ├── PartListPanel (280px) — drag-drop DXF import
          ├── PreviewCanvas (flex-1) — sheet layout visualization
          └── SheetListPanel (260px) — layout thumbnails + stats
```

### 11.2 Part List Panel

- **Drag-and-drop zone** — drop 20+ DXF files at once, with visual overlay
- **File input** — click the Upload icon for a file picker
- **Import from project** — folder icon opens a dialog to select designs from the current project's saved sheet-metal designs. Each design is converted to a NestPart via `createNestPartFromDesign()`, using direction and count from the design's metadata settings.
- **Add demo part** — adds a random-sized part for testing (no DXF needed)
- **Part cards** — show name, direction badge (↑T/→R/↓B/←L), source badge (SM for sheet-metal, DXF for custom), dimensions, editable count input, and "linked" badge if connected to a Convex design
- **Clear all** — resets the entire job

### 11.3 Preview Canvas

- HTML5 Canvas with **pan** (mouse drag) and **zoom** (scroll wheel)
- Color-coded layers (CUT=green, Layer 0=white, FREZ=magenta, FREZ_135=red, HOLES=yellow, SHEETS=dark cyan, custom=orange)
- Y-coordinate is flipped so the canvas matches the DXF export (Y-up convention): `sy(y) = offsetY + (SHEET_HEIGHT − y) × scale`
- Arcs are rendered with negated angles and `anticlockwise=true` to match the Y-flipped coordinate system
- Shows sheet boundary, margin guides (dashed), placed parts with name labels
- Mode A: 35mm margin rectangle; Mode B: alignment guide rectangle (bottom-left or centered)
- **Per-part geometry rendering:** Uses the same Maker.js model extraction (`extractDxfModel`) as the DXF writer. Each part's base model is deep-cloned, then transformed through the same 3-step pipeline (normalize → rotate & align → translate) using `makerjs.model.moveRelative` and `makerjs.model.rotate`. The transformed model is walked via `makerjs.model.walk()` to draw all path types (lines, arcs, circles) with layer-appropriate colors.
- **Part name labels:** Each placed part shows its name (e.g., "4-18" or "corner") at the center of its Layer 0 bbox. For 90° rotation, `l0Width` and `l0Height` swap in sheet space, and an `l0ShiftX = l0Height` offset accounts for the alignment shift. Labels use `textBaseline = "middle"` for vertical centering.
- **Sheet title:** Displayed above the sheet at top-left, showing the formatted sheet name (`1_r12_A_p6_u83`). Left-aligned to prevent overflow.
- **Repetition count:** Displayed below the sheet at bottom-right, showing just the repeat count number for quick reference by the CNC operator.
- **Y-flip rendering:** The canvas uses `sy(y) = offsetY + (SHEET_HEIGHT − y) × scale` to flip the Y axis, matching DXF output where Y increases upward. All rectangle drawing uses `fillDxfRect`/`strokeDxfRect` helpers that compute the correct top-left canvas position from DXF bottom-left coordinates. Arcs use negated angles with `anticlockwise=true` to render correctly after Y-flip.
- **Deduplicated CUT lines:** Rendered on top of part geometry using `collectAndDeduplicate()` (cached in `layout.dedupedCutSegments` if available, otherwise computed on-the-fly).
- Uses manual pan/zoom via refs (no `react-zoom-pan-pinch` dependency)

### 11.4 Sheet List Panel

- Lists all layouts with thumbnail info
- Each card shows: sheet name (in the format `1_r12_A_p6_u83`), utilization %, alignment badge (Margin / Centered / Bottom-Left)
- Utilization is read from `layout.utilizationPercent` (pre-computed during packing)
- Click to select → updates the preview canvas
- Export button per layout

### 11.5 Export Dialog

- Shows number of layouts and total sheets to cut
- Shows mode description: "Standard Margin" (Mode A), "Full Span (Centered)" / "Full Span (Bottom-Left)" / "Full Span (Mixed)" (Mode B, depending on alignments)
- Lists warnings (over/under-production)
- Exports all layouts as a ZIP of individual DXF files

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+P` | Run packing |
| `Cmd/Ctrl+E` | Export all sheets |
| `Cmd/Ctrl+N` | New job / clear parts |
| `C` | Center view on canvas |
| `+` / `=` | Zoom in on canvas |
| `-` | Zoom out on canvas |

---

## 13. End-to-End Flows

### 13.1 Import from DXF files

```
1. User drags 20 DXF files onto PartListPanel
      │
      ▼
2. dxf-reader.ts: parseFilename() extracts name/direction/count
   dxf-reader.ts: parseDxfContent() extracts l0Bbox + cutLines
   types.ts: createNestPart() builds NestPart objects
      │  (each file → one NestPart with computed cutWidth/cutHeight)
      │
      ▼
3. User clicks "Pack" button
      │
      ▼
4–8. Same as below
```

### 13.2 Import from project designs

```
1. User clicks "Import from project" in PartListPanel
      │
      ▼
2. Dialog queries Convex designs.listByProject for current project
   Shows designs with name, dimensions, direction badge, count badge
      │
      ▼
3. User selects designs and clicks "Import"
      │
      ▼
4. dxf-reader.ts: createNestPartFromDesign() for each:
      ├─ computeSheetMetalGeometry(model) → regenerate geometry
      ├─ buildDxf(geometry, exportName, model) → full DXF string
      ├─ l0Width = totalWidth - 2*offsetCut, l0Height = totalHeight - 2*offsetCut
      ├─ Extract CUT segments in local coordinates
      ├─ Direction set to null (free rotation for optimal packing)
      └─ Count set from metadataCount (always respected, regardless of includeMetadata)
      │
      ▼
5. User clicks "Pack" → same flow as below
```

### 13.3 Pack and export

```
1. User clicks "Pack" button
      │
      ▼
2. context.tsx: runPacking() → packer.ts: packAllParts()
      │
      ├─ buildItems(): expand NestPart.count into flat PackItem list, sort by area
      ├─ detectPackingMode(): check if Mode A or Mode B
      ├─ Run BSSF/BAF/BLSF packers, keep best result
      ├─ Build SheetLayouts from packed bins
      ├─ computeRepeatCount() per layout
      └─ validateProduction() → warnings
      │
      ▼
3. context.tsx: updates job.layouts, job.status = "done"
      │
      ▼
4. preview-canvas.tsx: renders selected layout on canvas
   sheet-list.tsx: shows layout thumbnails
      │
      ▼
5. User clicks "Export"
      │
      ▼
6. dxf-writer.ts: for each layout:
      ├─ collectAndDeduplicate() transforms CUT lines to sheet space & dedupes
      ├─ writeNestSheetDxf() builds DXF string:
      │   ├── Build Maker.js IModel with sheet frame, per-part sub-models, CUT paths
      │   │   ├── Sheet frame: 4-line rectangles on SHEETS layer
      │   │   ├── Per-part: extractDxfModel() → deep-clone → normalize → rotate/shift → translate
      │   │   └── CUT lines: deduplicated LINE paths on LAYER_CUT
      │   ├── Walk model to collect all used layers → build layerOptions
      │   │   (known layers get specific ACI colors; unknown layers get ACI 30 = orange)
      │   ├── Export via makerjs.exporter.toDXF() with complete layerOptions
      │   ├── Post-process DXF: change unknown layer colors to ACI 30 (orange)
      │   └── Inject TEXT entities before ENDSEC:
      │       ├── Sheet title at top-left (left-aligned, height 50mm)
      │       ├── Per-part name labels at center of L0 bbox (center-aligned, height 20mm)
      │       └── Repetition count at bottom-right (right-aligned, height 80mm)
      │
      └─ jszip: bundles all DXFs into a ZIP and downloads
         Each DXF filename uses format: `{number}_r{repeat}_{mode}_p{parts}_u{util}.dxf`
```

---

## 14. Integration Points

### 14.1 Sheet-Metal → Nesting Bridge

The bridge from saved sheet-metal designs to nesting parts is implemented in `dxf-reader.ts` via two functions:

**`createNestPartFromDesign()`** — the primary bridge:
```typescript
createNestPartFromDesign(
  design: { id, name, exportName, model: SheetMetalModel },
  overrides?: { count?, direction? },
): NestPart
```

This function:
1. Calls `computeSheetMetalGeometry(model)` to regenerate geometry on-the-fly
2. Calls `buildDxf(geometry, exportName, model)` to produce the full DXF content
3. Computes L0 dimensions: `totalWidth - 2 * offsetCut` and `totalHeight - 2 * offsetCut` (subtracting the cut margin to get the nominal part size)
4. Extracts CUT line segments from `geometry.shapes` filtered by `layer === "CUT"`, using absolute coordinates (which are already local-relative-to-L0-origin since the L0 outline starts at `(0, 0)` in the geometry engine)
5. Sets `direction` to `null` (free rotation) — the arrow in the DXF is visual metadata for the operator, not a packing constraint. The nesting algorithm is free to rotate parts for optimal placement. Overrides can still force a direction if needed.
6. Sets `count` from `metadataCount` — always respected regardless of the `includeMetadata` toggle. `includeMetadata` controls the export filename suffix only; the count is always meaningful for nesting (how many copies of this part to pack).
7. Returns a ready-to-use `NestPart` with `source: "sheet-metal"` and `designId` linking back to the Convex design

**Key design decision: No Convex file storage for DXF.** The `SheetMetalModel` is a fully deterministic parametric description — given the same model, `computeSheetMetalGeometry() + buildDxf()` always produces identical output. DXF files are regenerated on-the-fly from the model, which is the single source of truth. This eliminates staleness bugs, storage costs, and sync complexity.

**Coordinate normalization:** In the sheet-metal geometry engine, coordinates use absolute positioning where the L0 outline starts at `(0, 0)`. The CUT layer extends `offsetCut` mm beyond L0 on all sides. For nesting, `l0Width = totalWidth - 2 * offsetCut` and `l0Height = totalHeight - 2 * offsetCut`, and CUT lines are used as-is (they naturally extend beyond the L0 bounding box by `offsetCut` mm on each side). The `l0Bbox` is always `{x0: 0, y0: 0, x1: l0Width, y1: l0Height}`.

For imported DXF files, `parseDxfContent()` normalizes all CUT line coordinates by subtracting `l0Bbox.x0` and `l0Bbox.y0`, and resets `l0Bbox` to `{x0: 0, y0: 0, x1: l0Width, y1: l0Height}`. This ensures a uniform coordinate system regardless of where the originating CAD program placed geometry.

**`createNestPartFromGeometry()`** — the lower-level helper:
```typescript
createNestPartFromGeometry(
  name: string,
  direction: PartDirection,
  count: number,
  l0Width: number,
  l0Height: number,
  cutLines: Segment[],
  designId?: string,
  dxfContent?: string,
): NestPart
```

Used internally by `createNestPartFromDesign()`. Can also be called directly when you have raw geometry dimensions.

**Part List UI:** The `PartListPanel` component includes a "Import from project" button (folder icon) that:
1. Queries Convex `designs.listByProject` for the current project's saved designs
2. Shows a checkbox dialog with each design's name, dimensions, direction badge, and count badge
3. Calls `createNestPartFromDesign()` for each selected design
4. Adds the resulting `NestPart` objects to the nesting job

Sheet-metal sourced parts show a green **SM** badge; custom-DXF imported parts show a blue **DXF** badge.

### 14.2 DXF Export Filename Metadata

The sheet-metal export system supports metadata-suffixed filenames:

- **`includeMetadata`** toggle (in Settings → DXF Export tab)
- **`metadataCount`** field (default 1, min 1)
- **`arrowDirection`** (already existed, now dual-purposed for filename direction)

When enabled, the export filename follows the pattern:
```
<exportName>_<DIR>_x<count>.dxf
```
Where `DIR` maps: `top→T`, `right→R`, `bottom→B`, `left→L`.

Examples:
- `3-2_T_x18.dxf` — name "3-2", direction Top, count 18
- `panel_R_x4.dxf` — name "panel", direction Right, count 4

This matches the nesting filename parser (`parseFilename`) which extracts direction and count from DXF filenames, ensuring round-trip compatibility.

### 14.3 With Python Backend (future)

The frontend nesting output is compatible with `split_sheets.py` and `merge_dxf_files.py`:
- Same layer names: `CUT`, `FREZ`, `FREZ_135`, `HOLES`, `0`, `SHEETS`
- Sheet boundary is exactly 1250×3200mm at origin (0,0)
- CUT lines are on the `CUT` layer (ACI color 3 = green)
- FREZ lines are on the `FREZ` layer (ACI color 6 = magenta)
- FREZ_135 lines are on the `FREZ_135` layer (ACI color 1 = red)
- HOLES are on the `HOLES` layer (ACI color 2 = yellow)
- Layer 0 outlines are white (ACI 7)
- SHEETS layer uses ACI 4 (cyan) in DXF; canvas uses exact RGB(39,118,187)
- Custom/unknown layers default to ACI 30 (orange)
- Sheet title label is on the `SHEETS` layer at top-left
- Per-part name labels are on the `SHEETS` layer at the center of each part's L0 bbox
- Repetition count label is on the `SHEETS` layer at bottom-right below the sheet

### 14.3 Convex Persistence (future)

The `NestJob` type is designed to be serializable. Adding persistence requires:
1. `convex/nesting/schema.ts` — define `nestJobs` table
2. `convex/nesting/mutations.ts` — saveNestJob mutation
3. `convex/nesting/queries.ts` — listByProject, get queries
4. Wire into `context.tsx` similar to `sheet-metal/context.tsx`

---

## 15. Known Limitations & Future Work

| Area | Current State | Future |
|------|--------------|--------|
| Convex persistence | Local state only | Save/load nest jobs to database |
| Sheet-metal import | ✅ `createNestPartFromDesign()` wired via PartListPanel | Polish: refresh design list on project switch |
| Manual repositioning | Not supported | Drag parts on canvas (v2) |
| Formula DSL | Not implemented | Text input for quick part configuration |
| POLYLINE entity | Not parsed in DXF reader | Add VERTEX sub-entity support |
| DXF model extraction | Lines, arcs, circles, LWPOLYLINE (with bulge) | Add SPLINE/ELLIPSE support in extractDxfModel |
| Web Worker packing | Synchronous on main thread | Offload to worker for >500 parts |
| Guillotine cuts | Not implemented | Add as alternative packing algorithm |
| Nesting optimizations | MaxRects only | Add skyline, guillotine-cut algorithms |
| Canvas visualization | ✅ Y-flipped to match DXF export, correct arc direction | |
| DXF per-part labels | ✅ Center-aligned TEXT on SHEETS layer | |
| DXF layer colors | ✅ Production-standard colors with true-color support for SHEETS | |
| Naming format | ✅ `{num}_r{repeat}_{mode}_p{parts}_u{util}%` encoded in filename | |