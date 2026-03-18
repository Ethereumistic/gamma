import math
from .models import Point, Contour, BBox
from .geometry import dist_sq, frez_tension_score

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
