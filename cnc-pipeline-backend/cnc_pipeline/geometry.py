# cnc_pipeline/geometry.py
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

    # 1. Ensure CW direction
    # Shoelace formula: sum( (x2-x1)*(y2+y1) ). Positive = CCW, Negative = CW.
    # We must wrap around to the first point to close the area calculation properly.
    area_sum = 0.0
    n = len(c.points)
    for i in range(n):
        p1 = c.points[i]
        p2 = c.points[(i + 1) % n]
        area_sum += (p2.x - p1.x) * (p2.y + p1.y)
    
    points = list(c.points)
    if area_sum > 0:
        points.reverse()
    
    # 2. Rotate to start at closest point
    # Since dxf_reader.py removes the duplicate closing point, 
    # 'points' contains exactly the unique corners. Do NOT slice it.
    best_idx = 0
    min_d = dist_sq(start_pos, points[0])
    
    for i in range(1, len(points)):
        d = dist_sq(start_pos, points[i])
        if d < min_d:
            min_d = d
            best_idx = i
            
    # Rotate the array so the closest point is first
    rotated = points[best_idx:] + points[:best_idx]
    
    # Return cleanly. Do NOT append rotated[0] here. 
    # toolpath.py automatically adds the closing cut for is_closed==True.
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
    = max over all points (and segment midpoints) of min-dist-to-any-edge.
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
# Strategy: Max-depth tension score → natural-break ring clustering →
#           clockwise polar sweep anchored to BL corner →
#           topology tie-breaker (closed before open) →
#           bidirectional handshake.
# ---------------------------------------------------------------------------
def sort_frez_raptor(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """Raptor: max-depth polar-sweep algorithm (v0.4). See docstring above."""
    import math

    if not contours:
        return []

    scored = [(frez_tension_score(c, stock_bbox), c) for c in contours]
    scored.sort(key=lambda x: x[0])
    scores = [s for s, _ in scored]
    sorted_contours = [c for _, c in scored]

    # ------------------------------------------------------------------
    # Step 2: natural-break ring clustering
    # Any gap >= 3x the median inter-score gap starts a new ring.
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # Shared geometry constants
    # ------------------------------------------------------------------
    cx = (stock_bbox.min_x + stock_bbox.max_x) / 2
    cy = (stock_bbox.min_y + stock_bbox.max_y) / 2

    # Bottom-left corner anchors the sweep: BL=0°, then CW → TL → TR → BR
    bl = Point(stock_bbox.min_x, stock_bbox.min_y)
    ref_angle = math.atan2(bl.y - cy, bl.x - cx)  # ≈ -135° (SW quadrant)

    def contour_centroid(c: Contour) -> Point:
        ax = sum(p.x for p in c.points) / len(c.points)
        ay = sum(p.y for p in c.points) / len(c.points)
        return Point(ax, ay)

    def clockwise_angle(c: Contour) -> float:
        """
        CW angle relative to BL corner. BL=0, TL≈π/2, TR≈π, BR≈3π/2.
        Formula: (ref_angle - raw_angle) mod 2π
        Subtracting the CCW raw angle from a fixed reference produces a
        value that increases as we sweep clockwise.
        """
        cen = contour_centroid(c)
        raw = math.atan2(cen.y - cy, cen.x - cx)
        return (ref_angle - raw) % (2 * math.pi)

    # ------------------------------------------------------------------
    # Step 3 + 4: per-ring sort (topology tie-breaker + polar), then
    # bidirectional handshake
    # ------------------------------------------------------------------
    result: list[Contour] = []
    # Start from bottom-left corner — consistent with the polar sweep anchor
    current_pos: Point = Point(stock_bbox.min_x, stock_bbox.min_y)

    for ring in rings:
        ring_contours = [c for _, c in ring]

        # Sort key: (0=closed/1=open, CW polar angle)
        # → all closed shapes sweep CW first, then open dividers sweep CW
        ring_contours.sort(
            key=lambda c: (0 if c.is_closed else 1, clockwise_angle(c))
        )

        # Bidirectional handshake: enter each contour at its closer endpoint
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


# FREZ Algorithm: ANCHOR  (v0.5)
# Strategy: Vacuum anchor preservation.
#   Priority 1 — outermost open flanges (perimeter lines, depth < threshold)
#   Priority 2 — smaller closed loops (isolated cutouts), size ascending
#   Priority 3 — internal open bridges (wall-to-wall dividers)
#   Priority 4 — the single largest closed shape (the main vacuum anchor) — LAST
# The threshold separating perimeter from interior is self-calibrating:
#   50mm or 4% of the shorter PART dimension, whichever is larger.
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

    # ── Classify ──────────────────────────────────────────────────────────
    outermost_flanges: list[Contour] = []
    internal_candidates: list[Contour] = []

    # 1. Separate flanges from everything internal
    for c in contours:
        if not c.is_closed and frez_tension_score(c, part_bbox) < perimeter_threshold:
            outermost_flanges.append(c)
        else:
            internal_candidates.append(c)

    # 2. Separate Major Shapes (Rectangles/Brackets) from Inner Lines
    major_shapes: list[Contour] = []
    inner_lines: list[Contour] = []
    
    # Pre-calculate bounding boxes for efficiency
    candidate_bboxes = [contour_bbox(c) for c in internal_candidates]

    for i, c in enumerate(internal_candidates):
        child_bbox = candidate_bboxes[i]
        is_child = False
        
        # Check if this contour is inside any OTHER internal contour
        for j, potential_parent in enumerate(internal_candidates):
            if i == j:
                continue
            parent_bbox = candidate_bboxes[j]
            
            # If our bbox is fully inside another bbox, we are an inner line
            if bbox_contains(parent_bbox, child_bbox):
                is_child = True
                break
                
        if is_child:
            inner_lines.append(c)
        else:
            major_shapes.append(c)

    # ── Sort Sequence ─────────────────────────────────────────────────────
    start = Point(part_min_x, part_min_y)
    current_pos = start
    result: list[Contour] = []

    # Priority 1: Perimeter Flanges
    if outermost_flanges:
        p1 = nn_sort_contours(outermost_flanges, current_pos)
        for c in p1:
            d_fwd = dist_sq(current_pos, c.points[0])
            d_rev = dist_sq(current_pos, c.points[-1])
            if d_rev < d_fwd:
                c = Contour(list(reversed(c.points)), False)
            result.append(c)
            current_pos = c.points[-1]

    # Priority 2: Major Internal Shapes (Rectangles AND Brackets)
    if major_shapes:
        p2 = nn_sort_contours(major_shapes, current_pos)
        for c in p2:
            if c.is_closed:
                # If it's a closed rectangle, force CW and start at closest corner
                c_opt = optimize_closed_start_and_direction(c, current_pos)
                result.append(c_opt)
                current_pos = c_opt.points[0]
            else:
                # If it's an open bracket, just flip it to start at the closest end
                d_fwd = dist_sq(current_pos, c.points[0])
                d_rev = dist_sq(current_pos, c.points[-1])
                if d_rev < d_fwd:
                    c = Contour(list(reversed(c.points)), False)
                result.append(c)
                current_pos = c.points[-1]

    # Priority 3: Inner Lines (Lines inside Rectangles/Brackets)
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
# Public dispatcher — called by pipeline.py
# ---------------------------------------------------------------------------

FREZ_ALGORITHMS: dict[str, str] = {
    "raptor": "v0.4 Raptor",
    "anchor": "v0.5 Anchor",
}

def sort_frez_outer_to_inner(
    contours: list[Contour],
    stock_bbox: BBox,
    algorithm: str = "raptor",
) -> list[Contour]:
    """
    Public entry point for FREZ sorting. Routes to the requested algorithm.

    algorithm: "raptor" (default, v0.4) | "anchor" (v0.5)
    Falls back to raptor for unknown values.
    """
    if algorithm == "anchor":
        return sort_frez_anchor(contours, stock_bbox)
    return sort_frez_raptor(contours, stock_bbox)
