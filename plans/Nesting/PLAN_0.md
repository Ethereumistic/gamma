# PLAN_0 — Nesting Feature: Implementation Guidelines

**Document version:** v1.0  
**Scope:** Frontend feature that unifies DXF part layouts onto sheet stock using 2D bin-packing. Covers data model, UI architecture, backend integration, and step-by-step implementation tasks.  
**AI Agent Instructions:** Follow this document as the authoritative blueprint. Reference PLAN_01–PLAN_04 for the Python packing algorithm details. Reference the existing `sheet-metal` feature for architectural patterns.

---

## 0. Glossary

| Term | Meaning |
|------|---------|
| **Nesting** | The overall feature — taking multiple DXF parts and arranging them on sheet stock |
| **Nest Job** | A single nesting operation: a collection of input parts → a collection of output sheet layouts |
| **Part** | A single DXF flat-pattern (produced by the sheet-metal feature, or imported) |
| **Sheet** | A physical sheet of material (1250×3200mm ACM panel stock) |
| **Sheet Layout** | A unique arrangement of parts on a single sheet, repeatable N times |
| **CUT bbox** | The outer bounding box of a part including the 3mm offset — the space the part occupies for packing |
| **Mode A** | Standard margin packing (35mm margin, 1180×3130mm usable area) |
| **Mode B** | Full-span centered packing (entire 1250×3200mm sheet, layout centered) |
| **Shared edge dedup** | When two parts are flush, their adjacent CUT lines overlap — we keep one copy |

---

## 1. Architecture Overview

The Nesting feature follows the same patterns as the existing `sheet-metal` feature:

```
Features share:
  • Convex for persistence (schema, queries, mutations)
  • React Context for local state management
  • HTML5 Canvas for interactive preview
  • Formula DSL for text-based interaction
  • Side-editor pattern for configuration panels
```

### 1.1 Module Map

```
src/features/nesting/
├── context.tsx              # NestingProvider + useNesting() hook
├── types.ts                 # NestJob, Part, SheetLayout, Placement, etc.
├── preview-canvas.tsx       # Canvas renderer for sheet layouts
├── formula/                  # Formula DSL for nesting (future)
│   ├── grammar.ts
│   ├── parser.ts
│   ├── serializer.ts
│   └── index.ts
├── packer.ts                 # Client-side MaxRects bin packing (WASM or pure JS)
├── deduplicator.ts           # CUT line segment deduplication
├── dxf-writer.ts             # DXF sheet layout output generation
├── constants.ts              # Sheet dimensions, margins, tolerances
├── hotkeys.tsx               # Keyboard shortcuts
├── part-list.tsx             # Part list panel component
├── sheet-tile.tsx            # Single sheet thumbnail/preview tile
├── export-dialog.tsx         # Export settings & trigger

src/routes/
└── nesting.tsx               # Route component (/nesting)

convex/
└── nesting/                  # Convex backend (if needed for persistence)
    ├── schema.ts
    ├── mutations.ts
    └── queries.ts
```

### 1.2 Data Flow

```
[Part DXF Files] ──► [Parser] ──► [Part[]]
                                      │
                                      ▼
                              [Packer Engine]
                                      │
                                      ▼
                              [SheetLayout[]]
                                      │
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                    [Preview Canvas] [Deduplicator] [DXF Writer]
                          │                           │
                          ▼                           ▼
                    [Interaction]              [.dxf download]
```

---

## 2. Data Model (`types.ts`)

### 2.1 Core Types

```typescript
// --- Constants ---
export const SHEET_WIDTH = 1250;
export const SHEET_HEIGHT = 3200;
export const MARGIN = 35;
export const USABLE_WIDTH = SHEET_WIDTH - 2 * MARGIN;   // 1180
export const USABLE_HEIGHT = SHEET_HEIGHT - 2 * MARGIN;  // 3130
export const CUT_OFFSET = 3;
export const COINCIDENCE_TOL = 0.01;
export const MAX_SHEETS = 200;

// --- Direction & Rotation ---
export type PartDirection = "T" | "B" | "L" | "R" | null;
export type RotationDeg = 0 | 90;
export type PackingMode = "A" | "B";

// --- Part (input) ---
export type PartSource = "sheet-metal" | "custom-dxf";

export type NestPart = {
  id: string;                        // unique per part type
  name: string;                       // e.g. "1335", "corner"
  filename: string;                   // e.g. "1335_B_x50"
  direction: PartDirection;           // T/B/L/R or null
  count: number;                      // required instances
  rotationLocked: boolean;            // true if direction is set
  allowedRotation: RotationDeg | -1;  // 0=upright, 90=rotated, -1=both

  l0Width: number;                    // Layer 0 bounding box width
  l0Height: number;                   // Layer 0 bounding box height
  cutWidth: number;                   // l0Width + 2 * CUT_OFFSET
  cutHeight: number;                  // l0Height + 2 * CUT_OFFSET

  source: PartSource;
  dxfContent?: string;               // Raw DXF string (for custom imports)
  designId?: Id<"designs">;           // Link to Convex design (for sheet-metal parts)

  // Parsed geometry (populated by parser)
  cutLines: Segment[];
  l0Bbox: Rect;
};

// --- Placement (a single part instance on a sheet) ---
export type Placement = {
  partId: string;
  instanceIndex: number;
  packX: number;                      // X in packing space
  packY: number;                      // Y in packing space
  cutWidth: number;                   // Width in packing space (may be swapped if rotated)
  cutHeight: number;                  // Height in packing space
  rotation: RotationDeg;
};

// --- Sheet Layout (output) ---
export type SheetLayout = {
  id: string;
  sheetIndex: number;
  mode: PackingMode;
  placements: Placement[];
  repeatCount: number;
  sheetName: string;
  offsetX: number;                   // Offset from packing→sheet space
  offsetY: number;
  dedupedCutSegments: Segment[];     // After deduplication
};

// --- Segment (line primitive) ---
export type Segment = {
  x1: number; y1: number;
  x2: number; y2: number;
};

// --- Rect ---
export type Rect = {
  x0: number; y0: number;
  x1: number; y1: number;
};

// --- Nest Job (top-level aggregate) ---
export type NestJob = {
  id: string;
  name: string;
  parts: NestPart[];
  layouts: SheetLayout[];
  mode: PackingMode;
  status: "idle" | "packing" | "done" | "error";
  warnings: string[];
  totalSheetsToCut: number;
  createdAt: number;
  updatedAt: number;
};
```

### 2.2 Filename Parser

The filename convention follows PLAN_01:

```typescript
// Patterns:  name_DIR_xCount.dxf  or  name_xCount.dxf
// Examples:  1335_B_x50.dxf  →  { name: "1335", direction: "B", count: 50 }
//            corner_x8.dxf    →  { name: "corner", direction: null, count: 8 }
```

### 2.3 Direction → Rotation Mapping

| Direction | Meaning | `rotationLocked` | `allowedRotation` |
|-----------|---------|-------------------|--------------------|
| T or B | Arrow vertical | `true` | `0` |
| L or R | Arrow horizontal | `true` | `90` |
| null | Free | `false` | `-1` (both) |

---

## 3. Packing Engine (`packer.ts`)

### 3.1 Algorithm: MaxRects Bin Packing

Implement in pure TypeScript (no WASM dependency initially). Use the three variants from PLAN_02:

1. **MaxRects BSSF** — Best Short Side Fit (usually best)
2. **MaxRects BAF** — Best Area Fit
3. **MaxRects BLSF** — Best Long Side Fit

Run all three, keep the result with fewest sheets.

### 3.2 Implementation Strategy

```typescript
// packer.ts — Pure TypeScript implementation

type Bin = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number; rid: string };

class MaxRectsPacker {
  private bins: FreeRect[] = [];
  
  constructor(sheetWidth: number, sheetHeight: number) { ... }
  
  insert(width: number, height: number, rid: string, allowRotation: boolean): Rect | null { ... }
  
  private findPosition(w: number, h: number, allowRotation: boolean): BestCandidate { ... }
  
  private splitFreeRect(free: FreeRect, placed: Rect): void { ... }
}
```

Port the Python `rectpack` logic faithfully. The algorithm is:

1. Maintain a list of free rectangles (initially one per bin = full sheet)
2. For each item (sorted by area descending):
   a. Find the best free rectangle using the scoring heuristic
   b. Place the item there
   c. Split all free rectangles that overlap with the placed item
   d. Prune free rectangles contained within others
3. Return placements + sheet count

### 3.3 Packing Modes

| Mode | When | Usable area | Placement start |
|------|------|-------------|-----------------|
| A | All parts fit within 1180×3130 | 1180×3130mm | Bottom-left at (35,35) |
| B | Any part or pair exceeds Mode A limits | 1250×3200mm | Centered on sheet |

Mode detection: check after parsing all parts. A single part with `cutWidth > 1180` or `cutHeight > 3130` triggers Mode B. Also check if any pair of CUT widths or heights would span the full sheet.

### 3.4 Repeat Count Computation

For each sheet layout:

```
instance_counts = count how many times each part type appears on this sheet
repeat_needed = ceil(part.count / instance_counts[part.id]) for each part type
sheet_repeat = min(repeat_needed) across all part types on this sheet
```

The bottleneck part determines repetition. Over-production of other parts is acceptable waste.

---

## 4. CUT Line Deduplication (`deduplicator.ts`)

### 4.1 Algorithm

Two CUT segments are coincident when:
1. They are collinear (cross product of direction vectors < tolerance)
2. Their 1D projections along the shared axis overlap (not just touch at a point)

Coincident segments are merged into one spanning the union of both projections.

### 4.2 Implementation

Use a spatial index (R-tree or simple bounding-box pre-filter) for O(n log n) average case. For a typical sheet (50-200 segments), even O(n²) is acceptable (<10ms).

```typescript
function deduplicateCutSegments(segments: Segment[]): Segment[] {
  // 1. Filter zero-length segments
  // 2. For each unprocessed segment, find candidates via spatial pre-filter
  // 3. Check collinearity and overlap
  // 4. Merge coincident pairs, mark consumed
  // 5. Return deduplicated list
}
```

### 4.3 Rotation Handling

When a part is rotated 90°, its CUT segments must be transformed before deduplication:

```
If rotation === 0: segment stays as-is
If rotation === 90: (x, y) → (-y, x) relative to insert point
```

The coordinate transform is: for a segment from the part's local space at insert point `(ix, iy)`:
- **0° rotation:** `sheet_x = ix + local_x + CUT_OFFSET`, `sheet_y = iy + local_y + CUT_OFFSET`
- **90° rotation:** `sheet_x = ix - local_y + CUT_OFFSET`, `sheet_y = iy + local_x + CUT_OFFSET`

---

## 5. DXF Writer (`dxf-writer.ts`)

### 5.1 Output Structure

For each `SheetLayout`, produce one `.dxf` file containing:
1. **SHEETS layer:** Outer 1250×3200 rectangle + inner margin rectangle (Mode A) or centering guides (Mode B)
2. **CUT layer:** Deduplicated line segments (NOT block inserts — directly as LINE entities)
3. **All other layers:** Via block inserts per part (preserves FREZ, HOLES, Layer 0)
4. **Label:** TEXT entity above sheet boundary with format `sheetName_xN`

### 5.2 Library Choice

**Do NOT use `makerjs`** (it's for the sheet-metal generator which produces line-segment geometry).  
**Use the existing frontend DXF approach** — but enhanced for nesting: use `makerjs` for the CUT and SHEETS layers, and create DXF block definitions for each part.

However, for the nesting output, you'll need a library that supports DXF block definitions and inserts. Options:
- **`dxf-writer`** (npm) — lightweight, supports blocks and inserts
- **Custom DXF generation** — build the string manually (as the existing `dxf.ts` does for sheet-metal)

**Recommendation:** Use the same approach as the existing `dxf.ts` — extend it to support block definitions and INSERT entities, or generate the nesting DXF manually following the DXF specification for BLOCKS and INSERT sections.

### 5.3 Layer Colors

| Layer | ACI Color | Purpose |
|-------|-----------|---------|
| `SHEETS` | 7 (white) | Sheet boundary + margin rect |
| `CUT` | 1 (red) | Deduplicated cut lines |
| `0` | 7 (white) | Part outlines (Layer 0 from input) |
| `FREZ` | 6 (magenta) | Bend/groove lines |
| `FREZ_135` | 4 (cyan) | 135° FREZ lines |
| `HOLES` | 5 (blue) | Hole markings |

---

## 6. Context & State (`context.tsx`)

### 6.1 NestingProvider

Follow the pattern from `sheet-metal/context.tsx`:

```typescript
type NestingContextType = {
  // Job state
  job: NestJob;
  setJobName: (name: string) => void;
  
  // Part management
  addPart: (part: NestPart) => void;
  removePart: (partId: string) => void;
  updatePartCount: (partId: string, count: number) => void;
  importPartsFromDesigns: (designIds: Id<"designs">[]) => Promise<void>;
  importPartsFromFiles: (files: File[]) => Promise<void>;
  
  // Packing
  runPacking: () => void;
  cancelPacking: () => void;
  
  // Export
  exportSheet: (layoutId: string) => void;
  exportAllSheets: () => void;
  
  // Persistence
  saveJob: () => Promise<Id<"nestJobs"> | null>;
  loadJob: (id: Id<"nestJobs">) => void;
  savedJobs: NestJobSummary[];
  isSaving: boolean;
  
  // Computed
  selectedSheetIndex: number | null;
  setSelectedSheet: (index: number | null) => void;
  totalMaterialUsed: number;      // percentage
  totalSheetsToCut: number;
  productionWarnings: string[];
};
```

### 6.2 State Shape

```typescript
const [job, setJob] = useState<NestJob>(createEmptyNestJob());
const [selectedSheetIndex, setSelectedSheetIndex] = useState<number | null>(null);
const [packingAborted, setPackingAborted] = useState(false);
```

### 6.3 Packing Lifecycle

```
[Add parts] → [Configure] → [Run packing] → [Review layouts] → [Export]
       ↑              ↑            │                  │               │
       └──────────────┴────────────┴──────────────────┴───────────────┘
                          (user can re-configure and re-pack at any time)
```

Packing runs synchronously on the main thread (for <200 parts it's <100ms). No web worker needed initially, but the context should be structured to support async packing in the future.

---

## 7. UI Components

### 7.1 Route: `/nesting`

```
┌────────────────────────────────────────────────────────────────────┐
│ ◀ Nesting Toolbar: [Job Name] [Run Pack] [Export All] [Save]    │
├──────────┬────────────────────────────────────────┬────────────────┤
│          │                                        │                │
│  Parts   │     Sheet Preview Canvas               │  Sheet List    │
│  Panel   │     (selected sheet layout)            │  Panel         │
│          │                                        │                │
│  ┌─────┐ │  ┌──────────────────────────────┐     │  ┌──────────┐ │
│  │Part1│ │  │  ┌─────┐  ┌─────┐            │     │  │Sheet 1   │ │
│  │x50  │ │  │  │Part A│  │Part B│           │     │  │x11 times │ │
│  └─────┘ │  │  └─────┘  └─────┘           │     │  │88% util  │ │
│  ┌─────┐ │  │         ┌──────────┐        │     │  ├──────────┤ │
│  │Part2│ │  │         │ Part C   │        │     │  │Sheet 2   │ │
│  │x8   │ │  │         └──────────┘        │     │  │x4 times  │ │
│  └─────┘ │  │                              │     │  │76% util  │ │
│          │  └──────────────────────────────┘     │  └──────────┘ │
│  [+Import]│                                     │                │
├──────────┴────────────────────────────────────────┴────────────────┤
│ Status: 2 layouts | 15 sheets total | 87% material utilization    │
└───────────────────────────────────────────────────────────────────┘
```

### 7.2 Component Breakdown

| Component | Purpose |
|-----------|---------|
| `NestingToolbar` | Top navbar: job name, run button, export, save |
| `PartListPanel` | Left sidebar: add/remove parts, configure counts/directions |
| `SheetPreviewCanvas` | Center: interactive canvas showing selected sheet layout |
| `SheetListPanel` | Right sidebar: list of layouts with repeat counts |
| `ExportDialog` | Modal for export settings |
| `ImportDialog` | Modal for importing parts from designs or DXF files |

### 7.3 Preview Canvas

Follow the pattern from `sheet-metal/preview-canvas.tsx`:
- Use HTML5 Canvas for rendering
- Pan/zoom with mouse drag + wheel
- Color-coded layers: CUT (red), FREZ (magenta), HOLES (blue), Layer 0 (white)
- Highlight selected placement on click
- Show sheet boundary and margin guides

### 7.4 Interaction

- Click on a part in the parts list → highlight on canvas
- Click on a sheet in the sheet list → render that sheet
- Drag a part on canvas → reposition (stretch goal, not v1)
- Keyboard shortcuts: `Mod+P` to run packing, `Mod+E` to export

---

## 8. Backend Integration (Convex)

### 8.1 Schema Additions

```typescript
// convex/nesting/schema.ts
nestJobs: defineTable({
  name: v.string(),
  projectId: v.id("projects"),
  parts: v.any(),        // serialized NestPart[]
  layouts: v.any(),      // serialized SheetLayout[]
  mode: v.string(),     // "A" | "B"
  totalSheetsToCut: v.number(),
  warnings: v.array(v.string()),
  exportName: v.string(),
}).index("byProject", ["projectId"]),
```

### 8.2 Importing Parts from Sheet-Metal Designs

The key integration point: a user creates designs in the sheet-metal feature, then imports them into the nesting feature as parts.

```typescript
async function importPartsFromDesigns(designIds: Id<"designs">[]): Promise<void> {
  const designs = await Promise.all(
    designIds.map(id => ctx.runQuery(api.designs.get, { id }))
  );
  
  for (const design of designs) {
    const geometry = computeSheetMetalGeometry(design.model);
    const dxfContent = buildDxf(geometry, design.name, design.model);
    const part = createNestPartFromDesign(design, dxfContent);
    addPart(part);
  }
}
```

### 8.3 Part DXF Parsing

For imported DXF files (not from sheet-metal), parse in the browser:
- Use a lightweight DXF parser (or port the Python parser from PLAN_01)
- Extract Layer 0 bbox and CUT layer line segments
- Support `LINE`, `LWPOLYLINE`, `ARC`, `CIRCLE`, `SPLINE` entity types

**Consideration:** DXF parsing in the browser can be slow for large files. Use a Web Worker for files > 1MB.

---

## 9. Implementation Order (Tasks)

Each task is a self-contained unit of work that can be tested independently.

### Phase 1: Foundation (Tasks 1–5)

**Task 1: Create `types.ts`**  
- Define all types from Section 2
- Create `createEmptyNestJob()`, `normalizeNestJob()`, and filename parser helpers
- Write unit tests for filename parsing

**Task 2: Create `constants.ts`**  
- Sheet dimensions, margins, offsets, tolerances
- Layer name/color mappings
- Export all constants as named exports

**Task 3: Create `packer.ts`**  
- Implement `MaxRectsPacker` class with BSSF, BAF, BLSF heuristics
- Implement `packAllParts()` entry function
- Implement `detectPackingMode()`
- Implement `computeRepeatCount()` and `validateProduction()`
- Write unit tests with known part configurations

**Task 4: Create `deduplicator.ts`**  
- Implement segment collinearity check (`areCollinear`)
- Implement 1D overlap check (`overlap1D`)
- Implement `deduplicateCutSegments()`
- Write unit tests with overlapping/non-overlapping segments

**Task 5: Create `context.tsx`**  
- `NestingProvider` with all state from Section 6
- `useNesting()` hook
- Part management functions (add, remove, update count)
- Placeholder `runPacking()` that calls the packer

### Phase 2: DXF & Export (Tasks 6–8)

**Task 6: Create `dxf-writer.ts`**  
- DXF string builder that produces valid R2010 DXF files
- Support for: LINE entities, LWPOLYLINE for sheet frames, TEXT for labels, INSERT for block references, BLOCK definitions
- Function: `writeNestSheetDxf(layout: SheetLayout, parts: NestPart[]): string`
- Support for Mode A and Mode B sheet frames

**Task 7: Create `dxf-reader.ts`**  
- Browser-side DXF parser for extracting bbox and CUT lines
- Parse LINE, LWPOLYLINE, ARC, CIRCLE entities from modelspace
- Extract Layer 0 bounding box and CUT layer segments
- Write unit tests with sample DXF strings

**Task 8: Create export infrastructure**  
- Wire up DXF download (Blob + URL.createObjectURL)
- Export settings dialog (sheet naming convention, include labels toggle)
- Batch export all sheets as individual DXF files (ZIP archive using `fflate` or `jszip`)

### Phase 3: UI (Tasks 9–14)

**Task 9: Create route `/nesting`**  
- Route component with `NestingProvider`
- Layout: 3-column grid (parts | canvas | sheets)
- Navbar integration via `NestingToolbar`

**Task 10: Create `NestingToolbar`**  
- Job name input
- "Run Packing" button (calls `runPacking()`)
- "Export All" button
- "Save" button
- Formula input (future: `500x3200 WF60 Q E` format for quick sheet config)

**Task 11: Create `PartListPanel`**  
- List of parts with: name, direction badge, count input, CUT dimensions, remove button
- "Import from Designs" button (opens design picker modal)
- "Import DXF" button (file input)
- Drag reorder (stretch goal)

**Task 12: Create `SheetListPanel`**  
- List of sheet layouts with thumbnails
- Each tile shows: sheet name, repeat count, material utilization percentage
- Click to select → updates preview canvas
- Visual indicator of packing mode (A/B)

**Task 13: Create `SheetPreviewCanvas`**  
- HTML5 Canvas rendering of selected sheet layout
- Pan/zoom (mouse drag + wheel)
- Color-coded layers matching sheet-metal conventions
- Sheet boundary and margin guides
- Part labels (name + instance index)
- Highlight on hover/click

**Task 14: Create `preview-canvas.tsx`**  
- Extract canvas rendering logic into reusable functions
- Render: sheet boundary (SHEETS layer), margin rect, placed parts (CUT outlines), block inserts for FREZ/HOLES
- Coordinate transform: packing space → canvas space
- Support for Mode A and Mode B positioning

### Phase 4: Integration & Polish (Tasks 15–19)

**Task 15: Import from Sheet-Metal**  
- Design picker modal: shows saved designs from current project
- Multi-select → import as parts
- Auto-generate filename from design name + direction arrows
- Populate `dxfContent` from `buildDxf()`

**Task 16: Convex persistence**  
- `nestJobs` table in Convex schema
- `saveNestJob` mutation
- `listNestJobs` query (by project)
- `loadNestJob` — deserialize from Convex into local state

**Task 17: Hotkeys**  
- `Mod+P` — Run packing
- `Mod+E` — Export all sheets
- `Mod+S` — Save job
- `Mod+N` — New job
- `1-9` — Select sheet by index

**Task 18: Packing report**  
- Text summary shown in UI
- Total sheets, material utilization, per-part production counts
- Warning display for under/over-production
- Export report as `.txt`

**Task 19: Formula DSL for nesting** (stretch goal)  
- Extend the formula system to support nesting expressions
- Example: `1250x3200 AF60W25 x50 BF120S25 x8 Z20Q20` → parts + packing
- Allow quick editing of part counts and directions

---

## 10. Key Design Decisions

### 10.1 Client-Side Packing (No Backend Required for Core)

The packing algorithm runs entirely in the browser. For <200 parts (typical facade work), MaxRects runs in <100ms. No backend round-trip needed for the core nesting operation.

**Rationale:** Instant feedback loop. The user adds parts, tweaks counts, hits "Pack", and immediately sees results. The Python backend (`autopacker/`) exists for batch processing and CNC integration, but the frontend must work standalone.

### 10.2 Parts as DXF, Not Geometry Objects

Parts are stored as raw DXF strings (or design references). When packing, we extract only the bbox and CUT lines. This means:
- Parts from sheet-metal designs are generated fresh from the model
- Imported DXF files are parsed once on import

**Rationale:** Keeps the nesting feature decoupled from the sheet-metal geometry engine. A part is just a DXF file with metadata.

### 10.3 No Drag-and-Drop Repositioning (v1)

The packer algorithm determines placement. Drag-to-reposition is a v2 feature. In v1, the user re-runs packing after changing part configuration.

**Rationale:** Drag-and-drop placement introduces significant complexity (collision detection, re-optimization, undo) that delays v1 delivery.

### 10.4 Separate DXF Per Sheet

Each sheet layout is exported as its own DXF file. Multi-sheet export creates a ZIP archive.

**Rationale:** Matches CNC workflow — each sheet is cut individually.

### 10.5 CUT Layer Deduplication is a Post-Processing Step

Dedup happens after packing, before DXF output. It's not part of the packer itself.

**Rationale:** The packer only needs rectangles. Dedup is a geometric operation on line segments that depends on exact placement positions.

---

## 11. Compatibility with Python Backend

The Python `autopacker/` pipeline (PLAN_01–PLAN_04) is a separate CLI tool for batch processing. The frontend nesting feature must produce output compatible with the Python backend's `split_sheets.py`.

**Key compatibility points:**
- DXF output uses the same layer names: `CUT`, `FREZ`, `FREZ_135`, `HOLES`, `0`, `SHEETS`
- Sheet boundary is exactly 1250×3200mm at origin (0,0)
- CUT lines are on the `CUT` layer (ACI color 1 = red)
- Labels are on the `SHEETS` layer above the sheet boundary
- Parts that span the width get Mode B treatment (full sheet, centered)

The frontend nesting feature and the Python `autopacker` can interoperate: a user can export a nesting layout from the frontend, and the Python backend can process it further (e.g., CNC toolpath generation).

---

## 12. Testing Strategy

### Unit Tests

| Module | Test | Description |
|--------|------|-------------|
| `types.ts` | Filename parser | Parse `1335_B_x50.dxf`, `corner_x8.dxf`, invalid patterns |
| `types.ts` | Direction mapping | T/B → 0°, L/R → 90°, null → both |
| `types.ts` | CUT bbox calc | Verify `cutWidth = l0Width + 2 * CUT_OFFSET` |
| `packer.ts` | Simple packing | 3 parts into 1 sheet, verify placements and bounds |
| `packer.ts` | Mode detection | Single wide part → Mode B |
| `packer.ts` | Rotation locking | T-direction part stays upright |
| `packer.ts` | Repeat count | 2 parts, one appears 2× on sheet, other 1× → repeat = min(25, 8) |
| `packer.ts` | Over-production warning | Total produced > required |
| `deduplicator.ts` | Collinear detection | Horizontal, vertical, diagonal segments |
| `deduplicator.ts` | Overlap merge | Two overlapping horizontals → one spanning both |
| `deduplicator.ts` | No dedup needed | Disjoint segments remain separate |
| `dxf-writer.ts` | Valid DXF output | Output opens in AutoCAD/LibrecAD without errors |
| `dxf-reader.ts` | Parse LINE entities | Extract bbox and CUT lines from minimal DXF |

### Integration Tests

| Test | Description |
|------|-------------|
| Round-trip: Sheet-Metal → Packing → DXF | Create a design, import as part, pack, export DXF, verify in viewer |
| Multiple parts | 5–10 parts with mixed directions, verify placement |
| Full sheet | Parts that fill the entire 1250mm width → Mode B |
| Export ZIP | Multiple sheets → ZIP download with correct filenames |

---

## 13. File Size & Performance Budget

| Operation | Target | Max |
|-----------|--------|-----|
| Parse 50 DXF parts | < 500ms | 2s |
| Pack 200 instances | < 100ms | 500ms |
| Deduplicate 500 segments | < 20ms | 100ms |
| Generate 1 DXF sheet | < 200ms | 1s |
| Render 1 sheet on canvas (60fps) | < 16ms | 33ms |

---

## 14. Relationship to Existing Code

### Sheet-Metal Feature Integration

- `importPartsFromDesigns()` calls `computeSheetMetalGeometry()` and `buildDxf()` from the sheet-metal feature
- Part DXF content is generated at import time, not re-generated at export time
- The nesting feature does NOT modify sheet-metal designs — it reads them as inputs

### Convex Integration

- Nesting jobs are persisted in a separate `nestJobs` table
- Each job references a project (same pattern as `designs` table)
- Part DXF content is stored inline (Base64-encoded) for custom imports, or as a design reference for sheet-metal parts

### Navbar Integration

- Add a `/nesting` route to the sidebar navigation
- The nesting toolbar follows the same pattern as `SheetMetalToolbar`
- Use `NestingProvider` context in the route component

---

## 15. Naming Conventions

| Concept | Code Name | UI Label |
|---------|-----------|----------|
| Nesting job | `NestJob` | "Nesting Job" |
| A single part | `NestPart` | "Part" |
| A placed instance | `Placement` | "Instance" |
| A sheet layout | `SheetLayout` | "Sheet Layout" |
| Packing run | `packAllParts()` | "Pack" or "Run Packing" |
| DXF export | `writeNestSheetDxf()` | "Export DXF" |
| Mode A (margin) | `mode: "A"` | "Standard Margin" |
| Mode B (full-span) | `mode: "B"` | "Full Span / Centered" |

---

*This document serves as the authoritative blueprint for implementing the Nesting feature. Reference PLAN_01–PLAN_04 for the Python packing algorithm details. Reference the existing `sheet-metal` feature for React/Convex/Canvas architectural patterns.*