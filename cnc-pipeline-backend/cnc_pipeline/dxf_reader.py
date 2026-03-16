# cnc_pipeline/dxf_reader.py
from dataclasses import dataclass
import ezdxf
from ezdxf.path import make_path

@dataclass
class Point:
    x: float
    y: float

@dataclass
class Segment:
    start: Point
    end: Point
    layer: str

@dataclass
class BBox:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

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

    def get_entities(self, layer: str) -> list[Segment]:
        segments = []
        chord_tolerance = 0.01

        for e in self.msp.query(f'*[layer=="{layer}"]'):
            if e.dxftype() not in ('LINE', 'ARC', 'LWPOLYLINE', 'CIRCLE', 'POLYLINE'):
                continue
            try:
                path = make_path(e)
                points = list(path.flattening(chord_tolerance))
                if len(points) < 2:
                    continue
                for i in range(len(points) - 1):
                    start = Point(points[i].x, points[i].y)
                    end = Point(points[i+1].x, points[i+1].y)
                    segments.append(Segment(start, end, layer))
            except Exception:
                pass
        return segments

    def get_bounding_box(self) -> BBox:
        # 1. Try to get bounding box from SHEETS layer
        sheets_segments = self.get_entities("SHEETS")
        if sheets_segments:
            min_x = min(min(s.start.x, s.end.x) for s in sheets_segments)
            min_y = min(min(s.start.y, s.end.y) for s in sheets_segments)
            max_x = max(max(s.start.x, s.end.x) for s in sheets_segments)
            max_y = max(max(s.start.y, s.end.y) for s in sheets_segments)
            return BBox(min_x, min_y, max_x, max_y)

        # 2. Otherwise bbox of all geometry
        all_segments = []
        for layer in self.layers:
            all_segments.extend(self.get_entities(layer))

        if not all_segments:
            return BBox(0.0, 0.0, 0.0, 0.0)

        min_x = min(min(s.start.x, s.end.x) for s in all_segments)
        min_y = min(min(s.start.y, s.end.y) for s in all_segments)
        max_x = max(max(s.start.x, s.end.x) for s in all_segments)
        max_y = max(max(s.start.y, s.end.y) for s in all_segments)
        
        return BBox(min_x, min_y, max_x, max_y)
