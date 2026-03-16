# cnc_pipeline/geometry.py
from dataclasses import dataclass
from .dxf_reader import Point, Segment, BBox

@dataclass
class Contour:
    points: list[Point]
    is_closed: bool

def dist_sq(p1: Point, p2: Point) -> float:
    return (p1.x - p2.x)**2 + (p1.y - p2.y)**2

def join_segments(segments: list[Segment], tolerance: float = 0.05) -> list[Contour]:
    unvisited = set(range(len(segments)))
    contours = []
    tol_sq = tolerance**2
    
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
        if len(chain) > 2 and dist_sq(chain[0], chain[-1]) <= tol_sq:
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
