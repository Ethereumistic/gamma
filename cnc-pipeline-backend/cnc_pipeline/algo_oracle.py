import math
from .models import Point, Contour, BBox
from .geometry import (
    dist_sq,
    contour_bbox_area,
    nn_sort_contours,
    optimize_closed_start_and_direction
)

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
                d = min(p.x - sheet.min_x, sheet.max_x - p.x,
                        p.y - sheet.min_y, sheet.max_y - p.y)
            if d < ep_min:
                ep_min = d
        if ep_min <= _ORACLE_EDGE_ZONE_MM:
            return 0

    depth = _oracle_axis_depth(c, sheet)
    return int(depth / _ORACLE_TIER_BAND_MM)


def _oracle_assign_side(c: Contour, sheet: BBox) -> str:
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
    if not contours:
        return []

    tiered: dict[int, list[Contour]] = {}
    for c in contours:
        t = _oracle_tier(c, stock_bbox)
        tiered.setdefault(t, []).append(c)

    result: list[Contour] = []
    current_pos = Point(stock_bbox.min_x, stock_bbox.min_y)

    tier0 = tiered.get(0, [])
    if tier0:
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
