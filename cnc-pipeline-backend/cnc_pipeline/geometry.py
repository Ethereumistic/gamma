# cnc_pipeline/geometry.py
import math
from .models import Point, Segment, BBox, Contour

def dist_sq(p1: Point, p2: Point) -> float:
    return (p1.x - p2.x)**2 + (p1.y - p2.y)**2

def is_collinear(p1: Point, p2: Point, p3: Point, tol: float = 0.01) -> bool:
    v1_x = p3.x - p1.x
    v1_y = p3.y - p1.y
    length_sq = v1_x**2 + v1_y**2
    if length_sq < 1e-9:
        return dist_sq(p1, p2) <= tol**2
    cross = abs((p3.x - p1.x)*(p1.y - p2.y) - (p1.x - p2.x)*(p3.y - p1.y))
    return cross / (length_sq**0.5) <= tol

def simplify_contour(contour: Contour, tolerance: float = 0.05) -> Contour:
    points = contour.points
    if len(points) <= 2:
        return contour
    simplified = [points[0]]
    for i in range(1, len(points) - 1):
        if not is_collinear(simplified[-1], points[i], points[i+1], tolerance):
            simplified.append(points[i])
    simplified.append(points[-1])
    return Contour(simplified, contour.is_closed)


def contour_bbox(c: Contour) -> BBox:
    if not c.points:
        return BBox(0, 0, 0, 0)
    return BBox(
        min(p.x for p in c.points),
        min(p.y for p in c.points),
        max(p.x for p in c.points),
        max(p.y for p in c.points)
    )

def bbox_contains(parent: BBox, child: BBox, tol: float = 2.0) -> bool:
    """Returns True if the child bbox is completely inside the parent bbox."""
    return (parent.min_x - tol <= child.min_x and
            parent.max_x + tol >= child.max_x and
            parent.min_y - tol <= child.min_y and
            parent.max_y + tol >= child.max_y)

def optimize_closed_start_and_direction(c: Contour, start_pos: Point) -> Contour:
    """
    Forces a closed contour into Clockwise (CW) direction and rotates its
    points to start at the point closest to start_pos.
    """
    if not c.points or len(c.points) < 3:
        return c

    area_sum = 0.0
    n = len(c.points)
    for i in range(n):
        p1 = c.points[i]
        p2 = c.points[(i + 1) % n]
        area_sum += (p2.x - p1.x) * (p2.y + p1.y)

    points = list(c.points)
    if area_sum > 0:
        points.reverse()

    best_idx = 0
    min_d = dist_sq(start_pos, points[0])
    for i in range(1, len(points)):
        d = dist_sq(start_pos, points[i])
        if d < min_d:
            min_d = d
            best_idx = i

    rotated = points[best_idx:] + points[:best_idx]
    return Contour(rotated, True)


# ---------------------------------------------------------------------------
# Module-level geometry helpers shared by multiple FREZ sorting algorithms
# ---------------------------------------------------------------------------

def contour_bbox_area(c: Contour) -> float:
    """Bounding-box area of a contour. Used for size-based classification."""
    if not c.points:
        return 0.0
    min_x = min(p.x for p in c.points)
    max_x = max(p.x for p in c.points)
    min_y = min(p.y for p in c.points)
    max_y = max(p.y for p in c.points)
    return (max_x - min_x) * (max_y - min_y)


def frez_tension_score(contour: Contour, stock_bbox: BBox) -> float:
    """
    Max depth a contour reaches into the panel interior.
    Perimeter lines: low score. Interior rectangles/dividers: high score.
    """
    if not contour.points:
        return 0.0
    max_depth = 0.0

    def probe(p: Point) -> None:
        nonlocal max_depth
        d = min(
            p.x - stock_bbox.min_x,
            stock_bbox.max_x - p.x,
            p.y - stock_bbox.min_y,
            stock_bbox.max_y - p.y,
        )
        if d > max_depth:
            max_depth = d

    for p in contour.points:
        probe(p)
    pts = contour.points
    for i in range(len(pts) - 1):
        probe(Point((pts[i].x + pts[i+1].x) * 0.5, (pts[i].y + pts[i+1].y) * 0.5))
    if contour.is_closed and len(pts) > 1:
        probe(Point((pts[-1].x + pts[0].x) * 0.5, (pts[-1].y + pts[0].y) * 0.5))
    return max_depth


def nn_sort_contours(group: list[Contour], start_pos: Point) -> list[Contour]:
    """Nearest-neighbour greedy sort within a group, starting from start_pos."""
    ordered: list[Contour] = []
    unvisited = group.copy()
    current = start_pos
    while unvisited:
        best_idx = 0
        best_dist = float('inf')
        for i, c in enumerate(unvisited):
            d = dist_sq(current, c.points[0])
            if d < best_dist:
                best_dist = d
                best_idx = i
        next_c = unvisited.pop(best_idx)
        ordered.append(next_c)
        current = next_c.points[-1]
    return ordered


def sort_outer_to_inner(contours: list[Contour], sheet_bbox: BBox) -> list[Contour]:
    """Legacy centroid-distance sort. Kept for CUT layer use."""
    if not contours:
        return []
    cx = (sheet_bbox.min_x + sheet_bbox.max_x) / 2
    cy = (sheet_bbox.min_y + sheet_bbox.max_y) / 2

    def max_dist_to_centroid(c: Contour) -> float:
        return max(dist_sq(p, Point(cx, cy)) for p in c.points)

    return sorted(contours, key=max_dist_to_centroid, reverse=True)


# ---------------------------------------------------------------------------
# FREZ Algorithm: RAPTOR  (v0.4)
# ---------------------------------------------------------------------------
def sort_frez_raptor(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """Raptor: max-depth polar-sweep algorithm (v0.4)."""
    if not contours:
        return []

    scored = [(frez_tension_score(c, stock_bbox), c) for c in contours]
    scored.sort(key=lambda x: x[0])
    scores = [s for s, _ in scored]
    sorted_contours = [c for _, c in scored]

    def cluster_into_rings(
        sc_scores: list[float], sc_contours: list[Contour]
    ) -> list[list[tuple[float, Contour]]]:
        n = len(sc_scores)
        if n == 1:
            return [[(sc_scores[0], sc_contours[0])]]
        gaps = [sc_scores[i + 1] - sc_scores[i] for i in range(n - 1)]
        sorted_gaps = sorted(gaps)
        median_gap = sorted_gaps[len(sorted_gaps) // 2] if sorted_gaps else 0.0
        threshold = median_gap * 3.0 if median_gap > 0.01 else float('inf')
        rings: list[list[tuple[float, Contour]]] = []
        current_ring: list[tuple[float, Contour]] = [(sc_scores[0], sc_contours[0])]
        for i in range(1, n):
            if gaps[i - 1] >= threshold:
                rings.append(current_ring)
                current_ring = []
            current_ring.append((sc_scores[i], sc_contours[i]))
        rings.append(current_ring)
        return rings

    rings = cluster_into_rings(scores, sorted_contours)

    cx = (stock_bbox.min_x + stock_bbox.max_x) / 2
    cy = (stock_bbox.min_y + stock_bbox.max_y) / 2
    bl = Point(stock_bbox.min_x, stock_bbox.min_y)
    ref_angle = math.atan2(bl.y - cy, bl.x - cx)

    def contour_centroid(c: Contour) -> Point:
        ax = sum(p.x for p in c.points) / len(c.points)
        ay = sum(p.y for p in c.points) / len(c.points)
        return Point(ax, ay)

    def clockwise_angle(c: Contour) -> float:
        cen = contour_centroid(c)
        raw = math.atan2(cen.y - cy, cen.x - cx)
        return (ref_angle - raw) % (2 * math.pi)

    result: list[Contour] = []
    current_pos: Point = Point(stock_bbox.min_x, stock_bbox.min_y)

    for ring in rings:
        ring_contours = [c for _, c in ring]
        ring_contours.sort(
            key=lambda c: (0 if c.is_closed else 1, clockwise_angle(c))
        )
        for c in ring_contours:
            d_fwd = dist_sq(current_pos, c.points[0])
            d_rev = dist_sq(current_pos, c.points[-1])
            if d_rev < d_fwd:
                c = Contour(list(reversed(c.points)), c.is_closed)
            result.append(c)
            current_pos = c.points[-1]

    return result


def sort_nearest_neighbour(contours: list[Contour]) -> list[Contour]:
    if not contours:
        return []

    contours_with_area = [(contour_bbox_area(c), c) for c in contours]
    contours_with_area.sort(key=lambda x: x[0])

    tiers = []
    current_tier = [contours_with_area[0][1]]
    current_area = contours_with_area[0][0]

    for area, c in contours_with_area[1:]:
        if area > current_area + 100.0:
            tiers.append(current_tier)
            current_tier = [c]
            current_area = area
        else:
            current_tier.append(c)

    if current_tier:
        tiers.append(current_tier)

    ordered_contours: list[Contour] = []
    current_pos = Point(0, 0)

    for tier in tiers:
        sorted_tier = nn_sort_contours(tier, current_pos)
        ordered_contours.extend(sorted_tier)
        if sorted_tier:
            current_pos = sorted_tier[-1].points[-1]

    return ordered_contours


# ---------------------------------------------------------------------------
# FREZ Algorithm: ANCHOR  (v0.5)
# ---------------------------------------------------------------------------
def sort_frez_anchor(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    if not contours:
        return []

    part_min_x = min(min(p.x for p in c.points) for c in contours)
    part_min_y = min(min(p.y for p in c.points) for c in contours)
    part_max_x = max(max(p.x for p in c.points) for c in contours)
    part_max_y = max(max(p.y for p in c.points) for c in contours)
    part_bbox = BBox(part_min_x, part_min_y, part_max_x, part_max_y)

    part_short = min(part_max_x - part_min_x, part_max_y - part_min_y)
    perimeter_threshold = max(50.0, part_short * 0.04)

    outermost_flanges: list[Contour] = []
    internal_candidates: list[Contour] = []

    for c in contours:
        if not c.is_closed and frez_tension_score(c, part_bbox) < perimeter_threshold:
            outermost_flanges.append(c)
        else:
            internal_candidates.append(c)

    major_shapes: list[Contour] = []
    inner_lines: list[Contour] = []
    candidate_bboxes = [contour_bbox(c) for c in internal_candidates]

    for i, c in enumerate(internal_candidates):
        child_bbox = candidate_bboxes[i]
        is_child = False
        for j, potential_parent in enumerate(internal_candidates):
            if i == j:
                continue
            parent_bbox = candidate_bboxes[j]
            if bbox_contains(parent_bbox, child_bbox):
                is_child = True
                break
        if is_child:
            inner_lines.append(c)
        else:
            major_shapes.append(c)

    start = Point(part_min_x, part_min_y)
    current_pos = start
    result: list[Contour] = []

    if outermost_flanges:
        p1 = nn_sort_contours(outermost_flanges, current_pos)
        for c in p1:
            d_fwd = dist_sq(current_pos, c.points[0])
            d_rev = dist_sq(current_pos, c.points[-1])
            if d_rev < d_fwd:
                c = Contour(list(reversed(c.points)), False)
            result.append(c)
            current_pos = c.points[-1]

    if major_shapes:
        p2 = nn_sort_contours(major_shapes, current_pos)
        for c in p2:
            if c.is_closed:
                c_opt = optimize_closed_start_and_direction(c, current_pos)
                result.append(c_opt)
                current_pos = c_opt.points[0]
            else:
                d_fwd = dist_sq(current_pos, c.points[0])
                d_rev = dist_sq(current_pos, c.points[-1])
                if d_rev < d_fwd:
                    c = Contour(list(reversed(c.points)), False)
                result.append(c)
                current_pos = c.points[-1]

    if inner_lines:
        p3 = nn_sort_contours(inner_lines, current_pos)
        for c in p3:
            d_fwd = dist_sq(current_pos, c.points[0])
            d_rev = dist_sq(current_pos, c.points[-1])
            if d_rev < d_fwd:
                c = Contour(list(reversed(c.points)), False)
            result.append(c)
            current_pos = c.points[-1]

    return result


# ---------------------------------------------------------------------------
# FREZ Algorithm: ORACLE  (v1.0)
#
# Core philosophy — whole-sheet concentric tiers:
#   Assign every FREZ contour a tier based on how deep it sits from the
#   nearest MATCHING-AXIS sheet edge. Tier 0 = outer band (default 300mm).
#   Cut tier 0 first (bottom → closer vertical → top → farther vertical),
#   then tier 1, tier 2, … inward.
#
# Key design decisions:
#   - Orientation-aware throughout: horizontal lines use Y-depth only,
#     vertical lines use X-depth only, diagonals use all four edges.
#     This prevents a horizontal inner divider at Y=937 from being
#     promoted to tier 0 just because its endpoint is 86mm from the
#     left edge.
#   - Side order is NOT hardcoded. Oracle measures which vertical side
#     has lines closer to its edge and picks that side second.
#     Typical 35mm-offset panels → bottom → left → top → right.
#   - Diagonal flanges: classified by nearest endpoint to any edge,
#     all four edges considered (they are genuinely perimeter-anchored).
#   - Within each tier: closed shapes first, largest area first,
#     then open lines longest first, then NN travel optimisation.
# ---------------------------------------------------------------------------

# Tuneable constants
_ORACLE_EDGE_ZONE_MM  = 300.0   # depth of the outer tier band from each sheet edge
_ORACLE_TIER_BAND_MM  = 300.0   # width of each subsequent tier
_ORACLE_SNAP_DEG      = 15.0    # max deviation from axis to call a line horiz/vert


def _oracle_is_horizontal(c: Contour) -> bool:
    if len(c.points) < 2:
        return False
    dx = c.points[-1].x - c.points[0].x
    dy = c.points[-1].y - c.points[0].y
    a = math.degrees(math.atan2(dy, dx)) % 180.0
    return a <= _ORACLE_SNAP_DEG or a >= (180.0 - _ORACLE_SNAP_DEG)


def _oracle_is_vertical(c: Contour) -> bool:
    if len(c.points) < 2:
        return False
    dx = c.points[-1].x - c.points[0].x
    dy = c.points[-1].y - c.points[0].y
    a = math.degrees(math.atan2(dy, dx)) % 180.0
    return (90.0 - _ORACLE_SNAP_DEG) <= a <= (90.0 + _ORACLE_SNAP_DEG)


def _oracle_axis_depth(c: Contour, sheet: BBox) -> float:
    """
    Minimum distance to the sheet edges parallel to this contour.
    Horizontal → bottom/top only.
    Vertical   → left/right only.
    Diagonal   → all four edges.
    """
    horiz = _oracle_is_horizontal(c)
    vert  = _oracle_is_vertical(c)
    min_d = float('inf')
    for p in c.points:
        if horiz:
            d = min(p.y - sheet.min_y, sheet.max_y - p.y)
        elif vert:
            d = min(p.x - sheet.min_x, sheet.max_x - p.x)
        else:
            d = min(p.x - sheet.min_x, sheet.max_x - p.x,
                    p.y - sheet.min_y, sheet.max_y - p.y)
        if d < min_d:
            min_d = d
    return max(0.0, min_d)


def _oracle_tier(c: Contour, sheet: BBox) -> int:
    """
    Tier 0 = within EDGE_ZONE_MM of matching-axis edges.
    Tier N = N * TIER_BAND_MM deep.
    For open lines, endpoint proximity to the correct-axis edges is
    checked first (catches flanges and true perimeter lines).
    """
    if not c.is_closed:
        horiz = _oracle_is_horizontal(c)
        vert  = _oracle_is_vertical(c)
        pts   = [c.points[0], c.points[-1]]
        ep_min = float('inf')
        for p in pts:
            if horiz:
                d = min(p.y - sheet.min_y, sheet.max_y - p.y)
            elif vert:
                d = min(p.x - sheet.min_x, sheet.max_x - p.x)
            else:
                # Diagonal / flange — nearest endpoint to any edge
                d = min(p.x - sheet.min_x, sheet.max_x - p.x,
                        p.y - sheet.min_y, sheet.max_y - p.y)
            if d < ep_min:
                ep_min = d
        if ep_min <= _ORACLE_EDGE_ZONE_MM:
            return 0

    depth = _oracle_axis_depth(c, sheet)
    return int(depth / _ORACLE_TIER_BAND_MM)


def _oracle_assign_side(c: Contour, sheet: BBox) -> str:
    """
    Assign a tier-0 contour to a side bucket.
    Orientation is the primary classifier:
      Horizontal → bottom or top   (whichever Y edge is closer)
      Vertical   → left or right   (whichever X edge is closer)
      Diagonal   → nearest endpoint across all four edges
    """
    horiz = _oracle_is_horizontal(c)
    vert  = _oracle_is_vertical(c)
    pts   = [c.points[0], c.points[-1]] if not c.is_closed else c.points

    if horiz:
        d_b = min(p.y - sheet.min_y for p in pts)
        d_t = min(sheet.max_y - p.y for p in pts)
        return "bottom" if d_b <= d_t else "top"

    if vert:
        d_l = min(p.x - sheet.min_x for p in pts)
        d_r = min(sheet.max_x - p.x for p in pts)
        return "left" if d_l <= d_r else "right"

    # Diagonal / flange
    best_side = "bottom"
    min_d = float('inf')
    for p in pts:
        for side, d in [("bottom", p.y - sheet.min_y),
                        ("top",    sheet.max_y - p.y),
                        ("left",   p.x - sheet.min_x),
                        ("right",  sheet.max_x - p.x)]:
            if d < min_d:
                min_d = d
                best_side = side
    return best_side


def _oracle_decide_side_order(tier0_buckets: dict, sheet: BBox,
                               all_contours: list[Contour]) -> list[str]:
    """
    Decide the cut order of the four sides for tier 0.
    Sequence: bottom → closer_vertical → top → farther_vertical.
    'Closer vertical' = the vertical side whose best line is physically
    nearest to its respective sheet edge.
    Degrades gracefully if any side has no lines.
    """
    # Measure proximity: only truly vertical lines count for left/right
    left_lines  = [c for c in all_contours
                   if _oracle_is_vertical(c) and
                   min(p.x for p in c.points) - sheet.min_x <= _ORACLE_EDGE_ZONE_MM]
    right_lines = [c for c in all_contours
                   if _oracle_is_vertical(c) and
                   sheet.max_x - max(p.x for p in c.points) <= _ORACLE_EDGE_ZONE_MM]

    left_prox  = (min(min(p.x for p in c.points) - sheet.min_x for c in left_lines)
                  if left_lines else float('inf'))
    right_prox = (min(sheet.max_x - max(p.x for p in c.points) for c in right_lines)
                  if right_lines else float('inf'))

    closer_v  = "left" if left_prox <= right_prox else "right"
    farther_v = "right" if closer_v == "left" else "left"

    has = {s: bool(tier0_buckets.get(s)) for s in ["bottom", "top", "left", "right"]}
    preferred = ["bottom", closer_v, "top", farther_v]
    return [s for s in preferred if has[s]]


def _oracle_tier_sort_key(c: Contour) -> tuple:
    """
    Within any tier: closed shapes first (largest area first),
    then open lines (longest first).
    """
    if c.is_closed:
        return (0, -contour_bbox_area(c))
    length = math.sqrt(dist_sq(c.points[0], c.points[-1])) if len(c.points) >= 2 else 0.0
    return (1, -length)


def _oracle_flip_if_closer(c: Contour, pos: Point) -> Contour:
    if len(c.points) < 2:
        return c
    if dist_sq(pos, c.points[-1]) < dist_sq(pos, c.points[0]):
        return Contour(list(reversed(c.points)), c.is_closed)
    return c


def sort_frez_oracle(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Oracle v1.0 — sheet-wide concentric tier sequencing.
    Called by sort_frez_outer_to_inner() when algorithm="oracle".
    """
    if not contours:
        return []

    # ── 1. Assign every contour to a tier ────────────────────────────────
    tiered: dict[int, list[Contour]] = {}
    for c in contours:
        t = _oracle_tier(c, stock_bbox)
        tiered.setdefault(t, []).append(c)

    result: list[Contour] = []
    current_pos = Point(stock_bbox.min_x, stock_bbox.min_y)

    # ── 2. Tier 0: side-aware ordering ───────────────────────────────────
    tier0 = tiered.get(0, [])
    if tier0:
        # Bucket each contour by side
        buckets: dict[str, list[Contour]] = {
            "bottom": [], "top": [], "left": [], "right": []
        }
        for c in tier0:
            buckets[_oracle_assign_side(c, stock_bbox)].append(c)

        side_order = _oracle_decide_side_order(buckets, stock_bbox, tier0)

        for side in side_order:
            bucket = buckets[side]
            if not bucket:
                continue
            bucket.sort(key=_oracle_tier_sort_key)
            ordered = nn_sort_contours(bucket, current_pos)
            for c in ordered:
                if c.is_closed:
                    c = optimize_closed_start_and_direction(c, current_pos)
                    result.append(c)
                    current_pos = c.points[0]
                else:
                    c = _oracle_flip_if_closer(c, current_pos)
                    result.append(c)
                    current_pos = c.points[-1]

    # ── 3. Inner tiers: strictly inward ──────────────────────────────────
    for tier_num in sorted(k for k in tiered if k > 0):
        tier_contours = tiered[tier_num]
        tier_contours.sort(key=_oracle_tier_sort_key)
        ordered = nn_sort_contours(tier_contours, current_pos)
        for c in ordered:
            if c.is_closed:
                c = optimize_closed_start_and_direction(c, current_pos)
                result.append(c)
                current_pos = c.points[0]
            else:
                c = _oracle_flip_if_closer(c, current_pos)
                result.append(c)
                current_pos = c.points[-1]

    return result


# ---------------------------------------------------------------------------
# Public dispatcher — called by pipeline.py
# ---------------------------------------------------------------------------

FREZ_ALGORITHMS: dict[str, str] = {
    "raptor": "v0.4 Raptor",
    "anchor": "v0.5 Anchor",
    "oracle": "v1.0 Oracle",
}

def sort_frez_outer_to_inner(
    contours: list[Contour],
    stock_bbox: BBox,
    algorithm: str = "raptor",
) -> list[Contour]:
    """
    Public entry point for FREZ sorting. Routes to the requested algorithm.
    algorithm: "raptor" | "anchor" | "oracle"
    Falls back to raptor for unknown values.
    """
    if algorithm == "anchor":
        return sort_frez_anchor(contours, stock_bbox)
    if algorithm == "oracle":
        return sort_frez_oracle(contours, stock_bbox)
    return sort_frez_raptor(contours, stock_bbox)