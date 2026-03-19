"""
FREZ bending-line sort — "Juggler" optimization
Aspect-ratio aware scoring with anti-juggling thick tiers
and center vacuum-preservation (Horizontal before Vertical).

Background
----------
Previous algorithms (like shapely or conman) scored lines in raw
millimeters. On a 1250x3200 sheet (aspect ratio 0.39:1), a vertical line
600mm from the edge is exactly in the center, while a horizontal line
600mm from the bottom is still near the edge. Raw-mm grouping placed
them in the same tier, causing premature cutting of center vertical
lines which ruins the vacuum hold-down.

Furthermore, strict outside-in sorting (e.g. 1mm tiers) forces the machine
to jump side-to-side (Left -> Right -> Top -> Bottom) constantly to relieve
tension symmetrically, resulting in a "circus juggler" toolpath with
huge rapid-travel distances.

The "Juggler" Solution
----------------------
1. Percentage Scoring: Distance to edge is calculated as a percentage
   of the sheet dimension (X or Y). A score of 0.0 is the edge, 0.5
   is the dead center. This normalizes the 0.39:1 aspect ratio.
2. Thick Tiers (Anti-Juggling): Lines are grouped into thick tiers
   (e.g., 10% depth bands). Within this thick band, the tool uses
   Nearest-Neighbor to trace the perimeter continuously, clearing
   entire sides before moving across the sheet.
3. Center Vacuum Preservation: When approaching the center of the sheet
   (depth >= 25%), the algorithm strictly separates horizontal lines
   from vertical lines. Horizontal lines are always cut FIRST because
   they are usually shorter; long vertical lines that split the sheet 
   in half are saved for the absolute end to maximize vacuum hold-down.
"""

from .models import Contour, BBox

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------
MAX_TIER_THICKNESS = 0.10  # 10% of dimension (thick bands to stop side-juggling)
CENTER_THRESHOLD   = 0.25  # >= 25% relative depth is considered the "center zone"


def _line_bbox(contour: Contour) -> tuple[float, float, float, float]:
    """Return (x_min, y_min, x_max, y_max) of a contour's bounding box."""
    xs = [p.x for p in contour.points]
    ys = [p.y for p in contour.points]
    return min(xs), min(ys), max(xs), max(ys)


def _classify_and_score(
    contour: Contour,
    sheet_xmin: float,
    sheet_ymin: float,
    sheet_xmax: float,
    sheet_ymax: float,
) -> tuple[float, bool]:
    """
    Returns (relative_score, is_vertical).
    relative_score: 0.0 (at the absolute edge) to 0.5 (dead center).
    This normalizes the varying X/Y aspect ratios.
    """
    width = sheet_xmax - sheet_xmin
    height = sheet_ymax - sheet_ymin
    
    # safeguard against zero-division
    if width <= 0: width = 1.0
    if height <= 0: height = 1.0

    x_min, y_min, x_max, y_max = _line_bbox(contour)
    dx = x_max - x_min
    dy = y_max - y_min

    is_vertical = dy >= dx

    if is_vertical:
        x_mid = (x_min + x_max) / 2.0
        dist = min(x_mid - sheet_xmin, sheet_xmax - x_mid)
        score = dist / width
    else:
        y_mid = (y_min + y_max) / 2.0
        dist = min(y_mid - sheet_ymin, sheet_ymax - y_mid)
        score = dist / height

    return score, is_vertical


def _dist_sq(ax: float, ay: float, bx: float, by: float) -> float:
    return (ax - bx) ** 2 + (ay - by) ** 2


# Type alias: (relative_score, is_vertical, contour)
_Entry = tuple[float, bool, Contour]


def _nn_within_tier(
    tier_entries: list[_Entry],
    cx: float,
    cy: float,
) -> tuple[list[Contour], float, float]:
    """
    Greedy nearest-neighbour traversal. Because tiers are now 'thick',
    this will trace localized perimeters instead of hopping back and forth.
    """
    unvisited = list(tier_entries)
    ordered = []

    while unvisited:
        best_idx = 0
        best_dsq = float("inf")
        best_rev = False

        for i, (_, _, c) in enumerate(unvisited):
            p0 = c.points[0]
            p1 = c.points[-1]
            d0 = _dist_sq(cx, cy, p0.x, p0.y)
            d1 = _dist_sq(cx, cy, p1.x, p1.y)
            d = min(d0, d1)
            
            if d < best_dsq:
                best_dsq = d
                best_idx = i
                best_rev = d1 < d0

        _, _, chosen = unvisited.pop(best_idx)

        # Reverse contour if entering from the opposite end is faster
        if best_rev:
            chosen = Contour(list(reversed(chosen.points)), chosen.is_closed)

        ordered.append(chosen)
        cx = chosen.points[-1].x
        cy = chosen.points[-1].y

    return ordered, cx, cy


def sort_frez_juggler(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sort FREZ (bending) lines prioritizing aspect-ratio percentage depth,
    anti-juggling localized paths, and preserving vacuum in the center.
    """
    if not contours:
        return []

    sheet_xmin = stock_bbox.min_x
    sheet_ymin = stock_bbox.min_y
    sheet_xmax = stock_bbox.max_x
    sheet_ymax = stock_bbox.max_y

    all_entries: list[_Entry] = []

    # 1. Score every contour dynamically by percentage of total width/height
    for c in contours:
        if len(c.points) < 2:
            all_entries.append((float("inf"), False, c))
            continue

        score, is_vertical = _classify_and_score(
            c, sheet_xmin, sheet_ymin, sheet_xmax, sheet_ymax
        )
        all_entries.append((score, is_vertical, c))

    # 2. Sort ascending from outside to inside
    all_entries.sort(key=lambda e: e[0])

    # 3. Group into thick depth bands (e.g. 10% thickness)
    raw_tiers = []
    if all_entries:
        current_group = [all_entries[0]]
        tier_start_score = all_entries[0][0]
        
        for entry in all_entries[1:]:
            score = entry[0]
            if score - tier_start_score <= MAX_TIER_THICKNESS:
                current_group.append(entry)
            else:
                raw_tiers.append(current_group)
                tier_start_score = score
                current_group = [entry]
        raw_tiers.append(current_group)

    # 4. Process center splits (Vacuum Preservation Rule)
    processed_tiers = []
    for group in raw_tiers:
        # If any line in this tier breaches the center zone threshold,
        # we enforce the "Horizontal before Vertical" rule.
        is_center_tier = any(e[0] >= CENTER_THRESHOLD for e in group)
        
        if is_center_tier:
            h_group = [e for e in group if not e[1]]
            v_group = [e for e in group if e[1]]
            
            # Queue Horizontal lines first
            if h_group:
                processed_tiers.append(h_group)
            # Queue Vertical lines last
            if v_group:
                processed_tiers.append(v_group)
        else:
            # Outer tiers are kept together so NN can trace perimeter efficiently
            processed_tiers.append(group)

    # 5. Execute Nearest Neighbor routing across the optimized tiers
    result: list[Contour] = []
    
    # Seed tool position at the first point of the very first cut
    if processed_tiers:
        seed = processed_tiers[0][0][2]
        cx, cy = seed.points[0].x, seed.points[0].y
    else:
        cx, cy = sheet_xmin, sheet_ymin

    for tier_entries in processed_tiers:
        ordered, cx, cy = _nn_within_tier(tier_entries, cx, cy)
        result.extend(ordered)

    return result