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

def sort_outer_to_inner(contours: list[Contour], sheet_bbox: BBox) -> list[Contour]:
    if not contours:
        return []
    cx = (sheet_bbox.min_x + sheet_bbox.max_x) / 2
    cy = (sheet_bbox.min_y + sheet_bbox.max_y) / 2
    
    def max_dist_to_centroid(c: Contour) -> float:
        return max(dist_sq(p, Point(cx, cy)) for p in c.points)
        
    # Outermost first -> descending distance
    ordered = sorted(contours, key=max_dist_to_centroid, reverse=True)
    return ordered

def sort_frez_outer_to_inner(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sort FREZ/FREZ_135 contours from outermost (closest to sheet boundary)
    to innermost (deepest into sheet interior).

    Uses mean dist-to-boundary over all tessellated contour points.
    This correctly handles long penetrating lines that min() would misclassify.

    Travel efficiency is optimised via nearest-neighbour within a self-calibrating
    5% score-range band. No hardcoded parameters.

    Entry point is always the sheet corner nearest to the outermost contour,
    NOT the tool's position from the previous toolpath.
    """
    if not contours:
        return []

    def tension_score(contour: Contour) -> float:
        if not contour.points:
            return 0.0
        total = 0.0
        for p in contour.points:
            d = min(
                p.x - stock_bbox.min_x,
                stock_bbox.max_x - p.x,
                p.y - stock_bbox.min_y,
                stock_bbox.max_y - p.y,
            )
            total += d
        return total / len(contour.points)

    # Score every contour
    scored = [(tension_score(c), c) for c in contours]
    scored.sort(key=lambda x: x[0])

    scores = [s for s, _ in scored]
    sorted_contours = [c for _, c in scored]

    # Self-calibrating band for NN travel optimisation
    score_range = (max(scores) - min(scores)) if len(scores) > 1 else 0.0
    band = score_range * 0.05

    # Determine entry point: corner of stock bbox nearest to outermost contour
    corners = [
        Point(stock_bbox.min_x, stock_bbox.min_y),  # bottom-left
        Point(stock_bbox.max_x, stock_bbox.min_y),  # bottom-right
        Point(stock_bbox.min_x, stock_bbox.max_y),  # top-left
        Point(stock_bbox.max_x, stock_bbox.max_y),  # top-right
    ]
    outermost_start = sorted_contours[0].points[0]
    entry_point = min(corners, key=lambda corner: dist_sq(corner, outermost_start))

    # NN traversal within score band — structural order preserved
    result = []
    remaining = list(range(len(sorted_contours)))
    current_pos = entry_point

    while remaining:
        current_score = scores[remaining[0]]  # lowest score in remaining (structural anchor)

        # Candidates: all remaining contours within band_tolerance of current structural front
        candidates = [
            i for i in remaining
            if scores[i] <= current_score + band
        ]

        # Among candidates, pick nearest to current position
        best = min(candidates, key=lambda i: dist_sq(current_pos, sorted_contours[i].points[0]))

        result.append(sorted_contours[best])
        current_pos = sorted_contours[best].points[-1]
        remaining.remove(best)

    return result

def sort_nearest_neighbour(contours: list[Contour]) -> list[Contour]:
    if not contours:
        return []
        
    def bbox_area(c: Contour) -> float:
        if not c.points:
            return 0.0
        min_x = min(p.x for p in c.points)
        max_x = max(p.x for p in c.points)
        min_y = min(p.y for p in c.points)
        max_y = max(p.y for p in c.points)
        return (max_x - min_x) * (max_y - min_y)
        
    contours_with_area = [(bbox_area(c), c) for c in contours]
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
        
    def nn_sort(group: list[Contour], current_pos: Point) -> list[Contour]:
        ordered = []
        unvisited = group.copy()
        while unvisited:
            best_idx = 0
            best_dist = float('inf')
            for i, c in enumerate(unvisited):
                d = dist_sq(current_pos, c.points[0])
                if d < best_dist:
                    best_dist = d
                    best_idx = i
            next_c = unvisited.pop(best_idx)
            ordered.append(next_c)
            current_pos = next_c.points[-1]
        return ordered
        
    ordered_contours = []
    current_pos = Point(0, 0)
    
    for tier in tiers:
        sorted_tier = nn_sort(tier, current_pos)
        ordered_contours.extend(sorted_tier)
        if sorted_tier:
            current_pos = sorted_tier[-1].points[-1]
            
    return ordered_contours
