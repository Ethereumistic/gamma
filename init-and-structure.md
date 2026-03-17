# CNC Pipeline Backend — Init & Structure Guide

**For:** AI agent implementing the `cnc-pipeline-backend` Python service  
**Companion document:** `alugamma-cnc-pipeline-spec.md` — read that first, this file covers setup and structure only  
**Root:** `gamma/`  
**Frontend:** `gamma/alugamma/` (React + Vite, do not touch)  
**Backend:** `gamma/cnc-pipeline-backend/` (this project)

---

## 1. What already exists when you start

```
gamma/
├── .git/
├── .gitignore
├── alugamma/              ← frontend, do not touch
└── cnc-pipeline-backend/  ← your working directory
    └── sample_files/
        ├── Real-Example-NC.nc   ← ground truth output reference
        └── fanuc.opt            ← post-processor rules reference
        └── Real-Example-DXF.dxf ← input DXF file
        └── process_tap_files_tools.py ← script to delete useless lines from the .tap file and save as .nc
```

The `venv` is already created and activated by the operator before handing off to you. The following packages are already installed — do not re-install them, do not modify `requirements.txt` by hand:

```
fastapi
uvicorn
ezdxf
python-multipart
```

---

## 2. Target file structure — build exactly this

```
cnc-pipeline-backend/
├── venv/                        ← already exists, do not touch
├── sample_files/                ← already exists, do not touch
│   ├── Real-Example-NC.nc
│   └── fanuc.opt
│
├── cnc_pipeline/                ← the core Python package
│   ├── __init__.py
│   ├── config.py                ← all constants: tools, depths, feeds, heights
│   ├── dxf_reader.py            ← DXF loading, layer extraction, entity parsing
│   ├── geometry.py              ← segment joining, contour sorting
│   ├── scenario.py              ← layer detection → scenario classification
│   ├── toolpath.py              ← contours → ordered Move sequence
│   ├── gcode_writer.py          ← Move sequence → G-code text
│   ├── validator.py             ← sanity checks on generated NC
│   └── pipeline.py              ← orchestrator: DXF in → NC text out
│
├── tests/
│   ├── __init__.py
│   ├── test_scenario.py         ← unit tests for scenario detection
│   ├── test_geometry.py         ← unit tests for contour joining/sorting
│   ├── test_gcode_writer.py     ← unit tests for G-code formatting rules
│   └── test_pipeline.py         ← integration test using sample_files/
│
├── main.py                      ← FastAPI application entry point
├── requirements.txt             ← already populated, do not modify
└── README.md                    ← brief dev instructions
```

---

## 3. Build order — implement in this exact sequence

Do not skip ahead. Each phase depends on the previous one being correct.

### Phase 1 — `config.py` + `scenario.py`

No dependencies on anything else. Pure data and logic. Start here.

**Completion check:** `python -c "from cnc_pipeline.scenario import detect_scenario; print(detect_scenario({'FREZ','CUT'}))"` prints the correct scenario enum value without error.

### Phase 2 — `dxf_reader.py`

Depends on: `config.py`

Read DXF files using `ezdxf`, extract entities per layer, return them as a flat list of `Segment` objects (start point, end point, layer name). Handle: LINE, ARC (discretise to chord tolerance 0.01mm), LWPOLYLINE, CIRCLE (full arc), POLYLINE. Silently skip unsupported entity types.

**Completion check:** Load a DXF from `sample_files/` (operator will provide one), print entity counts per layer, verify layer names match expected values.

### Phase 3 — `geometry.py`

Depends on: `dxf_reader.py`

Join disconnected segments into continuous `Contour` objects by endpoint proximity (tolerance 0.05mm). Implement outer-to-inner sorting for FREZ/FREZ_135 layers. Implement nearest-neighbour ordering for CUT and HOLES.

**Completion check:** Given a known set of segments, `join_segments()` returns the correct number of contours with correct point counts.

### Phase 4 — `toolpath.py`

Depends on: `geometry.py`, `config.py`

Convert sorted contours into a flat list of `Move` objects. A `Move` has: type (rapid/plunge/cut/retract), x, y, z, feed, coolant_on, coolant_off flags.

**Completion check:** For a single rectangular contour, `generate_toolpath()` returns moves in the correct sequence: rapid to start → plunge → cut around rectangle → retract.

### Phase 5 — `gcode_writer.py`

Depends on: `toolpath.py`, `config.py`

Convert a list of toolpath blocks into G-code text. This is where every formatting rule from the spec matters. See Section 5 of this document for the complete rules.

**Completion check:** Generate NC for a known simple input. Compare character-by-character against the corresponding section of `sample_files/Real-Example-NC.nc`.

### Phase 6 — `validator.py` + `pipeline.py`

Depends on: all above modules

`pipeline.py` is the single public entry point — takes a DXF file path, returns a `PipelineResult` dataclass.

`validator.py` runs after generation and returns warnings, not exceptions, so a program with minor issues still downloads.

### Phase 7 — `main.py` (FastAPI)

Depends on: `pipeline.py`

The HTTP layer. Thin wrapper only — no business logic in `main.py`.

### Phase 8 — `tests/`

Write tests alongside each phase, not at the end. Each module should have its test file created when the module is created.

---

## 4. `config.py` — complete constants

Implement this exactly. These values are ground truth derived from the NC file and the operator's confirmed specifications.

```python
# cnc_pipeline/config.py

from dataclasses import dataclass
from typing import Literal

# ── Cutting heights ────────────────────────────────────────────────────────────
Z_CLEARANCE  = 10.0   # retract height after each contour  (G0Z10.)
Z_APPROACH   = 5.0    # approach height before plunge      (Z5. on first rapid)
Z_SAFE_RAPID = 5.0    # Z on the G43G0 first move line

# ── Stock expansion (PowerMill equivalent) ────────────────────────────────────
STOCK_EXPANSION = 9.0  # mm added on each side for bounding box in NC header

# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS: dict[int, dict] = {
    7: {
        "id":           "prav",
        "name":         "End Mill",
        "number":       7,
        "diameter":     6.0,
        "gauge_length": 25.0,
        "flutes":       1,
        "spindle_rpm":  24000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "CUT":   {"depth": -4.1,  "offset": 3.0},
            "HOLES": {"depth": -4.11, "offset": 0.0},
        },
    },
    9: {
        "id":           "trapec_105",
        "name":         "Tapered Tipped",
        "number":       9,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 5.0,
        "gauge_length": 50.0,   # confirmed from NC file comment block
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ": {"depth": -3.0, "offset": 0.0},
        },
    },
    11: {
        "id":           "trapec_135",
        "name":         "Tapered Tipped",
        "number":       11,
        "diameter":     13.0,
        "tip_radius":   0.0,
        "taper_angle":  47.5,
        "taper_height": 5.0,
        "gauge_length": 50.0,   # assumed same as T9 — verify with tool database
        "flutes":       4,
        "spindle_rpm":  13000,
        "feed_cut":     5500,
        "feed_plunge":  550,
        "layers": {
            "FREZ_135": {"depth": -3.0, "offset": 0.0},
        },
    },
}

# ── Layer names (case-sensitive, must match DXF exactly) ──────────────────────
LAYER_CUT      = "CUT"
LAYER_FREZ     = "FREZ"
LAYER_FREZ_135 = "FREZ_135"
LAYER_HOLES    = "HOLES"
LAYER_SHEETS   = "SHEETS"
LAYER_DEFAULT  = "0"

# ── Scenario definitions ──────────────────────────────────────────────────────
# Each scenario is an ordered list of (layer_name, tool_number) tuples
SCENARIOS: dict[str, list[tuple[str, int]]] = {
    "most_common": [
        ("FREZ",  9),
        ("CUT",   7),
    ],
    "common": [
        ("HOLES", 7),
        ("FREZ",  9),
        ("CUT",   7),
    ],
    "rare": [
        ("FREZ",     9),
        ("FREZ_135", 11),
        ("CUT",      7),
    ],
    "very_rare": [
        ("HOLES",    7),
        ("FREZ",     9),
        ("FREZ_135", 11),
        ("CUT",      7),
    ],
    "cut_only": [
        ("CUT", 7),
    ],
}

# ── G-code line numbering ─────────────────────────────────────────────────────
LINE_NUM_START     = 40    # first line in output (after tape-start lines are stripped)
LINE_NUM_INCREMENT = 10    # every line +10
LINE_NUM_GAP       = 40    # gap between last move of one toolpath and TxM6 of next
                           # (accounts for 4 deleted inter-toolpath lines × 10)
```

---

## 5. G-code formatting rules — authoritative

These rules are derived from `fanuc.opt` and confirmed against `sample_files/Real-Example-NC.nc`. The G-code writer must follow them exactly.

### 5.1 Coordinate formatting

```python
def fmt_coord(value: float) -> str:
    """
    Format an X/Y/Z coordinate value.
    Rules from fanuc.opt:
      - decimal point always present
      - trailing zeros suppressed
      - max 3 decimal places
      - negative sign only when negative (no leading +)
    Examples:
      175.0    → "175."
      175.5    → "175.5"
      175.123  → "175.123"
      -4.1     → "-4.1"
      0.0      → "0."
      5.0      → "5."
      10.0     → "10."
    """
    rounded = round(value, 3)
    if rounded == int(rounded):
        return f"{int(rounded)}."
    # format to 3dp then strip trailing zeros
    s = f"{rounded:.3f}".rstrip("0")
    # ensure decimal point remains
    if s.endswith("."):
        return s
    return s
```

### 5.2 Feed rate and integer formatting

```python
def fmt_int(value: int) -> str:
    """Feed rates, spindle speeds, tool numbers, M-codes — no decimal point."""
    return str(int(value))
```

### 5.3 Line numbering

```python
class LineCounter:
    def __init__(self, start=40, increment=10):
        self._n = start
        self._increment = increment

    def next(self) -> str:
        val = self._n
        self._n += self._increment
        return f"N{val}"

    def skip(self, count: int):
        """Skip count line numbers without emitting them."""
        self._n += self._increment * count

    def gap(self):
        """Apply the 40-unit inter-toolpath gap (4 skipped lines)."""
        self.skip(4)
```

### 5.4 Comment block format (NC header per toolpath)

Each toolpath starts with a comment block. The comment block uses **comma** as decimal separator (European locale — this is PowerMill's output format). The actual G-code coordinates use a period. Both must be reproduced exactly.

```python
def fmt_comment_number(value: float, decimal_places: int = 3) -> str:
    """
    Format a number for use inside NC comment blocks.
    Uses comma as decimal separator (European format from PowerMill).
    Examples:
      5.0   → "5,000"
      25.0  → "25,0"
      47.5  → "47,500"
      0.1   → "0,100"
    """
    s = f"{value:.{decimal_places}f}"
    return s.replace(".", ",")
```

The full comment block for a toolpath (all lines are NC comments wrapped in parentheses):

```
( Toolpath Name: {index})
( Output:)
( Units: MM)
( Tool Coordinates: Tip)
( Tool Number: {tool_number})
( Tool Id: {tool_id})
( Coolant: Standard)
( Gauge Length: {gauge_length_comma_format})
( Block:)
( MIN X: {bbox_min_x - STOCK_EXPANSION},000)
( MIN Y: {bbox_min_y - STOCK_EXPANSION},000)
( MIN Z: -9,000)
( MAX X: {bbox_max_x + STOCK_EXPANSION},000)
( MAX Y: {bbox_max_y + STOCK_EXPANSION},000)
( MAX Z: 9,000)
( COORDINATE SYSTEM: Named Workplane)
( Datum - Tool Tip:)
(   X: {first_x_comma_format})
(   Y: {first_y_comma_format})
(   Z: 10,000)
( Number of Flutes: {flutes})
( Tool:   {tool_type_name})
( DIAMETER: {diameter_comma_format})
[if taper tool:]
( TIP RADIUS: 0,000)
( TAPER ANGLE: {taper_angle_comma_format})
( TAPER HEIGHT: {taper_height_comma_format})
( Safety:)
( Tool Cutting Moves: Gouges Not Checked)
( Tool Leads: Safe No Gouges)
( Tool Links: Gouges Not Checked)
( Holder Cutting Moves: Collisions Not Checked)
( Holder Leads: Collisions Not Checked)
( Holder Links: Collisions Not Checked)
( Toolpath: Curve Profile Machining)
( STEPOVER: 5,000)
( TOLERANCE:0,100)
( THICKNESS:1,000)
( Toolpath Stats:)
( LENGTH: {total_path_length_comma_format})
( TIME: {estimated_time_h_mm_ss})
( LIFTS: {retract_count})
```

**Important:** Every comment line gets a line number (`Nxx`). The N counter is incremented for every line including comment lines.

### 5.5 Per-toolpath G-code structure

```
NxxTyM6                                           ← tool change
NxxG54G90                                         ← WCS + absolute (always follows T change)
[comment block lines — each with Nxx prefix]
NxxG43G0X{x}Y{y}Z5.S{rpm}H{tool_num}M3           ← first rapid + TLC + spindle on
NxxG1Z{depth}M8F{plunge_feed}                     ← first plunge into material, coolant on
NxxX{x2}Y{y2}F{cut_feed}                          ← first cut move (feed stated once — modal)
NxxX{x3}Y{y3}                                     ← subsequent cut moves (no F — modal)
NxxG0Z10.                                         ← retract
NxxX{next_x}Y{next_y}                             ← rapid to next contour start (no Z)
NxxZ5.                                            ← drop to approach height
NxxG1Z{depth}F{plunge_feed}                       ← plunge (no M8 — coolant already on)
NxxX{x}Y{y}F{cut_feed}                            ← cut
[... repeat rapid/approach/plunge/cut/retract for each contour ...]
NxxX{last_x}Y{last_y}M9                           ← last move of this toolpath, coolant off
[gap — 4 × LINE_NUM_INCREMENT skipped]
```

**Modal word rules (critical for correctness):**

- `F` (feed rate): only output when value changes from the previous line. If the previous line was `F550` (plunge) and next is `F5500` (cut), output `F5500`. If the line after is also `F5500`, omit `F`.
- `G0`/`G1`: only output when motion mode changes. After a `G1` line, subsequent linear moves omit `G1`.
- `X`, `Y`: only output when the value changes. If X doesn't change between two moves, omit X.
- `Z`: same — only output when Z changes.

**Coolant rules:**
- `M8` (coolant on): appears once, on the very first plunge of the toolpath only
- `M9` (coolant off): appears on the last XY move of the toolpath, same line as the last position
- For non-final toolpaths: last line is `NxxX{x}Y{y}M9` (position + coolant off combined)
- For the final toolpath: last cutting move has no M9, then a standalone `NxxM9` line follows, then the program-end sequence

### 5.6 Program end sequence

Immediately after the final toolpath's standalone `M9` line:

```
NxxG91G28Z0
NxxG49H0
NxxG28X0Y0
NxxM30
```

No gap before these — they follow immediately after `M9`.

### 5.7 Complete minimal example — 1 toolpath, 1 rectangular contour

For a simple FREZ-only scenario (one toolpath, T9, one rectangular closed contour):

```
N40T9M6
N50G54G90
N60( Toolpath Name: 1)
N70( Output:)
N80( Units: MM)
...
N440G43G0X{start_x}Y{start_y}Z5.S13000H9M3
N450G1Z-3.M8F550
N460X{x2}Y{y2}F5500
N470X{x3}Y{y3}
N480X{x4}Y{y4}
N490X{start_x}Y{start_y}
N500G0Z10.
N510M9
N520G91G28Z0
N530G49H0
N540G28X0Y0
N550M30
```

---

## 6. `main.py` — complete FastAPI application

```python
# main.py
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import tempfile, uuid, os, pathlib

from cnc_pipeline.pipeline import run_pipeline, PipelineResult

app = FastAPI(title="AluGamma CNC Pipeline", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory job store keyed by UUID
# Sufficient for single-operator local use
_jobs: dict[str, PipelineResult] = {}


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/generate")
async def generate(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="Only .dxf files are accepted")

    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    tmp.write(contents)
    tmp.close()

    try:
        result = run_pipeline(tmp.name, original_filename=file.filename)
        job_id = str(uuid.uuid4())
        _jobs[job_id] = result
        return {
            "job_id":          job_id,
            "filename":        file.filename,
            "scenario":        result.scenario,
            "layers_detected": result.layers_detected,
            "tools_used":      result.tools_used,
            "contour_count":   result.contour_count,
            "lift_count":      result.lift_count,
            "estimated_time":  result.estimated_time_seconds,
            "warnings":        result.warnings,
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        os.unlink(tmp.name)


@app.get("/api/preview/{job_id}")
def preview(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return JSONResponse({"nc_text": _jobs[job_id].nc_text})


@app.get("/api/download/{job_id}")
def download(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    result = _jobs[job_id]

    tmp = tempfile.NamedTemporaryFile(
        suffix=".nc", delete=False, mode="w", encoding="utf-8"
    )
    tmp.write(result.nc_text)
    tmp.close()

    return FileResponse(
        path=tmp.name,
        media_type="application/octet-stream",
        filename=result.output_filename,
    )
```

**To start the server:**
```bash
# from inside cnc-pipeline-backend/, with venv activated
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

---

## 7. `pipeline.py` — the `PipelineResult` dataclass and orchestrator

```python
# cnc_pipeline/pipeline.py
from dataclasses import dataclass, field
import os


@dataclass
class PipelineResult:
    scenario:          str           # "most_common" | "common" | "rare" | "very_rare" | "cut_only"
    layers_detected:   list[str]     # e.g. ["CUT", "FREZ"]
    tools_used:        list[int]     # e.g. [9, 7]
    contour_count:     int           # total contours across all layers
    lift_count:        int           # total retract moves (= total contours - 1 per toolpath + toolpaths)
    estimated_time_seconds: float    # rough estimate based on path length / feed rate
    warnings:          list[str]     # non-fatal issues found during generation
    nc_text:           str           # the complete generated NC program
    output_filename:   str           # e.g. "part_name.nc"


def run_pipeline(dxf_path: str, original_filename: str = "") -> PipelineResult:
    """
    Full pipeline: DXF file → PipelineResult containing NC text.
    Raises ValueError for unrecoverable errors (missing CUT layer, etc.).
    """
    from .dxf_reader import DXFReader
    from .scenario import detect_scenario
    from .geometry import join_segments, sort_outer_to_inner, sort_nearest_neighbour
    from .toolpath import generate_toolpath
    from .gcode_writer import GCodeWriter
    from .validator import validate
    from .config import SCENARIOS, LAYER_CUT, LAYER_FREZ, LAYER_FREZ_135, LAYER_HOLES

    warnings = []

    # 1. Read DXF
    reader = DXFReader(dxf_path)
    bbox = reader.get_bounding_box()

    # 2. Detect scenario
    scenario_name = detect_scenario(reader.layers)
    toolpath_sequence = SCENARIOS[scenario_name]  # list of (layer, tool_num)

    # 3. For each layer in sequence: extract → join → sort → generate moves
    toolpath_blocks = []
    total_contours = 0

    for layer_name, tool_num in toolpath_sequence:
        segments = reader.get_entities(layer_name)
        if not segments:
            warnings.append(f"Layer {layer_name} has no geometry — skipping")
            continue

        contours = join_segments(segments)
        total_contours += len(contours)

        # Sort order depends on layer type
        if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
            ordered = sort_outer_to_inner(contours, bbox)
        else:
            ordered = sort_nearest_neighbour(contours)

        moves = generate_toolpath(ordered, tool_num, layer_name)
        toolpath_blocks.append((tool_num, layer_name, moves))

    if not toolpath_blocks:
        raise ValueError("No toolpath blocks generated — check DXF layer names")

    # 4. Write G-code
    stem = os.path.splitext(os.path.basename(original_filename or dxf_path))[0]
    writer = GCodeWriter(program_name=stem)
    nc_text = writer.write(toolpath_blocks, bbox)

    # 5. Validate
    validation = validate(nc_text, [t for t, _, _ in toolpath_blocks])
    warnings.extend(validation.warnings)

    # 6. Compute stats
    lift_count = sum(
        sum(1 for m in moves if m.type == "retract")
        for _, _, moves in toolpath_blocks
    )
    total_length = writer.total_path_length
    avg_feed = 5500  # mm/min — rough estimate
    estimated_time = (total_length / avg_feed) * 60  # seconds

    return PipelineResult(
        scenario=scenario_name,
        layers_detected=list(reader.layers),
        tools_used=[t for t, _, _ in toolpath_blocks],
        contour_count=total_contours,
        lift_count=lift_count,
        estimated_time_seconds=estimated_time,
        warnings=warnings,
        nc_text=nc_text,
        output_filename=f"{stem}.nc",
    )
```

---

## 8. Vite proxy — the only frontend change required

Add this to `gamma/alugamma/vite.config.ts`:

```typescript
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

After this change, all `fetch('/api/...')` calls from React are proxied to the Python backend in development. No hardcoded ports anywhere in the React code.

---

## 9. Running both services locally

Each in its own terminal:

**Terminal 1 — backend:**
```bash
cd gamma/cnc-pipeline-backend
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

**Terminal 2 — frontend:**
```bash
cd gamma/alugamma
npm run dev
```

Frontend at `http://localhost:5173`, backend at `http://localhost:8765`. The Vite proxy makes `/api/*` calls work transparently.

---

## 10. `requirements.txt` — reference

```
fastapi==0.115.0
uvicorn==0.30.6
ezdxf==1.3.4
python-multipart==0.0.12
```

Exact versions may differ from what `pip freeze` produces — the above are the minimum known-good versions. Do not downgrade any of them.

---

## 11. Key constraints and things NOT to do

- **Do not** put any business logic in `main.py` — it is HTTP glue only
- **Do not** import `ezdxf` anywhere except `dxf_reader.py`
- **Do not** generate G-code in `toolpath.py` — it produces `Move` objects only
- **Do not** apply coordinate scaling — DXF coordinates are already in mm
- **Do not** use `print()` for errors in the pipeline — raise `ValueError` for unrecoverable, append to `warnings` list for non-fatal
- **Do not** touch anything inside `gamma/alugamma/` except `vite.config.ts`
- **Do not** commit `venv/` — it is in `.gitignore`
- **Do not** hardcode file paths — use `os.path` or `pathlib.Path` with relative references

---

## 12. Validation reference — what correct output looks like

The file `sample_files/Real-Example-NC.nc` is the ground truth. It was produced by PowerMill + DuctPost + `process_tap_files_tools.py` for a real production part. When the pipeline is complete, feeding in the DXF that produced this NC file should produce output that is:

- Structurally identical (same line structure, same G-code sequence)
- Numerically identical for all coordinates (same toolpath geometry)
- Identical in line numbering and gaps

The comment block values (LENGTH, TIME, LIFTS) will differ slightly because PowerMill computes them from its internal representation — minor differences in these comment-only fields are acceptable. All actual cutting move coordinates must match.
