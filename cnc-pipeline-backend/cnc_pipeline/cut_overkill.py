"""CUT layer overkill/deduplication for nested DXF exports.

This module removes duplicate and partially overlapping straight CUT segments while
preserving all non-CUT entities. Supported CUT entities (LINE, LWPOLYLINE, and
classic POLYLINE) are flattened to line segments, removed, and replaced with
non-overlapping LINE entities on the same layer.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

import ezdxf

Point = tuple[float, float]
Segment = tuple[Point, Point]


@dataclass
class OverkillReport:
    input: str = ""
    output: str = ""
    layer: str = "CUT"
    tolerance: float = 0.01
    source_entities_removed: int = 0
    source_segments: int = 0
    deduped_segments: int = 0
    overlapping_spans_removed: int = 0
    unsupported_cut_entities_preserved: int = 0
    unsupported_types: list[str] = field(default_factory=list)

    def format(self) -> str:
        unsupported = ", ".join(sorted(set(self.unsupported_types))) or "none"
        return "\n".join(
            [
                f"input: {self.input}",
                f"layer: {self.layer}",
                f"tolerance: {self.tolerance:g}",
                f"source entities removed: {self.source_entities_removed}",
                f"source segments: {self.source_segments}",
                f"deduped segments: {self.deduped_segments}",
                f"overlapping spans removed: {self.overlapping_spans_removed}",
                f"unsupported CUT entities preserved: {self.unsupported_cut_entities_preserved}",
                f"unsupported types: {unsupported}",
                f"output: {self.output}",
            ]
        )


def _xy(point) -> Point:
    return (float(point[0]), float(point[1]))


def _line_segments(entity) -> list[Segment] | None:
    dxftype = entity.dxftype()
    if dxftype == "LINE":
        return [(_xy(entity.dxf.start), _xy(entity.dxf.end))]
    if dxftype == "LWPOLYLINE":
        pts = [_xy(p) for p in entity.get_points("xy")]
        return _segments_from_points(pts, bool(entity.closed))
    if dxftype == "POLYLINE":
        pts = [_xy(v.dxf.location) for v in entity.vertices]
        return _segments_from_points(pts, bool(entity.is_closed))
    return None


def _segments_from_points(points: Sequence[Point], closed: bool) -> list[Segment]:
    segments: list[Segment] = []
    for a, b in zip(points, points[1:]):
        segments.append((a, b))
    if closed and len(points) > 1:
        segments.append((points[-1], points[0]))
    return segments


def _length(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _canonical_line(segment: Segment, tol: float):
    (x1, y1), (x2, y2) = segment
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length <= tol:
        return None
    ux, uy = dx / length, dy / length
    if ux < 0 or (abs(ux) <= 1e-12 and uy < 0):
        ux, uy = -ux, -uy
    nx, ny = -uy, ux
    d = x1 * nx + y1 * ny
    # Use a very fine direction quantization and tolerance-based distance bins.
    key = (round(ux / 1e-9), round(uy / 1e-9), round(d / tol))
    t1 = x1 * ux + y1 * uy
    t2 = x2 * ux + y2 * uy
    if t2 < t1:
        t1, t2 = t2, t1
    return key, (ux, uy), (nx, ny), d, (t1, t2)


def _merge_values(values: Iterable[float], tol: float) -> list[float]:
    sorted_values = sorted(values)
    if not sorted_values:
        return []
    groups: list[list[float]] = [[sorted_values[0]]]
    for value in sorted_values[1:]:
        if abs(value - groups[-1][-1]) <= tol:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [sum(group) / len(group) for group in groups]


def dedupe_segments(segments: Iterable[Segment], tol: float = 0.01) -> list[Segment]:
    """Return non-overlapping atomic line spans covered by input segments."""
    groups: dict[tuple[int, int, int], dict] = {}
    for segment in segments:
        line = _canonical_line(segment, tol)
        if line is None:
            continue
        key, u, n, d, interval = line
        group = groups.setdefault(key, {"u": u, "n": n, "d": d, "intervals": []})
        group["intervals"].append(interval)

    output: list[Segment] = []
    for group in groups.values():
        intervals = group["intervals"]
        boundaries = _merge_values((v for interval in intervals for v in interval), tol)
        ux, uy = group["u"]
        nx, ny = group["n"]
        d = group["d"]
        ox, oy = nx * d, ny * d
        for a, b in zip(boundaries, boundaries[1:]):
            if b - a <= tol:
                continue
            mid = (a + b) / 2.0
            if any(start - tol <= mid <= end + tol for start, end in intervals):
                p1 = (round(ox + ux * a, 6), round(oy + uy * a, 6))
                p2 = (round(ox + ux * b, 6), round(oy + uy * b, 6))
                if _length(p1, p2) > tol:
                    output.append((p1, p2))
    return output


def _segment_key(segment: Segment, tol: float):
    line = _canonical_line(segment, tol)
    if line is None:
        return None
    key, _u, _n, _d, (a, b) = line
    return (key, round(a / tol), round(b / tol))


def _same_segment_coverage(source: Iterable[Segment], deduped: Iterable[Segment], tol: float) -> bool:
    source_keys = sorted(k for s in source if (k := _segment_key(s, tol)) is not None)
    deduped_keys = sorted(k for s in deduped if (k := _segment_key(s, tol)) is not None)
    return source_keys == deduped_keys


def _point_key(point: Point, tol: float) -> tuple[int, int]:
    return (round(point[0] / tol), round(point[1] / tol))


def _join_segments_to_polylines(segments: Sequence[Segment], tol: float) -> list[tuple[list[Point], bool]]:
    """Join deduped segments into maximal open/closed polylines where possible.

    Branching nodes are handled conservatively: paths stop at nodes with degree != 2.
    This preserves joination for normal contours and shared-cut results without trying
    to invent topology.
    """
    adjacency: dict[tuple[int, int], list[tuple[int, tuple[int, int]]]] = {}
    key_to_point: dict[tuple[int, int], Point] = {}
    clean_segments: list[tuple[Point, Point, tuple[int, int], tuple[int, int]]] = []

    for start, end in segments:
        if _length(start, end) <= tol:
            continue
        a = _point_key(start, tol)
        b = _point_key(end, tol)
        if a == b:
            continue
        key_to_point.setdefault(a, start)
        key_to_point.setdefault(b, end)
        index = len(clean_segments)
        clean_segments.append((start, end, a, b))
        adjacency.setdefault(a, []).append((index, b))
        adjacency.setdefault(b, []).append((index, a))

    used: set[int] = set()
    polylines: list[tuple[list[Point], bool]] = []

    def consume_path(start_key: tuple[int, int], first_edge: int) -> list[tuple[int, int]]:
        _s, _e, a, b = clean_segments[first_edge]
        prev = start_key
        current = b if a == start_key else a
        used.add(first_edge)
        keys = [start_key, current]
        while len(adjacency.get(current, [])) == 2:
            next_items = [(edge, other) for edge, other in adjacency[current] if edge not in used]
            if not next_items:
                break
            edge, other = next_items[0]
            used.add(edge)
            prev, current = current, other
            keys.append(current)
            if current == keys[0]:
                break
        return keys

    # Start with non-degree-2 nodes to make open paths.
    for node, edges in list(adjacency.items()):
        if len(edges) == 2:
            continue
        for edge, _other in edges:
            if edge in used:
                continue
            keys = consume_path(node, edge)
            polylines.append(([key_to_point[k] for k in keys], False))

    # Remaining unused edges are closed cycles or isolated degree-2 loops.
    for edge_index, (_start, _end, a, _b) in enumerate(clean_segments):
        if edge_index in used:
            continue
        keys = consume_path(a, edge_index)
        closed = len(keys) > 2 and keys[0] == keys[-1]
        if closed:
            keys = keys[:-1]
        polylines.append(([key_to_point[k] for k in keys], closed))

    return polylines


def _add_joined_polyline(msp, points: Sequence[Point], closed: bool, layer: str) -> None:
    if msp.doc.dxfversion >= "AC1015":  # DXF R2000+
        msp.add_lwpolyline(points, close=closed, dxfattribs={"layer": layer})
    else:
        msp.add_polyline2d(points, close=closed, dxfattribs={"layer": layer})


def _count_overlapping_atomic_spans(segments: Iterable[Segment], tol: float) -> int:
    groups: dict[tuple[int, int, int], list[tuple[float, float]]] = {}
    for segment in segments:
        line = _canonical_line(segment, tol)
        if line is None:
            continue
        key, _u, _n, _d, interval = line
        groups.setdefault(key, []).append(interval)

    count = 0
    for intervals in groups.values():
        boundaries = _merge_values((v for interval in intervals for v in interval), tol)
        for a, b in zip(boundaries, boundaries[1:]):
            if b - a <= tol:
                continue
            mid = (a + b) / 2.0
            coverage = sum(1 for start, end in intervals if start - tol <= mid <= end + tol)
            if coverage > 1:
                count += 1
    return count


def process_file(
    input_path: str | Path,
    output_path: str | Path,
    layer: str = "CUT",
    tol: float = 0.01,
    explode_lines: bool = False,
) -> OverkillReport:
    input_path = Path(input_path)
    output_path = Path(output_path)
    doc = ezdxf.readfile(input_path)
    msp = doc.modelspace()
    report = OverkillReport(input=str(input_path), output=str(output_path), layer=layer, tolerance=tol)

    segments: list[Segment] = []
    to_delete = []
    for entity in list(msp):
        if entity.dxf.layer != layer:
            continue
        entity_segments = _line_segments(entity)
        if entity_segments is None:
            report.unsupported_cut_entities_preserved += 1
            report.unsupported_types.append(entity.dxftype())
            continue
        segments.extend(entity_segments)
        to_delete.append(entity)

    deduped = dedupe_segments(segments, tol=tol)
    report.source_segments = len([s for s in segments if _length(*s) > tol])
    report.deduped_segments = len(deduped)
    report.overlapping_spans_removed = _count_overlapping_atomic_spans(segments, tol)
    geometry_changed = report.overlapping_spans_removed > 0 or not _same_segment_coverage(segments, deduped, tol)

    # Preserve original joined CUT entities only when overkill is a true no-op.
    # Partial overlaps can increase the LINE count after atomic splitting, so segment
    # counts alone are not a safe no-op test.
    if explode_lines or geometry_changed:
        for entity in to_delete:
            msp.delete_entity(entity)
        if explode_lines:
            for start, end in deduped:
                msp.add_line(start, end, dxfattribs={"layer": layer})
        else:
            for points, closed in _join_segments_to_polylines(deduped, tol):
                if len(points) >= 2:
                    _add_joined_polyline(msp, points, closed, layer)
        report.source_entities_removed = len(to_delete)
    else:
        report.source_entities_removed = 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(output_path)
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deduplicate overlapping straight segments on a DXF CUT layer.")
    parser.add_argument("input", help="Input DXF file")
    parser.add_argument("output", help="Output DXF file")
    parser.add_argument("--layer", default="CUT", help="Layer to process (default: CUT)")
    parser.add_argument("--tol", type=float, default=0.01, help="Tolerance in drawing units/mm (default: 0.01)")
    parser.add_argument(
        "--explode-lines",
        action="store_true",
        help="Always replace supported CUT entities with deduped LINE entities, even if no overlaps are removed.",
    )
    args = parser.parse_args(argv)
    report = process_file(args.input, args.output, layer=args.layer, tol=args.tol, explode_lines=args.explode_lines)
    print(report.format())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
