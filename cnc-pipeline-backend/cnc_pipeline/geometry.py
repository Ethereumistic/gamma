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



from .algo_juggler_gemini import sort_frez_juggler as sort_frez_juggler_gemini
from .algo_juggler_claude import sort_frez_juggler as sort_frez_juggler_claude

FREZ_ALGORITHMS: dict[str, str] = {
    "juggler_gemini": "v1.0 Juggler Gemini",
    "juggler_claude": "v1.0 Juggler Claude",
}

def sort_frez_outer_to_inner(
    contours: list[Contour],
    stock_bbox: BBox,
    algorithm: str = "juggler_gemini",
) -> list[Contour]:
    """
    Public entry point for FREZ sorting. Routes to the requested algorithm.
    """
    if algorithm == "juggler_claude":
        return sort_frez_juggler_claude(contours, stock_bbox)
    # Default fallback
    return sort_frez_juggler_gemini(contours, stock_bbox)
