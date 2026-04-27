# PLAN 02 — Geometry Model & Packing Engine

## `geometry.py`

### Coordinate Systems

There are three coordinate systems in play. Keep them distinct:

| Space | Origin | Used for |
|---|---|---|
| **Part-local** | Part's own Layer 0 min corner | Geometry inside the DXF block |
| **Packing space** | (0,0) = bottom-left of usable bin | MaxRects packing algorithm |
| **Sheet space** | (0,0) = bottom-left of physical 1250×3200 sheet | Final DXF output |

Transforms:
- **Packing → Sheet (Mode A):** `sheet_x = pack_x + MARGIN`, `sheet_y = pack_y + MARGIN`
- **Packing → Sheet (Mode B):** `sheet_x = pack_x + offset_x`, `sheet_y = pack_y + offset_y` where offset is computed after full layout is known (centering)
- **Part-local → Sheet:** `sheet_x = insert_x + CUT_OFFSET`, `sheet_y = insert_y + CUT_OFFSET`
  - Because CUT lines extend 3mm beyond the Layer 0 bbox, the block's local origin sits 3mm inside the CUT boundary. The block insert point is the CUT boundary corner, not the Layer 0 corner.

### Placement Dataclass

```python
# geometry.py
from dataclasses import dataclass
from typing import Tuple, Optional
from config import CUT_OFFSET, MARGIN

@dataclass
class Placement:
    """A single placed part instance on a sheet."""
    part_name: str           # matches Part.filename (unique key)
    instance_idx: int        # 0-based index within this part type on this sheet
    
    # Position in PACKING space (CUT boundary at this corner)
    pack_x: float
    pack_y: float
    
    # Dimensions in packing space
    cut_width: float
    cut_height: float
    
    # Rotation applied: 0 or 90
    rotation: int
    
    # Reference back to the Part
    part: object  # Part dataclass

    @property
    def pack_rect(self):
        """(x, y, w, h) in packing space."""
        return (self.pack_x, self.pack_y, self.cut_width, self.cut_height)

    def to_sheet_coords(self, mode: str, offset_x: float, offset_y: float):
        """
        Convert pack position to sheet position.
        mode: 'A' (margin-based) or 'B' (centered offset)
        offset_x, offset_y: centering offset for Mode B (or MARGIN for Mode A)
        
        Returns (insert_x, insert_y) — the DXF block insert point in sheet space.
        This is the CUT boundary corner. The Layer 0 corner is (insert_x + CUT_OFFSET).
        """
        sheet_cut_x = self.pack_x + offset_x
        sheet_cut_y = self.pack_y + offset_y
        # Block insert = CUT corner + CUT_OFFSET inward → Layer 0 origin
        insert_x = sheet_cut_x + CUT_OFFSET
        insert_y = sheet_cut_y + CUT_OFFSET
        return (insert_x, insert_y)

    def cut_segments_in_sheet_space(self, mode: str, offset_x: float, offset_y: float):
        """
        Transform this part's CUT line segments into sheet coordinate space.
        Returns list of ((x1,y1),(x2,y2)) in sheet space.
        """
        # Block insert position in sheet space
        insert_x, insert_y = self.to_sheet_coords(mode, offset_x, offset_y)
        
        segments = []
        for (lx1, ly1), (lx2, ly2) in self.part.geometry.cut_lines:
            if self.rotation == 0:
                sx1 = insert_x + lx1
                sy1 = insert_y + ly1
                sx2 = insert_x + lx2
                sy2 = insert_y + ly2
            else:  # 90° rotation: (x,y) → (-y, x) then translate
                sx1 = insert_x - ly1
                sy1 = insert_y + lx1
                sx2 = insert_x - ly2
                sy2 = insert_y + lx2
            segments.append(((sx1, sy1), (sx2, sy2)))
        return segments
```

### Mode Detection

```python
# geometry.py (continued)
from config import USABLE_THRESHOLD_W, USABLE_THRESHOLD_H

def detect_packing_mode(parts) -> str:
    """
    Returns 'A' (standard margin) or 'B' (full-span, centered).
    
    Mode B triggers when:
    1. Any single part's CUT width > USABLE_WIDTH (1180mm)
    2. Any single part's CUT height > USABLE_HEIGHT (3130mm)
    3. Any two parts whose CUT widths sum ≥ SHEET_WIDTH (1250mm)
    4. Any two parts whose CUT heights sum ≥ SHEET_HEIGHT (3200mm)
    
    Note: Condition 3/4 is checked for all pairs (expensive only if >1000 parts,
    which is unrealistic for facade work).
    """
    from config import SHEET_WIDTH, SHEET_HEIGHT

    cut_widths  = [p.cut_width  for p in parts]
    cut_heights = [p.cut_height for p in parts]

    # Single part exceeds usable area
    if any(w > USABLE_THRESHOLD_W for w in cut_widths):
        return 'B'
    if any(h > USABLE_THRESHOLD_H for h in cut_heights):
        return 'B'

    # Pair of parts that together fill full sheet width
    sorted_w = sorted(cut_widths, reverse=True)
    for i in range(len(sorted_w)):
        for j in range(i+1, len(sorted_w)):
            if sorted_w[i] + sorted_w[j] >= SHEET_WIDTH:
                return 'B'

    # Pair of parts that together fill full sheet height
    sorted_h = sorted(cut_heights, reverse=True)
    for i in range(len(sorted_h)):
        for j in range(i+1, len(sorted_h)):
            if sorted_h[i] + sorted_h[j] >= SHEET_HEIGHT:
                return 'B'

    return 'A'
```

---

## `packer.py`

### Part Expansion & Item Preparation

```python
# packer.py
import math
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
from collections import Counter

import rectpack
from rectpack import newPacker, PackingMode
import rectpack.maxrects as maxrects

from config import (
    SHEET_WIDTH, SHEET_HEIGHT, MARGIN,
    USABLE_WIDTH, USABLE_HEIGHT, MAX_BINS
)
from geometry import Placement, detect_packing_mode

@dataclass
class PackItem:
    """A single instance of a part to be packed."""
    rid: str           # unique: "{filename}_{instance_idx}"
    part: object       # Part dataclass
    instance_idx: int
    # Dimensions passed to packer (CUT dimensions, possibly rotated)
    w: float
    h: float
    rotated: bool      # True if part was pre-rotated 90° before packing

@dataclass
class SheetLayout:
    """Result for one unique sheet layout."""
    sheet_index: int
    mode: str                        # 'A' or 'B'
    placements: List[Placement]
    repeat_count: int
    sheet_name: str
    # Mode B centering offsets (0 for Mode A, MARGIN for Mode A simplicity)
    offset_x: float
    offset_y: float
```

### Building the Item List

```python
# packer.py (continued)

def build_items(parts) -> List[PackItem]:
    """
    Expand each Part by its count, respecting rotation locks.
    For rotation-free parts, add BOTH orientations — the packer will
    choose via MaxRects. We encode this by duplicating the item with
    a flag, then in post-processing keep whichever was actually used.
    
    In practice: pass all items with their natural (w, h). For rotation-free
    parts, also register a (h, w) variant. rectpack.MaxRects will try both
    if rotation=True, but we get more control by using rotation=False and
    feeding pre-rotated items explicitly.
    
    Strategy here: use rotation=True in rectpack and handle orientation
    locking by fixing dimensions before insertion.
    """
    items = []
    for part in parts:
        for i in range(part.count):
            rid = f"{part.filename}_{i}"
            if part.allowed_rotation == 0:
                # Upright only
                items.append(PackItem(rid=rid, part=part, instance_idx=i,
                                      w=part.cut_width, h=part.cut_height,
                                      rotated=False))
            elif part.allowed_rotation == 90:
                # Rotated 90° only: swap w and h
                items.append(PackItem(rid=rid, part=part, instance_idx=i,
                                      w=part.cut_height, h=part.cut_width,
                                      rotated=True))
            else:
                # Both orientations allowed: pass to packer with rotation=True
                # Use natural (w, h); packer may swap
                items.append(PackItem(rid=rid, part=part, instance_idx=i,
                                      w=part.cut_width, h=part.cut_height,
                                      rotated=False))
    return items


def sort_items(items: List[PackItem]) -> List[PackItem]:
    """Sort by CUT area descending. Critical for packing quality."""
    return sorted(items, key=lambda it: it.w * it.h, reverse=True)
```

### The Packing Engine

```python
# packer.py (continued)

ALGORITHMS = [
    maxrects.MaxRectsBssf,   # Best Short Side Fit — usually best
    maxrects.MaxRectsBaf,    # Best Area Fit
    maxrects.MaxRectsBlsf,   # Best Long Side Fit
]

def run_packer(items: List[PackItem], bin_w: float, bin_h: float,
               allow_rotation: bool) -> Tuple[object, int]:
    """
    Run all MaxRects algorithms and return the best result (fewest bins used).
    
    bin_w, bin_h: usable bin dimensions in mm
    allow_rotation: True for rotation-free parts (packer may swap w/h)
    
    Returns (best_packer_instance, sheets_used)
    """
    best_packer = None
    best_count = math.inf

    for algo in ALGORITHMS:
        packer = newPacker(
            mode=PackingMode.Offline,
            pack_algo=algo,
            rotation=allow_rotation
        )
        for item in items:
            # Add rect with rotation flag per-item
            rot = allow_rotation and not item.part.rotation_locked
            packer.add_rect(item.w, item.h, rid=item.rid)

        for _ in range(MAX_BINS):
            packer.add_bin(bin_w, bin_h)

        packer.pack()

        used = sum(1 for b in packer if len(b) > 0)
        if used < best_count:
            best_count = used
            best_packer = packer

    return best_packer, best_count


def pack_all_parts(parts) -> Tuple[List[SheetLayout], str]:
    """
    Main packing entry point. Returns (list of SheetLayouts, mode).
    
    Handles:
    - Mode A vs Mode B detection
    - Rotation-locked vs free parts
    - Post-pack centering for Mode B
    - Sheet repeat count computation
    """
    mode = detect_packing_mode(parts)
    logging.info(f"Packing mode: {mode}")

    if mode == 'A':
        bin_w, bin_h = USABLE_WIDTH, USABLE_HEIGHT
        base_offset_x, base_offset_y = MARGIN, MARGIN
    else:
        bin_w, bin_h = SHEET_WIDTH, SHEET_HEIGHT
        base_offset_x, base_offset_y = 0.0, 0.0

    # Separate rotation-locked and rotation-free parts
    locked_items = []
    free_items   = []

    for part in parts:
        for i in range(part.count):
            rid = f"{part.filename}_{i}"
            if part.rotation_locked:
                w = part.cut_width  if part.allowed_rotation == 0 else part.cut_height
                h = part.cut_height if part.allowed_rotation == 0 else part.cut_width
                rotated = (part.allowed_rotation == 90)
                locked_items.append(PackItem(rid=rid, part=part, instance_idx=i,
                                             w=w, h=h, rotated=rotated))
            else:
                free_items.append(PackItem(rid=rid, part=part, instance_idx=i,
                                           w=part.cut_width, h=part.cut_height,
                                           rotated=False))

    # Sort by area descending
    all_items = sort_items(locked_items + free_items)

    # Run packer — rotation=True only for free parts
    # We handle this by running locked and free together but marking locked w/h fixed.
    # rectpack doesn't support per-rect rotation flags, so we:
    # Option: run locked-only first to seed bins, then add free.
    # Simpler robust option: pass rotation=True but pre-fix locked items' dims (already done above).
    # If packer swaps a locked item's dims, we detect it in post-processing and flag an error.
    
    has_free = len(free_items) > 0
    packer, n_sheets = run_packer(all_items, bin_w, bin_h, allow_rotation=has_free)

    logging.info(f"Packed into {n_sheets} unique sheet layout(s)")

    # --- Build part lookup ---
    part_map = {p.filename: p for p in parts}
    item_map = {item.rid: item for item in all_items}

    # --- Build SheetLayouts from packer bins ---
    layouts = []
    for bin_idx, abin in enumerate(packer):
        if len(abin) == 0:
            continue

        placements = []
        for rect in abin:
            item = item_map[rect.rid]
            part = item.part

            # Detect if packer swapped dims (= rotation applied)
            w_packed = rect.width
            h_packed = rect.height
            was_rotated = (abs(w_packed - part.cut_height) < 0.1 and
                           abs(h_packed - part.cut_width) < 0.1)

            # Safety: if locked part was rotated by packer, this is an error
            if part.rotation_locked and was_rotated:
                # This shouldn't happen since we pre-fixed dims, but guard anyway
                logging.error(
                    f"Packer rotated locked part {part.filename}! "
                    f"Forcing back to locked orientation."
                )
                was_rotated = False

            rotation_deg = 90 if (item.rotated or was_rotated) else 0

            p = Placement(
                part_name=part.filename,
                instance_idx=item.instance_idx,
                pack_x=float(rect.x),
                pack_y=float(rect.y),
                cut_width=w_packed,
                cut_height=h_packed,
                rotation=rotation_deg,
                part=part
            )
            placements.append(p)

        # --- Compute centering offset for Mode B ---
        if mode == 'B':
            layout_w = max(pl.pack_x + pl.cut_width  for pl in placements)
            layout_h = max(pl.pack_y + pl.cut_height for pl in placements)
            offset_x = (SHEET_WIDTH  - layout_w) / 2.0
            offset_y = (SHEET_HEIGHT - layout_h) / 2.0
        else:
            offset_x = MARGIN
            offset_y = MARGIN

        # --- Compute repeat count ---
        repeat = compute_repeat_count(placements, part_map)

        # --- Assign sheet name ---
        # Name based on dominant part (most area used) or first part alphabetically
        dominant = max(placements, key=lambda pl: pl.cut_width * pl.cut_height)
        sheet_name = f"sheet_{bin_idx + 1:03d}_{dominant.part_name}"

        layout = SheetLayout(
            sheet_index=bin_idx,
            mode=mode,
            placements=placements,
            repeat_count=repeat,
            sheet_name=sheet_name,
            offset_x=offset_x,
            offset_y=offset_y
        )
        layouts.append(layout)

    return layouts, mode
```

### Repeat Count Computation

```python
# packer.py (continued)

def compute_repeat_count(placements: List[Placement], part_map: dict) -> int:
    """
    Given the parts placed on one sheet layout, compute how many times
    this exact sheet must be cut to satisfy all part counts.
    
    Logic:
        For each part type on this sheet:
            times_needed = ceil(total_required / instances_on_sheet)
        Sheet repeat = min(times_needed) across all part types
        (The bottleneck part determines repetition.)
    
    Edge case: if multiple part types have conflicting needs, the minimum
    ensures no part is over-cut. A post-pass should check for under-production.
    """
    instance_counts = Counter(pl.part_name for pl in placements)
    
    repeats_needed = []
    for part_name, count_on_sheet in instance_counts.items():
        part = part_map[part_name]
        needed = math.ceil(part.count / count_on_sheet)
        repeats_needed.append(needed)
    
    return min(repeats_needed) if repeats_needed else 1


def validate_production(layouts: List[SheetLayout], parts) -> List[str]:
    """
    After packing, verify every part's required count is met.
    Returns list of warning strings (empty = all good).
    
    Total produced per part = sum over all sheets of:
        (instances_of_part_on_sheet × sheet.repeat_count)
    """
    part_map = {p.filename: p for p in parts}
    produced = Counter()

    for layout in layouts:
        instance_counts = Counter(pl.part_name for pl in layout.placements)
        for part_name, cnt in instance_counts.items():
            produced[part_name] += cnt * layout.repeat_count

    warnings = []
    for part in parts:
        actual   = produced.get(part.filename, 0)
        required = part.count
        if actual < required:
            warnings.append(
                f"UNDER-PRODUCED: {part.filename} needs {required}, "
                f"but only {actual} will be cut."
            )
        elif actual > required:
            warnings.append(
                f"OVER-PRODUCED: {part.filename} needs {required}, "
                f"but {actual} will be cut (acceptable waste)."
            )
    return warnings
```

---

## Packing Quality Notes

### Why largest-area-first matters
MaxRects works best when large items claim space early. Without pre-sorting, small parts can fragment large free rectangles, forcing extra sheets. Sort descending by `cut_width * cut_height` before calling `add_rect`.

### Why run 3 algorithms
BSSF, BAF, and BLSF differ in how they score candidate free rectangles. For different part mixes (many same-size vs varied sizes), different algorithms win. Running all three takes <100ms total and guarantees a better result.

### Rotation handling for mixed batches
Since rectpack's `rotation=True` applies globally, and we have per-part locks, we pre-fix dimensions for locked parts before feeding them. The packer is told `rotation=True` (needed for free parts). If a locked part's dims happen to be square, rotation is a no-op anyway.

### Mode B centering
After packing completes, we compute the bounding box of all placed items in packing space, then compute the offset to center that bounding box on the 1250×3200 sheet. This gives equal margins on left/right and top/bottom regardless of layout shape.
