import math
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

@dataclass
class BBox:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

@dataclass
class Contour:
    points: list
    is_closed: bool

def dist_sq(p1, p2):
    return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2

def tension_score_v4(c, bbox):
    max_depth = 0.0
    for p in c.points:
        d = min(p.x-bbox.min_x, bbox.max_x-p.x, p.y-bbox.min_y, bbox.max_y-p.y)
        if d > max_depth:
            max_depth = d
    return max_depth

def sort_v4(contours, stock_bbox):
    if not contours:
        return []
    def tension_score(contour):
        if not contour.points:
            return 0.0
        max_depth = 0.0
        for p in contour.points:
            d = min(p.x-stock_bbox.min_x, stock_bbox.max_x-p.x,
                    p.y-stock_bbox.min_y, stock_bbox.max_y-p.y)
            if d > max_depth:
                max_depth = d
        return max_depth

    scored = [(tension_score(c), c) for c in contours]
    scored.sort(key=lambda x: x[0])
    scores = [s for s, _ in scored]
    sorted_contours = [c for _, c in scored]

    def cluster_into_rings(sc_scores, sc_contours):
        n = len(sc_scores)
        if n == 1:
            return [[(sc_scores[0], sc_contours[0])]]
        gaps = [sc_scores[i+1] - sc_scores[i] for i in range(n-1)]
        sorted_gaps = sorted(gaps)
        median_gap = sorted_gaps[len(sorted_gaps) // 2] if sorted_gaps else 0.0
        threshold = median_gap * 3.0 if median_gap > 0.01 else float('inf')
        rings = []
        current_ring = [(sc_scores[0], sc_contours[0])]
        for i in range(1, n):
            if gaps[i-1] >= threshold:
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

    def contour_centroid(c):
        return Point(
            sum(p.x for p in c.points) / len(c.points),
            sum(p.y for p in c.points) / len(c.points)
        )

    def clockwise_angle(c):
        cen = contour_centroid(c)
        raw = math.atan2(cen.y - cy, cen.x - cx)
        return (ref_angle - raw) % (2 * math.pi)

    result = []
    current_pos = Point(stock_bbox.min_x, stock_bbox.min_y)

    for ring in rings:
        ring_contours = [c for _, c in ring]
        ring_contours.sort(key=lambda c: (0 if c.is_closed else 1, clockwise_angle(c)))
        for c in ring_contours:
            d_fwd = dist_sq(current_pos, c.points[0])
            d_rev = dist_sq(current_pos, c.points[-1])
            if d_rev < d_fwd:
                c = Contour(list(reversed(c.points)), c.is_closed)
            result.append(c)
            current_pos = c.points[-1]

    return result


# ---- Test ----
bbox = BBox(0, 0, 1250, 3200)

bottom_edge = Contour([Point(0, 10),    Point(1250, 10)], False)
left_edge   = Contour([Point(5, 0),     Point(5, 3200)], False)
right_edge  = Contour([Point(1245, 200),Point(1245, 600)], False)
top_edge    = Contour([Point(200,3190), Point(900, 3190)], False)
inner_rect  = Contour([Point(200,800), Point(1050,800), Point(1050,2400), Point(200,2400)], True)
cross_panel = Contour([Point(0,1600),   Point(1250, 1600)], False)

all_contours = [inner_rect, cross_panel, bottom_edge, left_edge, right_edge, top_edge]

print("=== V4 Max-Depth Tension Scores ===")
names = ["inner_rect(CL)","cross_panel(OP)","bottom_edge","left_edge","right_edge","top_edge"]
for name, c in zip(names, all_contours):
    print(f"  {name:20s}: {tension_score_v4(c, bbox):.1f}mm")

result = sort_v4(all_contours, bbox)

print("\n=== Processing Order ===")
label_map = {
    id(bottom_edge): "bottom_edge",
    id(left_edge):   "left_edge",
    id(right_edge):  "right_edge",
    id(top_edge):    "top_edge",
    id(inner_rect):  "inner_rect(CLOSED)",
    id(cross_panel): "cross_panel(open)",
}
for i, c in enumerate(result):
    name = "reversed"
    print(f"  [{i}] {'CLOSED' if c.is_closed else 'open  '} "
          f"({c.points[0].x:.0f},{c.points[0].y:.0f}) -> ({c.points[-1].x:.0f},{c.points[-1].y:.0f})")

# Assertions
# 1. Perimeter lines (bottom/left/right/top) all come before inner_rect and cross_panel
perimeter_scores = [tension_score_v4(c, bbox) for c in [bottom_edge, left_edge, right_edge, top_edge]]
print(f"\nPerimeter max-scores: {[f'{s:.0f}' for s in perimeter_scores]}")
inner_score = tension_score_v4(inner_rect, bbox)
cross_score = tension_score_v4(cross_panel, bbox)
print(f"inner_rect max-score: {inner_score:.0f}")
print(f"cross_panel max-score: {cross_score:.0f}")

# cross_panel has deepest max-depth (passes through y=1600, which is 1600mm from both y edges)
assert cross_score > inner_score, f"cross_panel ({cross_score}) should score deeper than inner_rect ({inner_score})"
# inner_rect is closed, so within same ring it should come before cross_panel (open)
# Both are in ring 2; within ring 2: closed < open → inner_rect first
inner_result_idx = next(i for i, c in enumerate(result) if c.is_closed)
cross_result_idx = next(i for i, c in enumerate(result)
                        if not c.is_closed and (c.points[0].y == 1600 or c.points[-1].y == 1600))
print(f"\ninner_rect (closed) at index {inner_result_idx}")
print(f"cross_panel (open)  at index {cross_result_idx}")
assert inner_result_idx < cross_result_idx, "Closed shape must come before open divider"
# All perimeter lines must come before inner geometries
perimeter_result_indices = [i for i, c in enumerate(result)
                             if not c.is_closed and (c.points[0].y in (10,) or c.points[0].x in (5, 1245) or c.points[0].y == 3190
                             or c.points[-1].y in (10,) or c.points[-1].x in (5, 1245) or c.points[-1].y == 3190)]
if perimeter_result_indices:
    assert max(perimeter_result_indices) < inner_result_idx, "Perimeter must come before inner shapes"
print("\nALL ASSERTIONS PASSED ✓")
