from .models import Point, Contour, BBox
from .geometry import (
    dist_sq,
    frez_tension_score,
    contour_bbox,
    bbox_contains,
    nn_sort_contours,
    optimize_closed_start_and_direction
)

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
