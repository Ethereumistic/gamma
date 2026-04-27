# PLAN 01 — Config, Filename Parser, DXF Reader

## `config.py`

```python
# config.py
# All magic numbers in one place. Tune these during testing.

# --- Sheet physical dimensions (mm) ---
SHEET_WIDTH  = 1250.0
SHEET_HEIGHT = 3200.0

# --- Standard margin (Mode A) ---
MARGIN = 35.0

# --- Usable area in Mode A ---
USABLE_WIDTH  = SHEET_WIDTH  - 2 * MARGIN   # 1180.0
USABLE_HEIGHT = SHEET_HEIGHT - 2 * MARGIN   # 3130.0

# --- CNC tool / CUT layer offset ---
# CUT layer is offset 3mm OUTWARD from Layer 0 outline on all sides.
# So CUT bbox = Layer0 bbox + 2*CUT_OFFSET in both W and H.
CUT_OFFSET = 3.0

# --- Full-span threshold (Mode B trigger) ---
# If a part's CUT dimension, or sum of two adjacent parts' CUT dimensions,
# equals or exceeds these thresholds, use Mode B (no margin, centered).
FULLSPAN_WIDTH_THRESHOLD  = SHEET_WIDTH   # 1250.0
FULLSPAN_HEIGHT_THRESHOLD = SHEET_HEIGHT  # 3200.0
# Also trigger Mode B if parts exceed usable area:
USABLE_THRESHOLD_W = USABLE_WIDTH    # 1180.0
USABLE_THRESHOLD_H = USABLE_HEIGHT   # 3130.0

# --- Deduplication tolerance (mm) ---
# Two CUT segments closer than this are considered coincident.
COINCIDENCE_TOL = 0.01

# --- Packing ---
# Maximum number of bins (sheets) the packer may open.
MAX_BINS = 200

# --- Output ---
OUTPUT_DIR = "output"
REPORT_FILENAME = "packing_report.txt"

# --- DXF layer names (must match your DXF files exactly) ---
LAYER_ZERO    = "0"
LAYER_CUT     = "CUT"
LAYER_FREZ    = "FREZ"
LAYER_FREZ135 = "FREZ_135"
LAYER_HOLES   = "HOLES"
LAYER_SHEETS  = "SHEETS"

# All layers that are NOT CUT — these go through block inserts unmodified.
NON_CUT_LAYERS = {LAYER_ZERO, LAYER_FREZ, LAYER_FREZ135, LAYER_HOLES}
```

---

## `parser.py`

### Filename Format

Supported patterns (case-insensitive for direction letter):

```
[name]_[direction]_x[count].dxf    →  1335_B_x50.dxf
[name]_x[count].dxf                →  corner_x8.dxf
[name]_[direction]_x[count].dxf    →  0004_T_x1.dxf
```

Direction values: `T` (top), `B` (bottom), `L` (left), `R` (right)  
Direction is optional. If absent, part is rotation-free.

Direction → rotation semantics:
| Direction | Meaning | Rotation lock |
|---|---|---|
| T or B | Arrow points vertically | 0° (part stays upright) |
| L or R | Arrow points horizontally | 90° (part is rotated) |
| None | No preferred axis | Both 0° and 90° allowed |

### Dataclasses

```python
# parser.py
import re
import os
from dataclasses import dataclass, field
from typing import Optional, List, Tuple
import ezdxf
from config import CUT_OFFSET, LAYER_ZERO, LAYER_CUT

@dataclass
class PartGeometry:
    """Raw geometry extracted from the DXF file."""
    # Layer 0 bounding box (min_x, min_y, max_x, max_y) in the part's local coordinate space
    l0_bbox: Tuple[float, float, float, float]
    # All CUT layer line entities as list of ((x1,y1),(x2,y2)) in local coords
    cut_lines: List[Tuple[Tuple[float, float], Tuple[float, float]]]
    # The ezdxf document (kept open for block insertion later)
    doc: object  # ezdxf.Document
    block_name: str  # name of the block definition we create from this part

@dataclass
class Part:
    """Fully parsed part ready for packing."""
    name: str                            # e.g. "1335", "corner", "0004"
    filename: str                        # original filename without extension
    filepath: str                        # absolute path to .dxf file
    direction: Optional[str]             # 'T', 'B', 'L', 'R', or None
    count: int                           # how many instances required
    rotation_locked: bool                # True → direction present
    allowed_rotation: int                # 0 = upright only, 90 = rotated only, -1 = both

    # Layer 0 dimensions (from bbox)
    l0_width: float
    l0_height: float

    # CUT layer dimensions (= l0 + 2*CUT_OFFSET on each axis)
    cut_width: float
    cut_height: float

    geometry: PartGeometry
```

### Filename Parser

```python
# parser.py (continued)

DIRECTION_VALUES = {'T', 'B', 'L', 'R'}

# Regex: name may contain digits, letters, underscores, hyphens
# Pattern: <name>_<DIR>_x<count> or <name>_x<count>
_FILENAME_RE_WITH_DIR = re.compile(
    r'^(?P<name>.+?)_(?P<dir>[TBLRtblr])_[xX](?P<count>\d+)$',
    re.IGNORECASE
)
_FILENAME_RE_NO_DIR = re.compile(
    r'^(?P<name>.+?)_[xX](?P<count>\d+)$'
)

def parse_filename(filename: str) -> Tuple[str, Optional[str], int]:
    """
    Parse a DXF filename (without extension) into (name, direction, count).
    
    Examples:
        "1335_B_x50"   → ("1335", "B", 50)
        "0004_T_x1"    → ("0004", "T", 1)
        "corner_x8"    → ("corner", None, 8)
    
    Raises ValueError if pattern does not match.
    """
    stem = os.path.splitext(filename)[0]

    m = _FILENAME_RE_WITH_DIR.match(stem)
    if m:
        return m.group('name'), m.group('dir').upper(), int(m.group('count'))

    m = _FILENAME_RE_NO_DIR.match(stem)
    if m:
        return m.group('name'), None, int(m.group('count'))

    raise ValueError(
        f"Cannot parse filename '{filename}'. "
        f"Expected '<name>_<DIR>_x<count>.dxf' or '<name>_x<count>.dxf'."
    )

def direction_to_rotation(direction: Optional[str]) -> int:
    """
    Returns:
        0   → part must stay upright (T or B)
        90  → part must be rotated 90° (L or R)
        -1  → no constraint (no direction)
    """
    if direction is None:
        return -1
    if direction in ('T', 'B'):
        return 0
    if direction in ('L', 'R'):
        return 90
    raise ValueError(f"Unknown direction '{direction}'")
```

### DXF Reader

```python
# parser.py (continued)

def read_part_dxf(filepath: str) -> PartGeometry:
    """
    Read a part .dxf file and extract:
    1. Layer 0 bounding box (used to compute CUT bbox)
    2. All CUT layer line entities (for deduplication later)

    The part DXF is expected to have all geometry in modelspace,
    NOT nested in blocks. We create an internal block from it
    so we can insert it into sheet DXFs later.
    """
    doc = ezdxf.readfile(filepath)
    msp = doc.modelspace()

    # --- Extract Layer 0 bounding box ---
    # Use ezdxf's built-in bbox or iterate entities
    from ezdxf.bbox import extents
    from ezdxf import select

    l0_entities = [e for e in msp if e.dxf.layer == '0']
    if not l0_entities:
        raise ValueError(f"No Layer 0 entities found in {filepath}")

    # Compute bbox manually from endpoints for robustness
    xs, ys = [], []
    for ent in l0_entities:
        pts = _entity_points(ent)
        for x, y in pts:
            xs.append(x)
            ys.append(y)

    if not xs:
        raise ValueError(f"Layer 0 entities in {filepath} have no extractable points")

    l0_bbox = (min(xs), min(ys), max(xs), max(ys))

    # --- Extract CUT layer lines ---
    cut_entities = [e for e in msp if e.dxf.layer == 'CUT']
    cut_lines = []
    for ent in cut_entities:
        segments = _entity_to_segments(ent)
        cut_lines.extend(segments)

    # --- Create a named block from this part's geometry ---
    # We will insert this block into sheet DXFs.
    # Block name = filename stem (unique per part file)
    block_name = os.path.splitext(os.path.basename(filepath))[0]

    return PartGeometry(
        l0_bbox=l0_bbox,
        cut_lines=cut_lines,
        doc=doc,
        block_name=block_name
    )


def _entity_points(entity) -> List[Tuple[float, float]]:
    """Extract significant points from a DXF entity for bbox computation."""
    dxftype = entity.dxftype()
    pts = []
    try:
        if dxftype == 'LINE':
            pts = [(entity.dxf.start.x, entity.dxf.start.y),
                   (entity.dxf.end.x,   entity.dxf.end.y)]
        elif dxftype in ('LWPOLYLINE',):
            pts = [(p[0], p[1]) for p in entity.get_points()]
        elif dxftype == 'POLYLINE':
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
        elif dxftype == 'ARC':
            # Use bbox of arc's enclosing circle as conservative estimate
            cx, cy = entity.dxf.center.x, entity.dxf.center.y
            r = entity.dxf.radius
            pts = [(cx-r, cy-r), (cx+r, cy+r)]
        elif dxftype == 'CIRCLE':
            cx, cy = entity.dxf.center.x, entity.dxf.center.y
            r = entity.dxf.radius
            pts = [(cx-r, cy-r), (cx+r, cy+r)]
        elif dxftype == 'SPLINE':
            pts = [(p[0], p[1]) for p in entity.control_points]
    except Exception:
        pass
    return pts


def _entity_to_segments(entity) -> List[Tuple[Tuple[float,float], Tuple[float,float]]]:
    """
    Convert a DXF entity to a list of (start, end) line segments.
    Used to extract CUT layer geometry for deduplication.
    Polylines and arcs are approximated as polylines with small chord error.
    """
    dxftype = entity.dxftype()
    segs = []
    try:
        if dxftype == 'LINE':
            s = (entity.dxf.start.x, entity.dxf.start.y)
            e = (entity.dxf.end.x,   entity.dxf.end.y)
            segs.append((s, e))
        elif dxftype == 'LWPOLYLINE':
            pts = [(p[0], p[1]) for p in entity.get_points()]
            for i in range(len(pts) - 1):
                segs.append((pts[i], pts[i+1]))
            if entity.closed and len(pts) > 1:
                segs.append((pts[-1], pts[0]))
        elif dxftype == 'POLYLINE':
            verts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
            for i in range(len(verts) - 1):
                segs.append((verts[i], verts[i+1]))
        elif dxftype in ('ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE'):
            # Approximate curved entities as polyline segments (16 divisions)
            pts = _approximate_curve(entity, divisions=64)
            for i in range(len(pts) - 1):
                segs.append((pts[i], pts[i+1]))
    except Exception:
        pass
    return segs


def _approximate_curve(entity, divisions=64) -> List[Tuple[float, float]]:
    """Approximate arcs, circles, splines as a list of points."""
    import math
    dxftype = entity.dxftype()
    pts = []
    if dxftype == 'ARC':
        cx, cy = entity.dxf.center.x, entity.dxf.center.y
        r = entity.dxf.radius
        a0 = math.radians(entity.dxf.start_angle)
        a1 = math.radians(entity.dxf.end_angle)
        if a1 <= a0:
            a1 += 2 * math.pi
        for i in range(divisions + 1):
            a = a0 + (a1 - a0) * i / divisions
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    elif dxftype == 'CIRCLE':
        cx, cy = entity.dxf.center.x, entity.dxf.center.y
        r = entity.dxf.radius
        for i in range(divisions + 1):
            a = 2 * math.pi * i / divisions
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    elif dxftype == 'SPLINE':
        pts = [(p[0], p[1]) for p in entity.flattening(0.1)]
    elif dxftype == 'ELLIPSE':
        pts = [(p[0], p[1]) for p in entity.flattening(0.1)]
    return pts


def load_all_parts(input_dir: str) -> List[Part]:
    """
    Scan input_dir for .dxf files, parse each, return list of Part objects.
    Logs warnings for unparseable filenames (skips them).
    """
    import logging
    parts = []
    dxf_files = sorted([
        f for f in os.listdir(input_dir)
        if f.lower().endswith('.dxf')
    ])

    if not dxf_files:
        raise FileNotFoundError(f"No .dxf files found in '{input_dir}'")

    for fname in dxf_files:
        fpath = os.path.join(input_dir, fname)
        try:
            name, direction, count = parse_filename(fname)
            geom = read_part_dxf(fpath)

            l0_minx, l0_miny, l0_maxx, l0_maxy = geom.l0_bbox
            l0_w = l0_maxx - l0_minx
            l0_h = l0_maxy - l0_miny
            cut_w = l0_w + 2 * CUT_OFFSET
            cut_h = l0_h + 2 * CUT_OFFSET

            allowed_rot = direction_to_rotation(direction)

            part = Part(
                name=name,
                filename=os.path.splitext(fname)[0],
                filepath=fpath,
                direction=direction,
                count=count,
                rotation_locked=(direction is not None),
                allowed_rotation=allowed_rot,
                l0_width=l0_w,
                l0_height=l0_h,
                cut_width=cut_w,
                cut_height=cut_h,
                geometry=geom
            )
            parts.append(part)
            logging.info(
                f"Loaded: {fname} → name={name}, dir={direction}, "
                f"count={count}, CUT={cut_w:.1f}×{cut_h:.1f}mm"
            )

        except ValueError as e:
            logging.warning(f"Skipping '{fname}': {e}")
        except Exception as e:
            logging.error(f"Error loading '{fname}': {e}")
            raise

    return parts
```

---

## Testing `parser.py`

Verify with these assertions before moving to geometry/packing:

```python
# Quick smoke test (run directly: python parser.py)
if __name__ == '__main__':
    cases = [
        ("1335_B_x50.dxf",   ("1335",   "B",   50)),
        ("0004_T_x1.dxf",    ("0004",   "T",   1)),
        ("corner_x8.dxf",    ("corner", None,  8)),
        ("roof-panel_L_x12.dxf", ("roof-panel", "L", 12)),
        ("PART_01_R_x3.dxf", ("PART_01", "R",  3)),
    ]
    for fname, expected in cases:
        result = parse_filename(fname)
        assert result == expected, f"FAIL: {fname} → {result}, expected {expected}"
    print("All filename parse tests passed.")
```
