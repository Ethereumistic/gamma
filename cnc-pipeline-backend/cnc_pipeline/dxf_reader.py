# cnc_pipeline/dxf_reader.py
from .models import Point, Segment, BBox, Contour
import ezdxf
from ezdxf.path import make_path

class DXFReader:
    def __init__(self, filepath: str):
        self.doc = ezdxf.readfile(filepath)
        self.msp = self.doc.modelspace()
        self.layers = self._detect_layers()

    def _detect_layers(self) -> set[str]:
        found_layers = set()
        for e in self.msp:
            found_layers.add(e.dxf.layer)
        return found_layers

    def get_contours(self, layer: str) -> list[Contour]:
        contours = []
        chord_tolerance = 0.01

        for e in self.msp.query(f'*[layer=="{layer}"]'):
            if e.dxftype() not in ('LINE', 'ARC', 'LWPOLYLINE', 'CIRCLE', 'POLYLINE'):
                continue
            try:
                path = make_path(e)
                points_raw = list(path.flattening(chord_tolerance))
                if len(points_raw) < 2:
                    continue
                
                # Convert to our Point objects
                points = [Point(p.x, p.y) for p in points_raw]
                
                # Check for closure (if start and end points are essentially identical)
                is_closed = False
                dist_sq = (points[0].x - points[-1].x)**2 + (points[0].y - points[-1].y)**2
                if dist_sq <= 0.001:  # Microscopic tolerance for closure
                    is_closed = True
                    points.pop() # Remove the duplicate closing point 
                    
                contours.append(Contour(points, is_closed))
            except Exception:
                pass
        return contours



    def get_bounding_box(self) -> BBox:
        # 1. Try to get bounding box from SHEETS layer
        sheets_contours = self.get_contours("SHEETS")
        if sheets_contours:
            min_x = min(min(p.x for p in c.points) for c in sheets_contours)
            min_y = min(min(p.y for p in c.points) for c in sheets_contours)
            max_x = max(max(p.x for p in c.points) for c in sheets_contours)
            max_y = max(max(p.y for p in c.points) for c in sheets_contours)
            return BBox(min_x, min_y, max_x, max_y)

        # 2. Otherwise bbox of all geometry
        all_points = []
        for layer in self.layers:
            for contour in self.get_contours(layer):
                all_points.extend(contour.points)

        if not all_points:
            return BBox(0.0, 0.0, 0.0, 0.0)

        min_x = min(p.x for p in all_points)
        min_y = min(p.y for p in all_points)
        max_x = max(p.x for p in all_points)
        max_y = max(p.y for p in all_points)
        
        return BBox(min_x, min_y, max_x, max_y)
