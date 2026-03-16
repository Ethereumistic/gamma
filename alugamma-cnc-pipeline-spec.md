# AluGamma CNC Pipeline — Foundational Specification

**Version:** 0.1 — Draft

**Status:** Specification / Pre-implementation

**Scope:** Full replacement of PowerMill 2024 + DuctPost + `process_tap_files_tools.py` with a standalone pipeline that takes DXF files as input and produces validated Fanuc-compatible `.nc` files as output.

---

## 1. Executive Summary

The current workflow requires a human operator to spend **≥8 minutes per program** inside PowerMill performing a deterministic, fully repeatable sequence of steps. Every variable in the process is already known at the time the DXF file is produced by AluGamma:

- Which layers exist in the DXF determines the toolpath scenario
- Layer names determine tool selection and cut depth
- Tool parameters are fixed constants
- The G-code output dialect is a known Fanuc subset

Because every decision is already encoded in the DXF, the pipeline can be automated end-to-end. No human judgment is required after the DXF is exported.

**Target outcome:** Drop a DXF file (or batch of DXF files) into the pipeline, receive a validated `.nc` file ready to transfer to the Fanuc controller. Zero PowerMill. Zero manual intervention on standard parts.

---

## 2. Technology Stack Decision

### 2.1 Why NOT React/Vite for the core pipeline

The AluGamma frontend (React 18 + Vite 5) is appropriate for the UI layer — the interface where an operator selects files, reviews the generated program, and triggers the export. It is **not** appropriate for the core pipeline logic for these reasons:

- DXF parsing, geometry computation, and G-code generation are CPU-bound operations that do not belong in a browser main thread
- The `ezdxf` library (Python) is the best DXF parser available and has no JavaScript equivalent of comparable reliability
- File I/O, path traversal, and direct CNC file transfer require system-level access

### 2.2 Recommended architecture

```
┌─────────────────────────────────────────────────────┐
│                 AluGamma Frontend                    │
│         React + Vite  (existing codebase)           │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │          CNC Pipeline UI Module             │   │
│  │  - File drop zone for DXF input             │   │
│  │  - Layer detection preview                  │   │
│  │  - Scenario confirmation                    │   │
│  │  - NC program preview / download            │   │
│  └──────────────┬──────────────────────────────┘   │
└─────────────────┼───────────────────────────────────┘
                  │  HTTP  (localhost or LAN)
                  ▼
┌─────────────────────────────────────────────────────┐
│           Python FastAPI Backend Service            │
│                                                     │
│  POST /generate          ← DXF file upload         │
│  GET  /preview/{id}      ← NC preview text         │
│  GET  /download/{id}     ← .nc file download       │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │           cnc_pipeline package               │  │
│  │  dxf_reader.py      geometry.py             │  │
│  │  scenario.py        toolpath.py             │  │
│  │  gcode_writer.py    validator.py            │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

The backend can be a minimal FastAPI service (`pip install fastapi uvicorn ezdxf`). In production this runs locally on the operator's machine as a background process. The React UI calls it over localhost. This keeps the existing frontend codebase intact and adds only a small Python service.

**Alternatively** (simpler for initial deployment): the pipeline runs as a pure Python CLI with no UI dependency. The React frontend adds the UI wrapper later.

---

## 3. DXF Input Contract

### 3.1 Expected layer names

| Layer name | Required | Description |
| --- | --- | --- |
| `0` (default) | Yes | Arrow direction marker, part name label, original outer outline |
| `CUT` | Yes | Outer cut contour, offset 3mm outward from actual part edge |
| `FREZ` | Scenario-dependent | Bending lines for 105° taper tool |
| `FREZ_135` | Optional | Bending lines for 135° taper tool |
| `HOLES` | Optional | Drill/mill holes — short lines or 0.005mm dots |
| `SHEETS` | Optional | 1250×3200mm sheet boundary rectangle |

### 3.2 Coordinate system

- The DXF is produced by AluGamma with the sheet metal positioned with its **bottom-left corner at (0, 0)**
- All geometry is in **millimetres**
- Z = 0 is the top surface of the sheet metal
- The stock setup in PowerMill adds 9mm expansion on all sides, making the effective bounding box: `(−9, −9)` to `(width+9, height+9)` — this is reflected in the NC header block comments

### 3.3 DXF unit handling — confirmed resolution

The DXF files exported by AluGamma contain coordinates in **millimetres**. PowerMill on this machine has its default unit set to inches, which causes it to misinterpret the mm values as inch values — hence the manual scale correction of `× 0.03937007874015748` (which is `1 ÷ 25.4`) applied inside PowerMill to undo the misinterpretation.

**The pipeline does not need this scale factor.** It reads the DXF coordinates directly as mm and uses them as-is. This is a clean simplification — one source of error eliminated entirely.

The fix for AluGamma's DXF export (if you ever need to open files in PowerMill again) is to set `$INSUNITS = 4` (millimetres) in the DXF header. `ezdxf` does this automatically when you call `ezdxf.new()` with units set to mm. Confirm the existing AluGamma DXF export already sets this, and PowerMill will stop needing the manual rescale.

---

## 4. Scenario Detection

The pipeline inspects the DXF layer table to determine which scenario applies. This is fully deterministic.

```python
def detect_scenario(dxf_layers: set[str]) -> Scenario:
    has_holes    = "HOLES"    in dxf_layers
    has_frez     = "FREZ"     in dxf_layers
    has_frez_135 = "FREZ_135" in dxf_layers
    has_cut      = "CUT"      in dxf_layers

    if not has_cut:
        raise ValueError("DXF has no CUT layer — cannot generate toolpath")

    if has_holes and has_frez and has_frez_135:
        return Scenario.VERY_RARE      # HOLES > FREZ > FREZ_135 > CUT
    if has_holes and has_frez:
        return Scenario.COMMON         # HOLES > FREZ > CUT
    if has_frez and has_frez_135:
        return Scenario.RARE           # FREZ > FREZ_135 > CUT
    if has_frez:
        return Scenario.MOST_COMMON    # FREZ > CUT
    return Scenario.CUT_ONLY           # edge case — CUT only
```

### 4.1 Toolpath execution order per scenario

| Scenario | Order | Tools used |
| --- | --- | --- |
| Most common (≈80%) | FREZ → CUT | T9, T7 |
| Common | HOLES → FREZ → CUT | T7, T9, T7 |
| Rare | FREZ → FREZ_135 → CUT | T9, T11, T7 |
| Very rare | HOLES → FREZ → FREZ_135 → CUT | T7, T9, T11, T7 |

---

## 5. Tool Definitions

These are fixed constants. They never change unless a new tool is introduced. The offsets are not really in use for the current CNC pipeline,
they are important for the DXF drawing process, so you can actually ignore them here.

```python
TOOLS = {
    7: {
        "id":           "prav",
        "name":         "End Mill",
        "number":       7,
        "diameter":     6.0,
        "gauge_length": 25.0,
        "flutes":       1,
        "spindle_rpm":  24000,
        "feed_cut":     5500,   # mm/min — cutting moves
        "feed_plunge":  550,    # mm/min — all Z plunge moves (confirmed from NC file)
        "layers": {
            "CUT":   {"depth": -4.1,  "offset": 3.0}, # the offset 3 mm is for CUT layer line to be offset from the actual original outline on 0 layer
            "HOLES": {"depth": -4.11, "offset": 0.0}, 
        }
    },
    9: {
        "id":           "trapec_105",
        "name":         "Tapered Tipped",
        "number":       9,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 5.0,
        "gauge_length": 50.0,
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ": {"depth": -3.0, "offset": 0.0},
        }
    },
    11: {
        "id":           "trapec_135",
        "name":         "Tapered Tipped",
        "number":       11,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 5.0,
        "gauge_length": 29.0,
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ_135": {"depth": -3.0, "offset": 0.0},
        }
    }
}
```

> **Note on gauge length discrepancy:** The tool spec says T9 gauge length is 29.0mm, but the NC file comment block shows `( Gauge Length: 50,0)`. The NC file value takes precedence as the ground truth. Verify with the actual PowerMill tool database.
> 

---

## 6. Geometry Processing

### 6.1 Entity extraction per layer

For each layer, extract all geometric entities and convert to a unified `Contour` representation (ordered list of 2D points forming a closed or open polyline).

```
Supported input entity types:
  LINE        → two-point segment
  ARC         → discretised into segments (chord tolerance: 0.01mm)
  LWPOLYLINE  → use directly if closed, as-is
  POLYLINE    → convert vertices to LWPOLYLINE
  CIRCLE      → discretised full arc (360°)
  SPLINE      → discretised via fit points
```

### 6.2 Contour joining (polyline merging)

After extracting all entities from a layer, connect them into continuous contours by endpoint proximity matching (tolerance: **0.05mm**). This produces clean `LWPOLYLINE`-equivalent objects that the toolpath generator can traverse without lift/plunge overhead.

This is the same operation as the "join outer cut line" question from the initial discussion — it applies to **all layers**, not just CUT.

```
Algorithm:
1. Build adjacency graph: each segment endpoint is a node
2. Connect nodes within tolerance distance
3. Walk connected components to form contours
4. Classify each contour as CLOSED (start == end) or OPEN
5. All CUT layer contours must be CLOSED — warn if not
```

### 6.3 Toolpath ordering

### FREZ and FREZ_135 layers — outer-to-inner ordering

Per the PowerMill workflow specification: *"start cutting the FREZ bending lines from the most OUTER lines to the most INNER lines of the sheet metal."*

Implementation:

1. Compute the **centroid** of the sheet boundary (from SHEETS layer, or from the bounding box of all entities if SHEETS layer is absent: center of `(0,0)` to `(width, height)`)
2. For each FREZ contour, compute its **minimum distance to the sheet boundary** (or equivalently, its maximum distance from the sheet centroid)
3. Sort contours **descending by distance from centroid** → outermost first
4. Within the sorted order, chain contours by nearest-endpoint to minimise air travel

### CUT layer — fastest safe ordering

1. There is usually one primary outer contour and possibly one or more internal cutouts (corner reliefs, notches)
2. Machine the **largest contour last** (internal features first) — this keeps the part supported on the sheet until the final pass severs it
3. Within multiple contours at the same nesting level, order by nearest-endpoint to minimise travel

### HOLES layer — order is arbitrary

Holes are independent point operations. Order by nearest-neighbour (travelling salesman greedy) to minimise rapid travel distance.

### 6.4 Tool radius compensation and offsets

The CUT layer geometry in the DXF already accounts for the 3mm tool offset (it is drawn 3mm outward from the actual part edge by AluGamma). The pipeline applies **no additional offset** to CUT geometry. The G-code follows the DXF geometry exactly.

FREZ and FREZ_135 lines are centre-line paths. No offset is applied. The tool follows them directly.

HOLES are point positions. No offset.

---

## 7. G-code Generation

### 7.1 File structure

The NC file structure, derived directly from `Real-Example-NC.nc`:

```
[Program start — implicit, no header line]

For each toolpath block:
  NxxTyM6                     ← Tool change (y = tool number)
  NxxG54G90                   ← Work coordinate system + absolute mode
  Nxx( Toolpath Name: N)      ← Comment block (toolpath index, 1-based)
  Nxx( Output:)
  Nxx( Units: MM)
  Nxx( Tool Coordinates: Tip)
  Nxx( Tool Number: y)
  Nxx( Tool Id: <id>)
  Nxx( Coolant: Standard)
  Nxx( Gauge Length: N,N)
  Nxx( Block:)
  Nxx( MIN X: N,NNN)
  Nxx( MIN Y: N,NNN)
  Nxx( MIN Z: N,NNN)          ← Always -9.000
  Nxx( MAX X: N,NNN)
  Nxx( MAX Y: N,NNN)
  Nxx( MAX Z: N,NNN)          ← Always 9.000
  Nxx( COORDINATE SYSTEM: Named Workplane)
  Nxx( Datum - Tool Tip:)
  Nxx(   X: N,NNN)             ← First X position of this toolpath
  Nxx(   Y: N,NNN)             ← First Y position of this toolpath
  Nxx(   Z: N,NNN)             ← Always 10,000
  Nxx( Number of Flutes: N)
  Nxx( Tool:   <type>)
  Nxx( DIAMETER: N,NNN)
  [tool-specific params: TIP RADIUS, TAPER ANGLE, TAPER HEIGHT if taper tool]
  Nxx( Safety:)
  Nxx( Tool Cutting Moves: Gouges Not Checked)
  Nxx( Tool Leads: Safe No Gouges)
  Nxx( Tool Links: Gouges Not Checked)
  Nxx( Holder Cutting Moves: Collisions Not Checked)
  Nxx( Holder Leads: Collisions Not Checked)
  Nxx( Holder Links: Collisions Not Checked)
  Nxx( Toolpath: Curve Profile Machining)
  Nxx( STEPOVER: 5,000)
  Nxx( TOLERANCE:0,100)
  Nxx( THICKNESS:1,000)
  Nxx( Toolpath Stats:)
  Nxx( LENGTH: N,NNN)          ← Computed from total toolpath geometry
  Nxx( TIME: H/MM/SS)          ← Estimated: total_length / feed_rate
  Nxx( LIFTS: N)               ← Count of Z retract moves

  [First move — combined rapid + spindle on]
  NxxG43G0X<x>Y<y>Z5.S<rpm>H<tool_num>M3

  [For each contour segment:]
  NxxG1Z<depth>M8F<plunge_feed>    ← Plunge to depth, coolant on
  NxxX<x>Y<y>F<cut_feed>           ← First XY cut move
  ... additional XY moves ...
  NxxG0Z10.                         ← Retract to clearance height (10mm)
  NxxX<x>Y<y>                       ← Rapid to next contour start
  NxxZ5.                            ← Rapid to approach height (5mm)
  [repeat plunge + cut + retract for each contour]

  [Last move of toolpath — last XY + coolant off, no retract yet]
  NxxX<x>Y<y>M9

  [Between toolpaths — line numbers jump (gap of ~40)]
  [Next toolpath starts with NxxTyM6]

[Program end — last toolpath only]
NxxM9
NxxG91G28Z0
NxxG49H0
NxxG28X0Y0
NxxM30
```

### 7.2 Line numbering

- Line numbers start at **N40** and increment by **10** for every line
- After the last move of a toolpath (the `M9` coolant-off line), there is a **gap of ~40** before the next tool change line (i.e., N680 → N720 in the example, a skip of 4 line numbers × 10 = 40 units). This gap appears intentional — possibly reserved for manual insertion. Replicate this gap exactly.
- After the program-end `M9` (last toolpath's coolant off), the four terminal lines follow immediately with no gap

### 7.3 Number formatting

All numeric values in the NC file follow these rules, derived from the example:

```
Integers:           no decimal point needed (e.g. S24000, H7, F5500)
Z depths:           always one decimal place (Z-4.1, Z-3., Z5., Z10.)
X/Y coordinates:    three decimal places when fractional (X961.999, Y175.)
                    trailing zeros after decimal point are dropped (Y175. not Y175.000)
Comment block nums: use European decimal comma (5,000 not 5.000)
                    This is locale-specific to the PowerMill output
```

> **Critical:** The comment block uses **comma** as decimal separator (`5,000`) but the actual G-code coordinates use **period** (`X961.999`). The pipeline must apply this split formatting consistently.
> 

### 7.4 Heights and clearances

```python
Z_CLEARANCE  = 10.0   # Retract height after each contour (G0Z10.)
Z_APPROACH   = 5.0    # Approach height before plunge (Z5.)
Z_RAPID_SAFE = 5.0    # First rapid after tool change (G43G0...Z5.)
```

### 7.5 Coolant

- Coolant **ON** (`M8`): on the plunge line of every contour's first cutting move
- Coolant **OFF** (`M9`): on the last XY move of the last contour of each toolpath (combined with the final position)

### 7.6 Tool length compensation

`G43` is Tool Length Compensation. It appears on the **first move** of every toolpath, combined with the rapid and spindle-on:

```
G43G0X<start_x>Y<start_y>Z5.S<rpm>H<tool_num>M3
```

This is the line that `process_tap_files_tools.py` currently inserts `G0` into. Since the pipeline generates this line natively, the post-processing script becomes **redundant** for this operation.

---

## 8. Module Design

### 8.1 Package structure

```
cnc_pipeline/
├── __init__.py
├── config.py          # Tool constants, fixed parameters
├── dxf_reader.py      # DXF loading, layer extraction, entity parsing
├── geometry.py        # Contour joining, sorting, offset application
├── scenario.py        # Layer detection, scenario classification
├── toolpath.py        # Contour → ordered move sequence per layer
├── gcode_writer.py    # Move sequence → G-code text
├── validator.py       # Sanity checks on generated NC
└── pipeline.py        # Orchestrator — ties all modules together
```

### 8.2 `dxf_reader.py`

```python
class DXFReader:
    def __init__(self, filepath: str):
        self.doc = ezdxf.readfile(filepath)
        self.layers = self._detect_layers()

    def get_entities(self, layer: str) -> list[Segment]:
        """Return all geometric entities on a layer as Segment objects."""

    def get_bounding_box(self) -> BBox:
        """Return overall model bounding box in mm."""
```

### 8.3 `geometry.py`

```python
def join_segments(segments: list[Segment], tolerance=0.05) -> list[Contour]:
    """Connect segments into continuous contours by endpoint proximity."""

def sort_outer_to_inner(contours: list[Contour], sheet_bbox: BBox) -> list[Contour]:
    """Sort contours outermost-first by distance from sheet centroid."""

def sort_nearest_neighbour(contours: list[Contour]) -> list[Contour]:
    """Order contours to minimise total rapid travel distance."""
```

### 8.4 `toolpath.py`

```python
@dataclass
class Move:
    type: Literal["rapid", "cut", "plunge", "retract"]
    x: float | None
    y: float | None
    z: float | None
    feed: float | None
    coolant_on: bool = False
    coolant_off: bool = False

def generate_toolpath(
    contours: list[Contour],
    tool: dict,
    depth: float,
    ordering: Literal["outer_to_inner", "nearest_neighbour", "arbitrary"]
) -> list[Move]:
    """Convert sorted contours into a flat move sequence."""
```

### 8.5 `gcode_writer.py`

```python
class GCodeWriter:
    def __init__(self, program_name: str):
        self.program_name = program_name
        self._line_num = 40
        self._lines: list[str] = []

    def _n(self) -> str:
        """Return current line number prefix and advance counter."""

    def write_tool_change(self, tool: dict): ...
    def write_comment_block(self, tool: dict, toolpath_index: int,
                             bbox: BBox, first_pos: tuple, stats: Stats): ...
    def write_moves(self, moves: list[Move]): ...
    def write_program_end(self): ...
    def to_string(self) -> str: ...
```

### 8.6 `validator.py`

Post-generation sanity checks:

```python
def validate(nc_text: str, expected_tools: list[int]) -> ValidationResult:
    checks = [
        check_tool_changes_match_scenario,   # T7/T9/T11 in correct order
        check_program_ends_with_M30,
        check_no_unmatched_coolant,          # every M8 has a corresponding M9
        check_depths_within_bounds,          # no Z deeper than -5.0
        check_no_xy_moves_outside_sheet,     # all X/Y within sheet + 35mm margin
        check_line_numbers_sequential,
    ]
```

---

## 9. The `fanuc.opt` File

The 764-line `fanuc.opt` is a DuctPost post-processor definition file. It defines how PowerMill's internal toolpath representation maps to G-code tokens. Since this pipeline generates G-code directly (not through DuctPost), the `.opt` file serves as a **reference document** rather than executable code.

Key things to extract from `fanuc.opt` before implementation:

1. The exact format of tool change blocks (`T%nM6`, `G54G90`, etc.)
2. The line number increment (confirm it is N+10)
3. Whether the comment block is mandatory or optional
4. The exact end-of-program sequence (`G91G28Z0` / `G49H0` / `G28X0Y0` / `M30`)
5. Any conditional logic for coolant, the specific M-codes used
6. The rapid height values (Z10, Z5 — confirm these are hardcoded in the opt or calculated)

> **Action item:** Provide the `fanuc.opt` file. It will be parsed to extract the post-processor rules and confirm or override the values derived from the NC example file.
> 

---

## 10. Replacing `process_tap_files_tools.py`

The current post-processing script does three things:

| Operation | How pipeline handles it |
| --- | --- |
| Delete first 5 rows | Pipeline generates no header rows — the `.nc` file starts at N40T7M6 |
| Remove `G91G28Z0`, `G49H0`, `G28X0Y0` between toolpaths | Pipeline never emits these between toolpaths — only at program end |
| Add `G0` after `G43` | Pipeline emits `G43G0` natively on the first move of each toolpath |

**The post-processing script is fully superseded.** It can be retired once the pipeline is validated against a set of reference NC files.

---

## 11. Implementation Phases

### Phase 1 — DXF reading and geometry (Week 1–2)

- Implement `dxf_reader.py` with full entity support
- Implement `geometry.py` contour joining
- Validate: load a known DXF, extract layers, join contours, verify geometry visually (matplotlib or ezdxf viewer)
- Deliverable: `python pipeline.py input.dxf --preview-geometry`

### Phase 2 — Scenario detection and toolpath ordering (Week 2–3)

- Implement `scenario.py`
- Implement `toolpath.py` move sequence generation
- Validate: move sequence matches expected order for all 4 scenarios
- Deliverable: `python pipeline.py input.dxf --preview-moves`

### Phase 3 — G-code writer (Week 3–4)

- Implement `gcode_writer.py` with full comment block, correct number formatting, line numbering
- Validate: diff generated NC against `Real-Example-NC.nc` for a known input DXF
- Deliverable: `python pipeline.py input.dxf --output program.nc`

### Phase 4 — Validation and edge cases (Week 4–5)

- Implement `validator.py`
- Test all 4 scenarios
- Handle edge cases: open contours, zero-length entities, missing layers, parts with >2 nested cut contours
- Deliverable: full CLI with `-validate` flag

### Phase 5 — React UI integration (Week 5–6)

- FastAPI wrapper around `pipeline.py`
- React UI module: file drop, scenario preview, NC preview, download
- Integrate into existing AluGamma codebase as a new route/feature

### Phase 6 — Machine validation (Week 6–8)

- Run 10 programs through the pipeline
- Compare output NC files to PowerMill-generated files for the same DXF inputs
- Dry-run on the Fanuc machine (no material) to verify rapid moves and tool changes
- Cut first production part
- Sign off on PowerMill retirement for standard scenarios

---

## 12. Open Questions / Action Items

| # | Question | Who resolves | Priority |
| --- | --- | --- | --- |
| 1 | ~~DXF coordinate unit~~ **Resolved:** DXF is mm, no scaling needed | — | ~~Critical~~ Done |
| 2 | ~~fanuc.opt~~ **Resolved:** Full analysis complete, see Section 15 | — | ~~Critical~~ Done |
| 3 | Confirm T9 gauge length: spec says 29.0mm, NC file shows 50.0mm | Machine setup / tool database | High |
| 4 | ~~N10–N30 deleted lines~~ **Resolved:** `%`, `:ProgID`, `N10G91G28X0Y0Z0`, `N20G40G49G17G80`, `N30G90G0Z10.` | — | ~~High~~ Done |
| 5 | Are there ever multiple parts on one sheet (already nested)? Does the pipeline need to handle multiple CUT contours with separate FREZ sets? | Production workflow review | Medium |
| 6 | Does the Fanuc controller require a program number (`%` + `O0001`) at the top of the file? The NC example doesn't show one but some Fanuc variants require it | Controller manual / operator | Medium |
| 7 | What is the maximum contour count per layer seen in production? (affects toolpath stats `LIFTS` calculation) | Sample DXF review | Low |
| 8 | HOLES layer: are holes always represented as short line segments, or can they be circles or points? | Sample DXF with HOLES layer | Medium |

---

## 13. Reference: NC File Structural Pattern

The following summarises the exact structure confirmed from `Real-Example-NC.nc`. This is the ground truth for G-code generation.

```
Program structure (this example: HOLES(T7) → FREZ(T9) → CUT(T7)):

N40   T7M6                    ← Tool 7 load
N50   G54G90                  ← WCS + absolute
N60–N430                      ← Comment block (toolpath 1)
N440  G43G0X961.999Y175.Z5.S24000H7M3  ← First rapid + TLC + spindle
N450  G1Z-4.11M8F550          ← Plunge HOLES depth, coolant on
N460  Y190.F5500               ← Cut move
N470  G0Z10.                   ← Retract
... [more HOLES contours] ...
N680  X68.Y58.001M9            ← Last HOLES move, coolant off
                               ← (gap ~40 line numbers)
N720  T9M6                    ← Tool 9 load
N730  G54G90
N740–N1140                    ← Comment block (toolpath 2)
N1150 G43G0X68.Y58.001Z5.S13000H9M3   ← First rapid (continues from T7 last pos)
N1160 G1Z-3.M8F550            ← Plunge FREZ depth
... [FREZ contours outer→inner] ...
N1930 X34.999Y1565.001M9      ← Last FREZ move, coolant off
                               ← (gap ~40 line numbers)
N1970 T7M6                    ← Tool 7 reload for CUT
N1980 G54G90
N1990–N2360                   ← Comment block (toolpath 3)
N2370 G43G0X34.999Y1565.001Z5.S24000H7M3
N2380 G1Z-4.1M8F550           ← CUT depth (note: -4.1 not -4.11)
... [CUT contour] ...
N3070 M9                      ← Coolant off (no position on this line)
N3080 G91G28Z0                ← Z home
N3090 G49H0                   ← Cancel TLC
N3100 G28X0Y0                 ← XY home
N3110 M30                     ← Program end
```

Key observations:

- The first move of each toolpath **reuses the last XY position of the previous toolpath** as the starting rapid destination (`G43G0X<last_x>Y<last_y>...`)
- The `M9` coolant-off on the last move of a non-final toolpath is on the **same line as the last XY move** (e.g., `N680X68.Y58.001M9`)
- The `M9` on the final toolpath is on **its own line** with no XY coordinates (N3070M9)
- `F550` is the confirmed plunge feed rate for **all three tools** — T7, T9, and T11 all plunge at 550mm/min

---

## 14. Frontend–Backend Integration Architecture

### 14.1 The two-process model

The AluGamma app runs as two independent processes on the operator's machine. They communicate over localhost HTTP. Neither process knows the internal details of the other — the contract is the REST API.

```
Operator's machine
├── Process A: Vite dev server (or built static files)  → http://localhost:5173
│   React UI — all existing AluGamma functionality
│   + new CNC Pipeline UI module (new route)
│
└── Process B: Python FastAPI server                   → http://localhost:8765
    cnc_pipeline package
    Handles DXF parsing, toolpath generation, NC output
```

The port `8765` is chosen to avoid conflicts with common dev ports. It's configurable.

### 14.2 Python backend — complete setup

**File: `backend/main.py`**

```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import tempfile, uuid, os
from cnc_pipeline.pipeline import run_pipeline, PipelineResult

app = FastAPI(title="AluGamma CNC Pipeline", version="1.0.0")

# Allow the React dev server and production build to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store (keyed by job_id UUID)
# For production: persist to a local SQLite or just the filesystem
jobs: dict[str, PipelineResult] = {}

@app.post("/api/generate")
async def generate(file: UploadFile = File(...)):
    """
    Accept a DXF file upload.
    Return job_id + immediate analysis (detected layers, scenario, tool list).
    The NC content is generated synchronously for now (fast enough for single files).
    """
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(400, "Only .dxf files are accepted")

    # Save upload to temp file
    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    tmp.write(contents)
    tmp.close()

    try:
        result = run_pipeline(tmp.path, original_filename=file.filename)
        job_id = str(uuid.uuid4())
        jobs[job_id] = result
        return {
            "job_id":       job_id,
            "filename":     file.filename,
            "scenario":     result.scenario.value,
            "layers":       result.layers_detected,
            "tools":        result.tools_used,
            "contour_count": result.contour_count,
            "estimated_time": result.estimated_time_seconds,
            "warnings":     result.warnings,
        }
    except Exception as e:
        raise HTTPException(422, str(e))
    finally:
        os.unlink(tmp.name)

@app.get("/api/preview/{job_id}")
def preview(job_id: str):
    """Return the generated NC file as plain text for in-browser preview."""
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return JSONResponse({"nc_text": jobs[job_id].nc_text})

@app.get("/api/download/{job_id}")
def download(job_id: str):
    """Return the NC file as a downloadable attachment."""
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    result = jobs[job_id]
    # Write to temp file for streaming response
    tmp = tempfile.NamedTemporaryFile(suffix=".nc", delete=False, mode="w")
    tmp.write(result.nc_text)
    tmp.close()
    return FileResponse(
        tmp.name,
        media_type="application/octet-stream",
        filename=result.output_filename,
        background=None  # caller cleans up
    )

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}
```

**Start the backend:**

```bash
cd backend
pip install fastapi uvicorn ezdxf python-multipart
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

### 14.3 Vite proxy configuration

Add this to `vite.config.ts` so that in development, all `/api/*` calls from the React app are transparently proxied to the Python backend. This means the React code never hardcodes `localhost:8765` — it just calls `/api/generate` and Vite handles the routing.

```tsx
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      }
    }
  }
})
```

In production (built static files served by something like `serve` or Nginx), the proxy is replaced by a proper reverse proxy config or the frontend is told the API base URL via an environment variable.

### 14.4 React API client

Create a thin typed client so the UI never constructs raw fetch calls inline.

**File: `src/features/cnc-pipeline/api.ts`**

```tsx
const BASE = "/api"

export interface GenerateResponse {
  job_id:          string
  filename:        string
  scenario:        "most_common" | "common" | "rare" | "very_rare" | "cut_only"
  layers:          string[]
  tools:           number[]
  contour_count:   number
  estimated_time:  number   // seconds
  warnings:        string[]
}

export interface PreviewResponse {
  nc_text: string
}

export async function generateNC(file: File): Promise<GenerateResponse> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Generation failed")
  }
  return res.json()
}

export async function previewNC(jobId: string): Promise<string> {
  const res = await fetch(`${BASE}/preview/${jobId}`)
  if (!res.ok) throw new Error("Preview not found")
  const data: PreviewResponse = await res.json()
  return data.nc_text
}

export function downloadURL(jobId: string): string {
  return `${BASE}/download/${jobId}`
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}
```

### 14.5 React UI module structure

The CNC pipeline UI lives as a self-contained feature module inside the existing AluGamma app. It follows the same pattern as your other features.

```
src/features/cnc-pipeline/
├── api.ts                    ← API client (above)
├── types.ts                  ← Shared TypeScript types
├── CNCPipelinePage.tsx       ← Main page component, added to router
├── components/
│   ├── DXFDropZone.tsx       ← File upload with drag-and-drop
│   ├── ScenarioCard.tsx      ← Displays detected layers + tool sequence
│   ├── NCPreview.tsx         ← Monospace scrollable NC text preview
│   ├── BackendStatus.tsx     ← Shows if Python backend is reachable
│   └── GenerateButton.tsx    ← Submit + loading state
└── hooks/
    ├── useGenerate.ts        ← Manages upload → result state machine
    └── useBackendHealth.ts   ← Polls /api/health every 5s
```

### 14.6 Key UI states

The `CNCPipelinePage` component manages these states in sequence:

```
IDLE
  → user drops/selects DXF file
UPLOADING (shows spinner)
  → POST /api/generate
ANALYSED (shows ScenarioCard with layers, tools, warnings)
  → user reviews and clicks "Generate NC"
  (or: generation is instant and this state is skipped, going directly to READY)
READY
  → shows NCPreview (first 100 lines visible, rest scrollable)
  → "Download .nc" button links to /api/download/{job_id}
  → "Generate another" resets to IDLE
ERROR
  → shows error message with the backend's detail string
BACKEND_OFFLINE
  → shown when /api/health fails
  → "Start the CNC backend" instruction shown to operator
```

### 14.7 BackendStatus component

Since the Python server must be running separately, the UI should make its presence obvious. A small persistent indicator in the CNC Pipeline page header:

```tsx
// src/features/cnc-pipeline/components/BackendStatus.tsx
import { useBackendHealth } from "../hooks/useBackendHealth"

export function BackendStatus() {
  const online = useBackendHealth()
  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-mono ${
      online ? "text-emerald-400" : "text-red-400"
    }`}>
      <div className={`h-1.5 w-1.5 rounded-full ${
        online ? "bg-emerald-400" : "bg-red-400 animate-pulse"
      }`} />
      {online ? "CNC backend online" : "CNC backend offline — run: uvicorn main:app --port 8765"}
    </div>
  )
}
```

### 14.8 Startup convenience scripts

For the operator, running two processes is friction. Provide a single launcher.

**Windows: `start-alugamma.bat`**

```
@echo off
start "CNC Backend" /min cmd /c "cd backend && uvicorn main:app --host 127.0.0.1 --port 8765"
timeout /t 2 /nobreak >nul
start "AluGamma UI" /min cmd /c "cd frontend && npm run dev"
```

**macOS/Linux: `start-alugamma.sh`**

```bash
#!/bin/bash
cd "$(dirname "$0")"
(cd backend && uvicorn main:app --host 127.0.0.1 --port 8765) &
BACKEND_PID=$!
(cd frontend && npm run dev) &
FRONTEND_PID=$!
echo "AluGamma running. Backend PID: $BACKEND_PID, Frontend PID: $FRONTEND_PID"
wait
```

For a production deployment where the operator should not see terminal windows, the backend can be packaged as a Windows service or a macOS LaunchAgent. This is a Phase 5 concern.

### 14.9 Repository layout after integration

```
alugamma/                         ← existing repo root
├── src/                          ← existing React source (unchanged structure)
│   ├── features/
│   │   ├── sheet-metal/          ← existing
│   │   ├── workspace/            ← existing
│   │   └── cnc-pipeline/         ← NEW — entire feature module
│   └── ...
├── vite.config.ts                ← MODIFIED — add proxy config
├── backend/                      ← NEW — Python service
│   ├── main.py
│   ├── cnc_pipeline/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── dxf_reader.py
│   │   ├── geometry.py
│   │   ├── scenario.py
│   │   ├── toolpath.py
│   │   ├── gcode_writer.py
│   │   ├── validator.py
│   │   └── pipeline.py
│   └── requirements.txt
├── start-alugamma.sh             ← NEW — convenience launcher
├── start-alugamma.bat            ← NEW — Windows launcher
└── README.md
```

The `backend/` directory is a sibling to `src/`, not inside it. It is a completely separate Python project — no bundler touches it, no `node_modules` near it.

---

## 15. Version History

| Version | Date | Changes |
| --- | --- | --- |
| 0.1 | Initial | First draft from PowerMill workflow analysis |
| 0.2 | Current | Confirmed: all tools plunge at F550. DXF units are mm (no scale factor needed in pipeline). Added full frontend–backend integration spec (Section 14). |

---

## 15. `fanuc.opt` Full Analysis — Post-Processor Rules

This section documents every rule derived from `fanuc.opt` that directly affects G-code generation. The pipeline implements these rules natively — DuctPost is not called at any point.

### 15.1 Machine identity

```
machine:        fanuc
machine name:   Fanuc6m  version 1.2
post header:    "Delcam Postprocessor"
decimal point:  "."
zero char:      "0"
```

### 15.2 Line numbering — authoritative rules

```
block start:      10     ← first line number in file is N10
block increment:  10     ← every subsequent line is +10
N format:         permanent, not modal, no decimal, no leading zeros, width 4
```

`permanent` is the critical flag. In DuctPost, a word marked `permanent` outputs on **every** block line regardless of whether it appears explicitly in the block definition. This means the N counter increments and appears even on lines like `G54G90` that have no `N;` in the block definition. Every output line in the file has a line number.

**The 40-line gap between toolpaths explained:**

The raw `.tap` file has 4 lines between toolpaths that `process_tap_files_tools.py` deletes:

```
NxxX<last_x>Y<last_y>M9    ← last move, coolant off
Nxx+10 G91G28Z0            ← DELETED (tool change block line 1)
Nxx+20 G49H0               ← DELETED (tool change block line 2)
Nxx+30 G28X0Y0             ← DELETED (tool change block line 3)
Nxx+40 TyM6                ← KEPT (next tool change)
```

These 4 deleted lines × increment 10 = **gap of exactly 40** in line numbers between the last move of one toolpath and the `TyM6` of the next. This is the consistent pattern observed in the NC file (N680 → N720, N1930 → N1970). The pipeline reproduces this gap by simply skipping 40 in the counter at each toolpath boundary.

**The 5 deleted tape-start lines** at the very beginning of the `.tap`:

```
Line 0:  %                    ← tape start marker
Line 1:  :0001                ← program ID  (ID ProgID in opt)
Line 2:  N10G91G28X0Y0Z0      ← tape start line 1
Line 3:  N20G40G49G17G80      ← tape start line 2
Line 4:  N30G90G0Z<fromZ>     ← tape start line 3 (G90 absolute, G0 rapid, Z safe height)
```

After deleting these, the file starts at `N40TxM6` — the first tool change. **The pipeline never emits any of these lines**, so `process_tap_files_tools.py`'s line deletion is also fully superseded.

### 15.3 Coordinate formatting — authoritative rules

| Word | Format | Decimal | Trailing zeros | Places | Modal |
| --- | --- | --- | --- | --- | --- |
| X, Y, Z | with decimal point | yes | **no** | 3 metric | yes |
| F (feed rate) | no decimal point | no | yes | 0 (integer) | yes |
| S (spindle) | no decimal point | no | yes | 0 (integer) | not modal |
| T, H, M | no decimal point | no | yes | 0 (integer) | not modal |
| N (line num) | no decimal point | no | yes | 0 (integer) | permanent |
| G codes | no decimal point | no | yes | 0 (integer) | modal (G1/G2/G3) |

**Key rules for X/Y/Z:**

- `trailing zeros = false` → `Y175.` not `Y175.000` ✓ (matches NC file)
- `decimal point = true` → always present even for whole numbers → `Z5.` not `Z5` ✓
- `sign = if negative` → positive values have no sign, negative values have  ✓
- `modal` → only output when value changes from previous line ✓

**Key rules for F:**

- No decimal point, integer only → `F5500` not `F5500.` ✓
- `modal` → only output when feed rate changes ✓

### 15.4 Block (line) structure — word output order

Words are ordered within each output line according to:

```
OP  N  G(rapid/linear)  G(circle)  G(from)  G(cycle)  G(abs/inc)
G(offset/comp)  G(5th)  X  Y  Z  B  C
I  J  K  R  D  S  T
H  M  M2  msg  Q
Q1  Z2  R2  ID  F
```

This is why `G43G0X...Y...Z5.S24000H7M3` produces words in that exact sequence:

- G43 = tool length offset (G6=43)
- G0 = rapid (G1=0)
- X, Y, Z = coordinates
- S = spindle
- H = tool length offset number
- M3 = spindle CW

### 15.5 Tool change blocks — exact output

**First tool change in program** (`tool change first`):

```
define block tool change first:
  N ; OP ; change tool ; T ToolNum         → NxxTyM6
  G3 54 ; G5 90 ; G3=C ; G5=C ;           → NxxG54G90
```

`OP` is the optional block skip (`/`) but it is omitted in the actual NC output — PowerMill does not output it for these tool changes. The `=C` suffix means "modal suppress — only output if changed from last value". Since G54 and G90 are always the same, subsequent tool changes still emit them because they follow a tool-change reset.

**Result:**

```
N40T7M6
N50G54G90
```

**Subsequent tool changes** (`tool change`):

The raw `.tap` has:

```
Nxx G91 G28 Z0          → NxxG91G28Z0
Nxx G49 H0              → NxxG49H0
Nxx G28 X0 Y0           → NxxG28X0Y0
Nxx T9 M6               → NxxT9M6
G54 G90                 → NxxG54G90
```

`process_tap_files_tools.py` removes the first three of these (G91G28Z0, G49H0, G28X0Y0). What survives in the NC file is:

```
NxxT9M6
NxxG54G90
```

The pipeline simply emits `TyM6` + `G54G90` for every tool change, with a 40-unit line number gap before it.

### 15.6 Program end sequence — exact output

From `define block tape end`:

```
N ; G6 28 ; G5 91 ; Z 0 ; Z=C    → NxxG91G28Z0
N ; H 0 ; G6 49                   → NxxG49H0
N ; G6 28 ; X 0 ; Y 0 ; X=C ; Y=C → NxxG28X0Y0
N ; M1 30                          → NxxM30
```

This is identical to the end of `Real-Example-NC.nc`:

```
N3080G91G28Z0
N3090G49H0
N3100G28X0Y0
N3110M30
```

### 15.7 Coolant M-codes

```
coolant on      = M8   (appears on plunge line: G1Z-4.1M8F550)
coolant off     = M9   (appears on last move line of each toolpath)
spindle CW      = M3   (appears on first rapid line: G43G0...S24000H7M3)
spindle off     = M5   (not explicitly in NC — spindle stays on between toolpaths)
```

### 15.8 G-code dictionary for this machine

| G-code | Meaning | Source in opt |
| --- | --- | --- |
| G0 | Rapid move | `rapid = G1 0` |
| G1 | Linear feed move | `linear = G1 1` |
| G2 | Circle CW | `circle cw = G1 2` |
| G3 | Circle CCW | `circle ccw = G1 3` |
| G17 | XY plane | `xy plane = G3 17` |
| G28 | Machine home | `G6 28` in blocks |
| G40 | Compensation off | `compensation off = G2 40` |
| G43 | Tool length offset on | `tool length offset = G6 43` |
| G49 | Tool length offset cancel | `G6 49` in blocks |
| G54 | Work coordinate system | `from = G3 54` |
| G80 | End of cycle | `end of drill = G4 80` |
| G90 | Absolute data | `absolute data = G5 90` |
| G91 | Incremental data | `incremental data = G5 91` |
| M3 | Spindle on CW | `spindle on cw = M1 3` |
| M5 | Spindle off | `spindle off = M1 5` |
| M6 | Tool change | `change tool = M1 6` |
| M8 | Coolant on | `coolant on = M1 8` |
| M9 | Coolant off | `coolant off = M1 9` |
| M30 | End of program | `end of prog = M1 30` |

### 15.9 `process_tap_files_tools.py` — complete supersession analysis

| Script operation | Count of lines affected | Pipeline equivalent |
| --- | --- | --- |
| Delete first 5 lines (`%`, `:id`, N10, N20, N30) | 5 lines | Pipeline never emits tape-start block |
| Remove `G91G28Z0` between toolpaths | 1 line per tool change | Pipeline never emits home moves between toolpaths |
| Remove `G49H0` between toolpaths | 1 line per tool change | Pipeline never emits TLC cancel between toolpaths |
| Remove `G28X0Y0` between toolpaths | 1 line per tool change | Pipeline never emits XY home between toolpaths |
| Replace `G43` with `G43G0` | 1 line per toolpath | Pipeline emits `G43G0` natively on first rapid |

**Total lines removed per toolpath by the script:** 3 (the three home lines between each pair of toolpaths)

**Total lines removed from tape start:** 5

**`G43→G43G0` replacements:** 1 per toolpath

All of these are handled natively. The script is fully retired.

---

## 16. Version History

| Version | Date | Changes |
| --- | --- | --- |
| 0.1 | Initial | First draft from PowerMill workflow analysis |
| 0.2 | — | Confirmed: all tools plunge at F550. DXF units are mm. Added frontend–backend integration spec. |
| 0.3 | Current | Full `fanuc.opt` analysis (Section 15). Resolved: 5 deleted tap-start lines, 40-line gap origin, G54G90 line numbering, permanent N word behaviour, complete G-code dictionary. `process_tap_files_tools.py` fully superseded. All critical unknowns resolved except T9 gauge length. |