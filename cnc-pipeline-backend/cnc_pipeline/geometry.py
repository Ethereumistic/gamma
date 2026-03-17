# cnc_pipeline/geometry.py
from dataclasses import dataclass
from .dxf_reader import Point, Segment, BBox

@dataclass
class Contour:
    points: list[Point]
    is_closed: bool

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

def join_segments(segments: list[Segment], tolerance: float = 0.05) -> list[Contour]:
    unvisited = set(range(len(segments)))
    contours = []
    tol_sq = tolerance**2
    closure_tol_sq = 1.0
    
    while unvisited:
        start_idx = unvisited.pop()
        chain = [segments[start_idx].start, segments[start_idx].end]
        
        # Grow forward
        while True:
            best_idx = None
            best_orient = None
            
            for idx in unvisited:
                seg = segments[idx]
                if dist_sq(chain[-1], seg.start) <= tol_sq:
                    best_idx = idx
                    best_orient = 1
                    break
                elif dist_sq(chain[-1], seg.end) <= tol_sq:
                    best_idx = idx
                    best_orient = -1
                    break
                    
            if best_idx is not None:
                unvisited.remove(best_idx)
                if best_orient == 1:
                    chain.append(segments[best_idx].end)
                else:
                    chain.append(segments[best_idx].start)
            else:
                break
                
        # Grow backward
        while True:
            best_idx = None
            best_orient = None
            
            for idx in unvisited:
                seg = segments[idx]
                if dist_sq(chain[0], seg.end) <= tol_sq:
                    best_idx = idx
                    best_orient = 1
                    break
                elif dist_sq(chain[0], seg.start) <= tol_sq:
                    best_idx = idx
                    best_orient = -1
                    break
                    
            if best_idx is not None:
                unvisited.remove(best_idx)
                if best_orient == 1:
                    chain.insert(0, segments[best_idx].start)
                else:
                    chain.insert(0, segments[best_idx].end)
            else:
                break
                
        is_closed = False
        if len(chain) > 2 and dist_sq(chain[0], chain[-1]) <= closure_tol_sq:
            is_closed = True
            chain.pop() # remove duplicate endpoint
            
        contours.append(Contour(chain, is_closed))
        
    return contours

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


# ---------------------------------------------------------------------------
# FREZ Algorithm: ANCHOR  (v0.5)
# Strategy: Vacuum anchor preservation.
#   Priority 1 — outermost open flanges (perimeter lines, depth < threshold)
#   Priority 2 — smaller closed loops (isolated cutouts), size ascending
#   Priority 3 — internal open bridges (wall-to-wall dividers)
#   Priority 4 — the single largest closed shape (the main vacuum anchor) — LAST
# The threshold separating perimeter from interior is self-calibrating:
#   50mm or 4% of the shorter sheet dimension, whichever is larger.
# ---------------------------------------------------------------------------
def sort_frez_anchor(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Anchor: vacuum-anchor-preservation algorithm (v0.5).

    Cuts in this priority order:
      1. Perimeter flanges (open, low max-depth) — preserve sheet rigidity first.
      2. Small closed cutouts ascending by area — score inside-out per group.
      3. Internal open bridge lines — relieve interior tension next.
      4. Largest single closed shape (main vacuum anchor) — absolutely last.

    All groups use nearest-neighbour travel optimisation.
    Bidirectional handshake applied to the final merged sequence.
    """
    if not contours:
        return []

    # Self-calibrating perimeter threshold
    sheet_short = min(
        stock_bbox.max_x - stock_bbox.min_x,
        stock_bbox.max_y - stock_bbox.min_y,
    )
    perimeter_threshold = max(50.0, sheet_short * 0.04)

    # ── Classify ──────────────────────────────────────────────────────────
    outermost_open: list[Contour] = []
    internal_open:  list[Contour] = []
    closed_loops:   list[Contour] = []

    for c in contours:
        if c.is_closed:
            closed_loops.append(c)
        else:
            depth = frez_tension_score(c, stock_bbox)
            if depth < perimeter_threshold:
                outermost_open.append(c)
            else:
                internal_open.append(c)

    # ── Priority 4 pre-calc: identify and pop the largest vacuum anchor ───
    largest_closed: list[Contour] = []
    if closed_loops:
        anchor_idx = max(range(len(closed_loops)), key=lambda i: contour_bbox_area(closed_loops[i]))
        largest_closed = [closed_loops.pop(anchor_idx)]

    # ── Sort each group ───────────────────────────────────────────────────
    start = Point(stock_bbox.min_x, stock_bbox.min_y)  # BL corner entry

    # P1: perimeter flanges — NN from BL corner
    p1 = nn_sort_contours(outermost_open, start)
    cur = p1[-1].points[-1] if p1 else start

    # P2: remaining closed loops, smallest first, then NN within each size tier
    closed_loops.sort(key=contour_bbox_area)
    p2 = nn_sort_contours(closed_loops, cur)
    cur = p2[-1].points[-1] if p2 else cur

    # P3: internal open bridges — NN from current position
    p3 = nn_sort_contours(internal_open, cur)
    cur = p3[-1].points[-1] if p3 else cur

    # P4: largest anchor — always appended last, no NN needed
    p4 = largest_closed

    # ── Merge and apply bidirectional handshake ────────────────────────────
    merged = p1 + p2 + p3 + p4
    result: list[Contour] = []
    current_pos = start

    for c in merged:
        d_fwd = dist_sq(current_pos, c.points[0])
        d_rev = dist_sq(current_pos, c.points[-1])
        if d_rev < d_fwd:
            c = Contour(list(reversed(c.points)), c.is_closed)
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
