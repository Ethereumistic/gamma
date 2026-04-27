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
├── dxf-writer.ts         Generates R2000 DXF strings from SheetLayouts
├── dxf-reader.ts          Parses imported DXF files → bbox + CUT segments
│                         + createNestPartFromDesign() bridge from sheet-metal
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

Placement ── one part instance on a sheet
  partId, instanceIndex         references back to the part
  packX, packY                 position in packing space
  packWidth, packHeight        dimensions in packing space
  rotation: 0|90

SheetLayout ── one unique arrangement on a sheet
  sheetIndex: number
  mode: "A"|"B"                A=margin, B=full-span centered
  placements: Placement[]
  repeatCount: number          how many times to cut this exact sheet
  sheetName: string            e.g. "sheet_001_1335"
  offsetX, offsetY: number     packing→sheet coordinate offset
  dedupedCutSegments: Segment[] filled after deduplication

NestJob ── top-level state object
  id, name: string
  parts: NestPart[]             the input parts
  layouts: SheetLayout[]        the output layouts (populated after packing)
  mode: "A"|"B"
  status: "idle"|"packing"|"done"|"error"
  warnings: string[]
  totalSheetsToCut: number
```

### 3.2 Geometric Primitives

```typescript
type Segment = { x1, y1, x2, y2: number }  // a line segment
type Rect = { x0, y0, x1, y1: number }      // axis-aligned bounding box
```

### 3.3 Coordinate Spaces

There are **three** coordinate systems. Keeping them distinct is critical:

| Space | Origin | What lives here |
|-------|--------|-----------------|
| **Part-local** | Bottom-left of Layer 0 bbox | CUT segments, Layer 0 geometry |
| **Packing space** | (0,0) = bottom-left of usable bin area | MaxRects placements |
| **Sheet space** | (0,0) = bottom-left of the physical 1250×3200 sheet | DXF output |

Transforms:
- **Mode A Packing → Sheet:** `sheet_x = pack_x + 35`, `sheet_y = pack_y + 35`
- **Mode B Packing → Sheet:** `sheet_x = pack_x + offset_x`, `sheet_y = pack_y + offset_y` (centering computed per-layout)
- **Part-local → Sheet (0°):** `sheet_x = insert_x + local_x`, `sheet_y = insert_y + local_y`
- **Part-local → Sheet (90°):** `sheet_x = insert_x - local_y`, `sheet_y = insert_y + local_x`

Where `insert_x = pack_x + offset_x + CUT_OFFSET` and `insert_y = pack_y + offset_y + CUT_OFFSET`.

---

## 4. Constants (from `constants.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `SHEET_WIDTH` | 1250 | Physical sheet width in mm |
| `SHEET_HEIGHT` | 3200 | Physical sheet height in mm |
| `MARGIN` | 35 | Margin for Mode A placement |
| `USABLE_WIDTH` | 1180 | Sheet width minus 2×margin |
| `USABLE_HEIGHT` | 3130 | Sheet height minus 2×margin |
| `CUT_OFFSET` | 3 | CUT layer offset outward from Layer 0 |
| `COINCIDENCE_TOL` | 0.01 | Dedup tolerance in mm |
| `MAX_SHEETS` | 200 | Maximum bins the packer opens |

DXF layers and their ACI color codes:
- `CUT` → 1 (red)
- `0` → 7 (white/black)
- `FREZ` → 6 (magenta)
- `FREZ_135` → 4 (cyan)
- `HOLES` → 5 (blue)
- `SHEETS` → 7 (white/black)

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
      │   - Compute centering offset (Mode B) or margin offset (Mode A)
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

### 6.4 Rotation Handling

- `allowedRotation === 0` → dimensions are `cutWidth × cutHeight` (upright only)
- `allowedRotation === 90` → dimensions are `cutHeight × cutWidth` (pre-rotated)
- `allowedRotation === -1` → both orientations tried; if packer swaps w↔h, `rotation` is set to `90`

### 6.5 Repeat Count Computation

For each sheet layout:
```
For each part type on this sheet:
    instances_on_sheet = count of that part's placements on this sheet
    repeats_needed = ceil(total_required / instances_on_sheet)

sheet.repeat_count = min(repeats_needed across all part types on this sheet)
```

The **bottleneck part** (the one that requires the most repeats) determines how many times the sheet is cut. Over-production of other parts is acceptable waste.

### 6.6 Mode B Centering

After all items are placed in Mode B, the packer computes:
```
layout_w = max(pack_x + pack_width) across all placements
layout_h = max(pack_y + pack_height) across all placements
offset_x = (1250 - layout_w) / 2
offset_y = (3200 - layout_h) / 2
```

This gives equal margins on left/right and top/bottom, centering the layout on the sheet.

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
    ┌─────────────────────────────────┐
    │ Transform CUT segments from     │
    │ part-local → sheet space:       │
    │ • 0° rotation: translate        │
    │ • 90° rotation: rotate+translate│
    └─────────────────────────────────┘
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

```
90° rotation around insert point:
  sheet_x = insert_x - local_y
  sheet_y = insert_y + local_x

Where:
  insert_x = pack_x + offset_x + CUT_OFFSET
  insert_y = pack_y + offset_y + CUT_OFFSET
```

---

## 8. DXF Writer (from `dxf-writer.ts`)

### 8.1 Output Structure

Each `SheetLayout` produces one `.dxf` file containing:

1. **HEADER section** — R2000 version (`AC1015`), mm units, extents, `$HANDSEED`
2. **CLASSES section** — Empty but required for R2000+ compatibility
3. **TABLES section** — VPORT, LTYPE, LAYER, STYLE, APPID, BLOCK_RECORD tables (all with proper handles and subclass markers)
4. **BLOCKS section** — `*Model_Space`, `*Paper_Space` (required by R2000), and one block per part type (non-CUT geometry only)
5. **ENTITIES section** — Sheet frame + block inserts + deduplicated CUT lines + label text
6. **OBJECTS section** — Root dictionary (required by R2000)

### 8.2 Key Design Decision

**CUT lines are written directly as LINE entities, NOT via block inserts.** This is what enables deduplication — shared edges become single LINE entities. All other geometry (Layer 0 outlines, FREZ, HOLES) goes through block INSERT references.

Only parts that have block definitions (`blockDxfContent` or `source === "sheet-metal"`) get INSERT entities. Parts without block definitions do NOT get INSERT references — this avoids referencing non-existent blocks which would make the DXF invalid.

### 8.3 DXF Construction

The writer builds a DXF string using a `DxfBuilder` class that emits group-code/value pairs. The builder tracks a monotonically increasing **handle counter** (starting at `0x100`) and emits a unique handle (group code 5) for every entity, table record, block, and dictionary object. No external DXF library is used for output — the format follows the DXF R2000 specification. Line endings use CRLF (`\r\n`) per the DXF standard.

### 8.4 AutoCAD Compatibility Requirements

DXF files generated by this writer **must** follow these rules for AutoCAD compatibility:

1. **Every entity, table record, block, and dictionary has a unique handle (group code 5)** — R2000 requires handles for all objects. Without handles, AutoCAD cannot build its internal object model and rejects the file as invalid.

2. **`$HANDSEED` in HEADER** — The `$HANDSEED` variable tells AutoCAD the next available handle number. Required for R2000.

3. **CLASSES section is present** (even if empty) — R2000+ requires it. Without it, AutoCAD shows a black screen and crashes.

4. **OBJECTS section is present** — R2000 requires an OBJECTS section with at least a root DICTIONARY object. Without it, AutoCAD rejects the file.

5. **Required tables: VPORT, LTYPE, LAYER, STYLE, APPID, BLOCK_RECORD** — R2000 expects all of these. The STYLE table must include a "Standard" text style (for TEXT entities). The APPID table must include "ACAD". The BLOCK_RECORD table must include entries for `*Model_Space`, `*Paper_Space`, and each user-defined block.

6. **Table entries have proper subclass markers and handles** — Each table header needs `5 <handle>` and `100 AcDbSymbolTable`. Each table record needs `5 <handle>`, `100 AcDbSymbolTableRecord`, and the appropriate subclass (e.g., `100 AcDbLinetypeTableRecord`).

7. **`*Model_Space` and `*Paper_Space` blocks** — R2000 requires these block definitions in the BLOCKS section.

8. **All entities have `100` subclass markers** — Each entity must have:
   - `100 AcDbEntity` followed by layer (`8`) and optional color (`62`)
   - `100 AcDbLine` / `100 AcDbPolyline` / `100 AcDbText` / `100 AcDbBlockReference` / `100 AcDbBlockBegin` / `100 AcDbBlockEnd` with the entity-specific groups

   Without these markers, AutoCAD rejects the entity silently.

9. **Entity color (62) comes before entity-specific groups** — Group 62 must be in the `AcDbEntity` subclass, not after coordinate groups.

10. **LWPOLYLINE vertex groups are ordered correctly** — Group 90 (vertex count), then 70 (closed flag), then 10/20 pairs for each vertex.

11. **BLOCK/ENDBLK entities have handles and subclass markers** — Both need `5 <handle>`, `100 AcDbEntity`, and `100 AcDbBlockBegin`/`100 AcDbBlockEnd`. The group code `2` (block name) and `8` (layer) must appear AFTER the `100 AcDbEntity` subclass marker, not before it.

12. **No orphaned INSERT references** — INSERT entities must only reference blocks that exist in the BLOCKS section. Parts without block definitions must not generate INSERT entities.

### 8.5 Sheet Frame Drawing

**Mode A:**
- Outer 1250×3200 rectangle on SHEETS layer
- Inner 1180×3130 dashed margin rectangle on SHEETS layer

**Mode B:**
- Outer 1250×3200 rectangle
- Inner dashed rectangle around the centered layout (computed from `offset_x`, `offset_y`, layout_w, layout_h)

### 8.6 Export Functions

- `writeNestSheetDxf(layout, parts)` → returns DXF string
- `downloadDxf(content, filename)` → triggers browser download
- `exportAllSheetsAsZip(layouts, parts)` → creates ZIP of all DXF files using JSZip

---

## 9. DXF Reader (from `dxf-reader.ts`)

### 9.1 Purpose

When the user imports a DXF file, we need to:
1. Extract the **Layer 0 bounding box** (to know the part dimensions)
2. Extract **CUT layer line segments** (for deduplication during output)

### 9.2 Entity Support

| Entity Type | Bbox Extraction | Segment Extraction |
|-------------|----------------|-------------------|
| LINE | ✅ | ✅ |
| LWPOLYLINE | ✅ | ✅ (vertices + closed) |
| ARC | ✅ (bounding box) | ✅ (64-division arc) |
| CIRCLE | ✅ (bounding box) | ✅ (64-division circle) |
| SPLINE | ✅ (control points) | ✅ (between control points) |
| ELLIPSE | ✅ (bounding box) | ✅ (64-division) |
| POLYLINE | ❌ | ❌ (not yet) |

### 9.3 Critical Implementation Detail

DXF stores LWPOLYLINE vertices as **multiple group code 10/20 pairs** within a single entity. A naive `Map<number, value>` would clobber all but the last vertex. The parser uses an **ordered array of code/value pairs** (`entity.pairs`) alongside a `firstValue` map, with a `getAllValues(entity, code)` helper to correctly collect all values for repeated group codes.

### 9.4 Fallback Behavior

If the DXF cannot be parsed (binary DXF, unsupported entities, etc.), the reader falls back to **placeholder dimensions (500×500mm)** so the part still appears in the UI and the user can proceed. A console warning is emitted.

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
  runPacking,                 // triggers packer → updates job.layouts
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
- Color-coded layers (CUT=red, Layer 0=white, sheet border=gray, labels=amber)
- Shows sheet boundary, margin guides (dashed), placed parts with labels
- Mode A: 35mm margin rectangle; Mode B: centered guide rectangle
- Uses `react-zoom-pan-pinch` style manual pan/zoom (implemented via refs)

### 11.4 Sheet List Panel

- Lists all layouts with thumbnail info
- Each card shows: sheet name, repeat count, utilization %, mode badge
- Click to select → updates the preview canvas
- Export button per layout

### 11.5 Export Dialog

- Shows number of layouts and total sheets to cut
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
      ├─ Set direction from metadata (or arrowDirection with side-key mapping)
      └─ Set count from metadata (or default 1)
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
      │   ├── Header (AC1015, units, extents, $HANDSEED)
      │   ├── Classes (empty, but required for R2000+)
      │   ├── Tables (VPORT, LTYPE, LAYER, STYLE, APPID, BLOCK_RECORD — all with handles & subclass markers)
      │   ├── Blocks (*Model_Space, *Paper_Space, + one per part with non-CUT geometry)
      │   ├── Entities:
      │   │   ├── Sheet frame (SHEETS layer LWPOLYLINE)
      │   │   ├── Block INSERTs (only for parts with block definitions)
      │   │   ├── Deduplicated CUT LINEs
      │   │   └── Label TEXT
      │   └── Objects (root DICTIONARY, required for R2000)
      │
      └─ jszip: bundles all DXFs into a ZIP and downloads
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
4. Extracts CUT line segments in local coordinates (L0 outline starts at origin `(0,0)` in the geometry coordinate system)
5. Reads `includeMetadata`, `arrowDirection`, and `metadataCount` from the design model to set `direction` and `count`
6. Returns a ready-to-use `NestPart` with `source: "sheet-metal"` and `designId` linking back to the Convex design

**Key design decision: No Convex file storage for DXF.** The `SheetMetalModel` is a fully deterministic parametric description — given the same model, `computeSheetMetalGeometry() + buildDxf()` always produces identical output. DXF files are regenerated on-the-fly from the model, which is the single source of truth. This eliminates staleness bugs, storage costs, and sync complexity.

**Coordinate normalization:** In the sheet-metal geometry engine, coordinates use absolute positioning where the L0 outline starts at `(0, 0)`. The CUT layer extends `offsetCut` mm beyond L0 on all sides. For nesting, `l0Width = totalWidth - 2 * offsetCut` and `l0Height = totalHeight - 2 * offsetCut`, and CUT lines are used as-is (they naturally extend beyond the L0 bounding box by `offsetCut` mm on each side).

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
- CUT lines are on the `CUT` layer (ACI color 1 = red)
- Labels are on the `SHEETS` layer above the sheet boundary

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
| Block definitions in output | Writes simplified Layer-0 rectangles | Parse full DXF blocks from imported files |
| Web Worker packing | Synchronous on main thread | Offload to worker for >500 parts |
| Guillotine cuts | Not implemented | Add as alternative packing algorithm |
| Nesting optimizations | MaxRects only | Add skyline, guillotine-cut algorithms |