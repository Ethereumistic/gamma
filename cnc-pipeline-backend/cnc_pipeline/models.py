# cnc_pipeline/models.py
from dataclasses import dataclass

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

@dataclass
class Contour:
    points: list[Point]
    is_closed: bool

@dataclass
class Move:
    type: str  # "rapid", "cut", "plunge", "retract"
    x: float | None
    y: float | None
    z: float | None
    feed: float | None
    coolant_on: bool = False
    coolant_off: bool = False
    seq_index: int | None = None
