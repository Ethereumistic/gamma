# PLAN 03 — CUT Line Deduplication & DXF Sheet Writer

## `deduplicator.py`

### What We're Solving

When two parts are placed flush against each other (sharing a CUT edge), both parts' CUT layer contains a line at exactly that boundary. If we write both, the CNC will traverse the same path twice — wasted machining time.

We must:
1. Collect all CUT line segments for a sheet layout (transformed into sheet space)
2. Detect coincident segment pairs (same line, overlapping span)
3. Keep one copy of each shared segment (the union of the overlapping span)
4. Discard duplicates

### Geometric Definition of Coincidence

Two segments S1 and S2 are coincident when:
- They are **collinear**: all endpoints of S2 lie on the infinite line through S1 (cross product < tolerance)
- They **overlap spatially**: their projections onto the shared axis overlap (not just touch at a single point — a touch at a single point is a T-junction, not a shared edge)

When coincident, the retained segment spans the **union** of both (i.e., from min to max of both endpoint projections).

```python
# deduplicator.py
import numpy as np
from typing import List, Tuple
from shapely.geometry import LineString
from shapely.strtree import STRtree
from config import COINCIDENCE_TOL

Segment = Tuple[Tuple[float, float], Tuple[float, float]]


def _seg_to_linestring(seg: Segment) -> LineString:
    return LineString([seg[0], seg[1]])


def _are_collinear(s1: Segment, s2: Segment, tol: float = COINCIDENCE_TOL) -> bool:
    """
    Returns True if all 4 points of s1 and s2 are collinear within tolerance.
    Uses perpendicular distance of s2 endpoints from s1's infinite line.
    """
    p1, p2 = np.array(s1[0]), np.array(s1[1])
    p3, p4 = np.array(s2[0]), np.array(s2[1])
    
    d = p2 - p1
    length = np.linalg.norm(d)
    if length < 1e-10:
        return False  # degenerate segment
    
    d_unit = d / length
    
    # Perpendicular distance of p3 and p4 from the line through p1, p2
    def perp_dist(pt):
        v = pt - p1
        # cross product magnitude / |d|
        return abs(v[0] * d_unit[1] - v[1] * d_unit[0])
    
    return perp_dist(p3) < tol and perp_dist(p4) < tol


def _overlap_1d(a0: float, a1: float, b0: float, b1: float) -> Tuple[float, float]:
    """
    Returns the union span [min, max] of two 1D intervals [a0,a1] and [b0,b1].
    Returns (None, None) if they do not overlap (gap between them > COINCIDENCE_TOL).
    """
    lo_a, hi_a = min(a0, a1), max(a0, a1)
    lo_b, hi_b = min(b0, b1), max(b0, b1)
    
    # Check overlap (allow touching within tolerance)
    if hi_a + COINCIDENCE_TOL < lo_b or hi_b + COINCIDENCE_TOL < lo_a:
        return None, None  # no overlap
    
    return min(lo_a, lo_b), max(hi_a, hi_b)


def _merge_collinear_segments(s1: Segment, s2: Segment) -> Segment:
    """
    Merge two collinear overlapping segments into their union span.
    Projects both onto the primary axis (whichever has larger extent)
    and returns the merged segment.
    """
    p1, p2 = np.array(s1[0]), np.array(s1[1])
    p3, p4 = np.array(s2[0]), np.array(s2[1])
    
    # Determine primary axis
    dx = abs(p2[0] - p1[0])
    dy = abs(p2[1] - p1[1])
    
    if dx > dy:
        # Horizontal-ish: project onto X axis
        lo, hi = _overlap_1d(p1[0], p2[0], p3[0], p4[0])
        # Y value: use average of all 4 (they're collinear so nearly identical)
        y_avg = (p1[1] + p2[1] + p3[1] + p4[1]) / 4
        return (lo, y_avg), (hi, y_avg)
    else:
        # Vertical-ish: project onto Y axis
        lo, hi = _overlap_1d(p1[1], p2[1], p3[1], p4[1])
        x_avg = (p1[0] + p2[0] + p3[0] + p4[0]) / 4
        return (x_avg, lo), (x_avg, hi)


def _segments_are_coincident(s1: Segment, s2: Segment) -> bool:
    """
    Returns True if s1 and s2 are collinear AND their projections overlap.
    """
    if not _are_collinear(s1, s2):
        return False
    
    p1, p2 = np.array(s1[0]), np.array(s1[1])
    p3, p4 = np.array(s2[0]), np.array(s2[1])
    
    dx = abs(p2[0] - p1[0])
    dy = abs(p2[1] - p1[1])
    
    if dx > dy:
        lo, hi = _overlap_1d(p1[0], p2[0], p3[0], p4[0])
    else:
        lo, hi = _overlap_1d(p1[1], p2[1], p3[1], p4[1])
    
    return lo is not None  # overlap exists


def deduplicate_cut_segments(all_segments: List[Segment]) -> List[Segment]:
    """
    Given a list of CUT line segments in sheet space (all from all placed parts),
    return a deduplicated list where coincident segments are merged into one.
    
    Algorithm:
    1. Build Shapely STRtree for fast spatial pre-filtering
    2. For each unprocessed segment, find candidates within bounding box
    3. For each candidate, check collinearity + overlap
    4. If coincident, merge (union span), mark candidate as consumed
    5. Add merged (or original) to output
    
    This runs in O(n log n) average case due to the spatial index.
    For a typical sheet (50-200 segments), runs in <10ms.
    """
    if not all_segments:
        return []
    
    # Filter out degenerate segments (zero length)
    valid = [s for s in all_segments
             if np.linalg.norm(np.array(s[1]) - np.array(s[0])) > COINCIDENCE_TOL]
    
    linestrings = [_seg_to_linestring(s) for s in valid]
    tree = STRtree(linestrings)
    
    consumed = set()
    result = []
    
    for i, seg in enumerate(valid):
        if i in consumed:
            continue
        
        current = seg
        ls = _seg_to_linestring(current)
        
        # Find nearby candidates (bounding box proximity)
        # Buffer by tolerance to catch touching segments
        buffered = ls.buffer(COINCIDENCE_TOL * 2)
        candidates = tree.query(buffered)
        
        for j in candidates:
            if j == i or j in consumed:
                continue
            if _segments_are_coincident(current, valid[j]):
                # Merge the two segments
                current = _merge_collinear_segments(current, valid[j])
                consumed.add(j)
        
        result.append(current)
    
    return result


def collect_and_deduplicate(placements, mode: str, offset_x: float, offset_y: float) -> List[Segment]:
    """
    Collect all CUT segments from all placements, transform to sheet space,
    then deduplicate.
    
    placements: list of Placement objects
    mode: 'A' or 'B'
    offset_x, offset_y: sheet positioning offset
    """
    all_segs = []
    for placement in placements:
        segs = placement.cut_segments_in_sheet_space(mode, offset_x, offset_y)
        all_segs.extend(segs)
    
    deduped = deduplicate_cut_segments(all_segs)
    
    n_before = len(all_segs)
    n_after  = len(deduped)
    n_shared = n_before - n_after
    if n_shared > 0:
        import logging
        logging.info(f"  CUT dedup: {n_before} segments → {n_after} "
                     f"({n_shared} shared edges merged)")
    
    return deduped
```

---

## `writer.py`

### DXF Sheet Writer

**Key principle:** Non-CUT geometry is written via block inserts (fast, preserves all layer structure). CUT geometry is written as explicit LINE entities from the deduplicated segment list (never via block inserts).

```python
# writer.py
import os
import logging
import ezdxf
from ezdxf.enums import TextEntityAlignment
from typing import List, Tuple

from config import (
    SHEET_WIDTH, SHEET_HEIGHT, MARGIN,
    LAYER_CUT, LAYER_SHEETS, OUTPUT_DIR, CUT_OFFSET
)
from deduplicator import collect_and_deduplicate
from geometry import Placement

# DXF colors (ACI color codes)
COLOR_SHEETS_BORDER  = 7    # white/black
COLOR_SHEETS_MARGIN  = 8    # gray
COLOR_CUT            = 1    # red
COLOR_LABEL          = 2    # yellow


def _ensure_output_dir(output_dir: str):
    os.makedirs(output_dir, exist_ok=True)


def _draw_sheet_frame(msp, mode: str, offset_x: float, offset_y: float,
                      layout_w: float, layout_h: float):
    """
    Draw the SHEETS layer boundary and guide rects.
    
    Mode A: outer 1250×3200 rect + inner 35mm offset rect
    Mode B: outer 1250×3200 rect + equal-margin guide lines computed from layout
    """
    # Outer sheet boundary
    msp.add_lwpolyline(
        [(0,0), (SHEET_WIDTH,0), (SHEET_WIDTH,SHEET_HEIGHT),
         (0,SHEET_HEIGHT), (0,0)],
        dxfattribs={'layer': LAYER_SHEETS, 'color': COLOR_SHEETS_BORDER, 'closed': True}
    )
    
    if mode == 'A':
        # Inner margin rect
        m = MARGIN
        msp.add_lwpolyline(
            [(m,m), (SHEET_WIDTH-m,m), (SHEET_WIDTH-m,SHEET_HEIGHT-m),
             (m,SHEET_HEIGHT-m), (m,m)],
            dxfattribs={'layer': LAYER_SHEETS, 'color': COLOR_SHEETS_MARGIN, 'closed': True}
        )
    else:
        # Mode B: draw equal-margin guide rect based on centered layout
        x0 = offset_x
        y0 = offset_y
        x1 = offset_x + layout_w
        y1 = offset_y + layout_h
        msp.add_lwpolyline(
            [(x0,y0), (x1,y0), (x1,y1), (x0,y1), (x0,y0)],
            dxfattribs={'layer': LAYER_SHEETS, 'color': COLOR_SHEETS_MARGIN, 'closed': True}
        )


def _draw_label(msp, sheet_name: str, repeat_count: int):
    """Draw sheet label as TEXT entity above the sheet boundary."""
    label = f"{sheet_name}  x{repeat_count}"
    # Position: horizontally centered, 80mm above top edge
    msp.add_text(
        label,
        dxfattribs={
            'height': 50,
            'layer': LAYER_SHEETS,
            'color': COLOR_LABEL,
        }
    ).set_placement(
        (SHEET_WIDTH / 2, SHEET_HEIGHT + 80),
        align=TextEntityAlignment.MIDDLE_CENTER
    )


def _get_or_create_block(target_doc: ezdxf.document.Drawing,
                         source_part,
                         exclude_cut: bool = True) -> str:
    """
    Copy a part's geometry into the target sheet document as a named block.
    
    exclude_cut: if True, skip CUT layer entities (we write CUT separately)
    
    Returns the block name.
    """
    block_name = source_part.filename
    
    # Avoid re-creating if already defined in this doc
    if block_name in target_doc.blocks:
        return block_name
    
    source_doc = source_part.geometry.doc
    source_msp = source_doc.modelspace()
    
    # Create a new block definition in the target doc
    blk = target_doc.blocks.new(block_name)
    
    for entity in source_msp:
        if exclude_cut and entity.dxf.layer == 'CUT':
            continue
        try:
            # Clone entity into new block
            copy = entity.copy()
            blk.add_entity(copy)
        except Exception as e:
            logging.warning(f"Could not copy entity {entity.dxftype()} "
                            f"from {block_name}: {e}")
    
    return block_name


def write_sheet_dxf(layout, output_dir: str) -> str:
    """
    Write one SheetLayout to a .dxf file.
    
    Returns the output filepath.
    """
    _ensure_output_dir(output_dir)
    
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    
    # --- Ensure all required layers exist ---
    for layer_name, color in [
        (LAYER_SHEETS, COLOR_SHEETS_BORDER),
        (LAYER_CUT,    COLOR_CUT),
        ('0',          7),
        ('FREZ',       3),    # green
        ('FREZ_135',   4),    # cyan
        ('HOLES',      5),    # blue
    ]:
        if layer_name not in doc.layers:
            doc.layers.new(layer_name, dxfattribs={'color': color})
    
    # --- Pass 1: Non-CUT block inserts ---
    for placement in layout.placements:
        part = placement.part
        
        # Copy block definition into this doc (without CUT layer)
        block_name = _get_or_create_block(doc, part, exclude_cut=True)
        
        # Compute insert position in sheet space
        insert_x, insert_y = placement.to_sheet_coords(
            layout.mode, layout.offset_x, layout.offset_y
        )
        
        rotation_deg = float(placement.rotation)
        
        msp.add_blockref(
            block_name,
            insert=(insert_x, insert_y),
            dxfattribs={'rotation': rotation_deg}
        )
    
    # --- Pass 2: Deduplicated CUT lines ---
    deduped_cut = collect_and_deduplicate(
        layout.placements,
        layout.mode,
        layout.offset_x,
        layout.offset_y
    )
    
    for seg in deduped_cut:
        (x1, y1), (x2, y2) = seg
        msp.add_line(
            (x1, y1), (x2, y2),
            dxfattribs={'layer': LAYER_CUT, 'color': COLOR_CUT}
        )
    
    # --- Sheet frame and label ---
    if layout.placements:
        layout_w = max(pl.pack_x + pl.cut_width  for pl in layout.placements)
        layout_h = max(pl.pack_y + pl.cut_height for pl in layout.placements)
    else:
        layout_w, layout_h = 0, 0
    
    _draw_sheet_frame(msp, layout.mode, layout.offset_x, layout.offset_y,
                      layout_w, layout_h)
    _draw_label(msp, layout.sheet_name, layout.repeat_count)
    
    # --- Save ---
    filename = f"{layout.sheet_name}_x{layout.repeat_count}.dxf"
    filepath = os.path.join(output_dir, filename)
    doc.saveas(filepath)
    
    logging.info(
        f"Written: {filename}  "
        f"({len(layout.placements)} placements, repeat×{layout.repeat_count}, "
        f"mode {layout.mode}, {len(deduped_cut)} CUT segments)"
    )
    
    return filepath
```

---

## Writer Edge Cases

### Block Insert + Rotation
ezdxf block inserts with `rotation=90` rotate around the insert point. Since we use the CUT boundary corner (bottom-left of the CUT bbox) as the insert point, a 90° rotation needs a coordinate adjustment:

When a part is rotated 90° CCW in packing space:
- The packer places it with swapped dimensions: `w_packed = cut_height, h_packed = cut_width`
- The block definition is unrotated (natural orientation)
- Setting `rotation=90` in the block insert rotates the geometry 90° CCW around the insert point

Verify that the insert point + rotation gives the correct physical position by checking:
- Bottom-left CUT corner in sheet space = `(offset_x + pack_x, offset_y + pack_y)` ✓
- After 90° CCW rotation around that point, the part's geometry occupies the correct area

### Ensuring Layer Names Match
The block copy step copies entities verbatim — including their `layer` attribute. This means the target DXF inherits whatever layer names exist in the source part. Ensure `doc.layers.new(...)` is called for all expected layer names before inserting blocks, or ezdxf will auto-create them with default styling.

### CUT Segments from Arcs/Splines
Parts with circular holes (HOLES layer) or curved cuts will have CUT boundaries approximated as polyline segments (64-division arcs). The deduplication algorithm handles these correctly since it operates on individual line segments. Curved shared edges are rare in facade ACM work but supported.

### Zero-Length Segments
Filter out segments where `|p2 - p1| < COINCIDENCE_TOL` before deduplication. These arise from LWPOLYLINE entities with repeated vertices or from arc approximation endpoints.
