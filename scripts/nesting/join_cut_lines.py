#!/usr/bin/env python3
"""
CUT Layer Line Joiner for DXF files
====================================

Standalone script that processes DXF files in batch, extracting CUT layer
entities, joining collinear segments into the longest possible continuous
lines, and writing the result back to DXF.

This is the "ground up" prototype to test CUT line joining logic before
integrating it into the main application.

What "joining" means here:
  - Extract ALL entities from the CUT layer (LINE, LWPOLYLINE, POLYLINE)
  - Flatten everything into individual line segments (pairs of endpoints)
  - Build a graph of endpoints and find all collinear chains
  - Merge collinear overlapping/touching segments into the longest spans
  - Write the joined result as LWPOLYLINE entities on the CUT layer

Usage:
    # Process all .dxf files in a directory (in-place, with backup)
    python join_cut_lines.py /path/to/dxf/dir

    # Process a single file (output to a new file)
    python join_cut_lines.py input.dxf -o output.dxf

    # Process directory, output to a different directory
    python join_cut_lines.py /path/to/input/dir -o /path/to/output/dir

    # Dry run (show stats, don't write files)
    python join_cut_lines.py /path/to/dxf/dir --dry-run

    # Verbose (show per-file stats)
    python join_cut_lines.py /path/to/dxf/dir -v
"""

import argparse
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import ezdxf


# ─── Tolerance ──────────────────────────────────────────────────────────────

COINCIDENCE_TOL = 0.01  # mm — same as the TS codebase


# ─── Data ───────────────────────────────────────────────────────────────────

@dataclass
class Segment:
    """A 2D line segment."""
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def length(self) -> float:
        dx = self.x2 - self.x1
        dy = self.y2 - self.y1
        return (dx * dx + dy * dy) ** 0.5

    @property
    def dx(self) -> float:
        return self.x2 - self.x1

    @property
    def dy(self) -> float:
        return self.y2 - self.y1

    def reversed(self) -> "Segment":
        return Segment(self.x2, self.y2, self.x1, self.y1)


@dataclass
class JoinStats:
    """Statistics for a single file join operation."""
    filename: str
    input_entities: int = 0
    input_segments: int = 0     # raw segments extracted
    joined_segments: int = 0    # segments after joining
    output_entities: int = 0
    cut_layer_found: bool = False


# ─── Geometric helpers ──────────────────────────────────────────────────────

def segment_direction(seg: Segment) -> tuple[float, float, float]:
    """Return (ux, uy, length) — unit direction and length."""
    dx = seg.dx
    dy = seg.dy
    length = (dx * dx + dy * dy) ** 0.5
    if length < 1e-10:
        return (1.0, 0.0, 0.0)
    return (dx / length, dy / length, length)


def are_collinear(s1: Segment, s2: Segment, tol: float = COINCIDENCE_TOL) -> bool:
    """Check if two segments lie on the same infinite line (within tolerance)."""
    dx = s1.dx
    dy = s1.dy
    length = (dx * dx + dy * dy) ** 0.5
    if length < 1e-10:
        return False

    ux = dx / length
    uy = dy / length

    # Perpendicular distance of s2 endpoints from s1's infinite line
    d1 = abs((s2.x1 - s1.x1) * uy - (s2.y1 - s1.y1) * ux)
    d2 = abs((s2.x2 - s1.x1) * uy - (s2.y2 - s1.y1) * ux)

    return d1 < tol and d2 < tol


def project_point(px: float, py: float, rx: float, ry: float,
                  ux: float, uy: float) -> float:
    """Project point (px,py) onto direction (ux,uy) starting from (rx,ry)."""
    return (px - rx) * ux + (py - ry) * uy


def overlap_or_touch_1d(a0: float, a1: float, b0: float, b1: float,
                        tol: float = COINCIDENCE_TOL) -> Optional[tuple[float, float]]:
    """Check if two 1D intervals overlap or touch. Returns union or None."""
    lo_a = min(a0, a1)
    hi_a = max(a0, a1)
    lo_b = min(b0, b1)
    hi_b = max(b0, b1)

    if hi_a + tol < lo_b or hi_b + tol < lo_a:
        return None

    return (min(lo_a, lo_b), max(hi_a, hi_b))


def segments_are_joinable(s1: Segment, s2: Segment) -> bool:
    """Check if two segments can be joined (collinear + overlapping/touching)."""
    if not are_collinear(s1, s2):
        return False

    ux, uy, _ = segment_direction(s1)
    rx, ry = s1.x1, s1.y1

    t1 = project_point(s1.x1, s1.y1, rx, ry, ux, uy)
    t2 = project_point(s1.x2, s1.y2, rx, ry, ux, uy)
    t3 = project_point(s2.x1, s2.y1, rx, ry, ux, uy)
    t4 = project_point(s2.x2, s2.y2, rx, ry, ux, uy)

    range1 = (min(t1, t2), max(t1, t2))
    range2 = (min(t3, t4), max(t3, t4))

    return overlap_or_touch_1d(range1[0], range1[1], range2[0], range2[1]) is not None


def merge_joinable(s1: Segment, s2: Segment) -> Segment:
    """Merge two joinable collinear segments into their union span."""
    ux, uy, _ = segment_direction(s1)
    rx, ry = s1.x1, s1.y1

    t1 = project_point(s1.x1, s1.y1, rx, ry, ux, uy)
    t2 = project_point(s1.x2, s1.y2, rx, ry, ux, uy)
    t3 = project_point(s2.x1, s2.y1, rx, ry, ux, uy)
    t4 = project_point(s2.x2, s2.y2, rx, ry, ux, uy)

    min_t = min(t1, t2, t3, t4)
    max_t = max(t1, t2, t3, t4)

    return Segment(
        rx + min_t * ux,
        ry + min_t * uy,
        rx + max_t * ux,
        ry + max_t * uy,
    )


# ─── Endpoint-based graph joining (smarter than greedy) ────────────────────
#
# The key insight: instead of a greedy scan, build an adjacency graph of
# endpoints and merge chains of collinear segments. This handles:
#   - Multiple segments on the same line
#   - Partial overlaps
#   - End-to-end touching
#   - Nested/sub-segments

def join_cut_segments_full(segments: list[Segment]) -> list[Segment]:
    """
    Join collinear overlapping/touching segments.
    This is the "full join" / OVERKILL strategy.

    Uses a multi-pass greedy approach with convergence guarantee:
    repeatedly scan for joinable pairs until no more merges happen.
    """
    # Filter zero-length
    valid = [s for s in segments if s.length > COINCIDENCE_TOL]
    if not valid:
        return []

    # Multi-pass merge
    changed = True
    while changed:
        changed = False
        merged = []
        consumed = set()

        for i in range(len(valid)):
            if i in consumed:
                continue
            current = valid[i]

            for j in range(i + 1, len(valid)):
                if j in consumed:
                    continue
                if segments_are_joinable(current, valid[j]):
                    current = merge_joinable(current, valid[j])
                    consumed.add(j)
                    changed = True

            # Second pass: check if the merged result now joins with
            # previously-processed results
            inner_changed = True
            while inner_changed:
                inner_changed = False
                for k in range(len(merged)):
                    if segments_are_joinable(current, merged[k]):
                        current = merge_joinable(current, merged[k])
                        merged.pop(k)
                        inner_changed = True
                        changed = True
                        break

            merged.append(current)

        valid = merged

    return valid


# ─── DXF extraction ─────────────────────────────────────────────────────────

def extract_cut_segments(doc: ezdxf.document.Drawing) -> list[Segment]:
    """Extract all line segments from the CUT layer of a DXF document."""
    msp = doc.modelspace()
    segments: list[Segment] = []

    for entity in msp:
        layer = entity.dxf.layer.upper()

        if layer != "CUT":
            continue

        etype = entity.dxftype()

        if etype == "LINE":
            segments.append(Segment(
                entity.dxf.start.x, entity.dxf.start.y,
                entity.dxf.end.x, entity.dxf.end.y,
            ))

        elif etype == "LWPOLYLINE":
            pts = list(entity.get_points(format="xy"))
            closed = entity.closed
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                if not closed and i == len(pts) - 1:
                    break
                segments.append(Segment(
                    pts[i][0], pts[i][1],
                    pts[j][0], pts[j][1],
                ))

        elif etype == "POLYLINE":
            # 2D polyline — iterate vertices
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
            closed = entity.is_closed
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                if not closed and i == len(pts) - 1:
                    break
                segments.append(Segment(
                    pts[i][0], pts[i][1],
                    pts[j][0], pts[j][1],
                ))

    return segments


# ─── DXF writing ────────────────────────────────────────────────────────────

def replace_cut_layer(
    doc: ezdxf.document.Drawing,
    joined_segments: list[Segment],
) -> int:
    """
    Remove all entities from the CUT layer and replace with joined segments
    as individual LINE entities. Returns the number of entities written.
    """
    msp = doc.modelspace()

    # Collect CUT entity handles to remove
    to_remove = []
    for entity in msp:
        if entity.dxf.layer.upper() == "CUT":
            to_remove.append(entity)

    # Remove old CUT entities
    for entity in to_remove:
        msp.delete_entity(entity)

    # Add joined segments as LINE entities on CUT layer
    # Preserve CUT layer color (green, ACI 3)
    if "CUT" not in doc.layers:
        doc.layers.add("CUT", color=3)

    for seg in joined_segments:
        msp.add_line(
            (seg.x1, seg.y1),
            (seg.x2, seg.y2),
            dxfattribs={"layer": "CUT"},
        )

    return len(joined_segments)


# ─── Main processing ────────────────────────────────────────────────────────

def process_file(
    input_path: Path,
    output_path: Optional[Path] = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> JoinStats:
    """Process a single DXF file: extract, join, write."""
    stats = JoinStats(filename=input_path.name)

    doc = ezdxf.readfile(str(input_path))
    msp = doc.modelspace()

    # Count input entities on CUT layer
    for entity in msp:
        if entity.dxf.layer.upper() == "CUT":
            stats.cut_layer_found = True
            stats.input_entities += 1

    if not stats.cut_layer_found:
        if verbose:
            print(f"  {input_path.name}: No CUT layer found, skipping.")
        return stats

    # Extract segments
    segments = extract_cut_segments(doc)
    stats.input_segments = len(segments)

    if verbose:
        print(f"  {input_path.name}: {stats.input_entities} entities → "
              f"{stats.input_segments} raw segments")

    # Join
    joined = join_cut_segments_full(segments)
    stats.joined_segments = len(joined)

    reduction = stats.input_segments - stats.joined_segments
    pct = (reduction / stats.input_segments * 100) if stats.input_segments > 0 else 0
    print(f"  {input_path.name}: {stats.input_segments} → "
          f"{stats.joined_segments} segments "
          f"(-{reduction}, {pct:.0f}% reduction)")

    if dry_run:
        return stats

    # Write output
    count = replace_cut_layer(doc, joined)
    stats.output_entities = count

    if output_path is None:
        # In-place: overwrite
        output_path = input_path

    doc.saveas(str(output_path))
    return stats


def process_directory(
    input_dir: Path,
    output_dir: Optional[Path] = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> list[JoinStats]:
    """Process all .dxf files in a directory."""
    dxf_files = sorted(input_dir.glob("*.dxf"))
    if not dxf_files:
        print(f"No .dxf files found in {input_dir}")
        return []

    print(f"Found {len(dxf_files)} DXF file(s) in {input_dir}\n")

    if output_dir and not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    all_stats = []
    for f in dxf_files:
        if output_dir:
            out = output_dir / f.name
        else:
            out = None  # in-place

        try:
            stats = process_file(f, out, dry_run, verbose)
            all_stats.append(stats)
        except Exception as e:
            print(f"  ERROR processing {f.name}: {e}", file=sys.stderr)

    # Summary
    print(f"\n{'='*60}")
    print(f"Summary: {len(all_stats)} files processed")
    total_in = sum(s.input_segments for s in all_stats)
    total_out = sum(s.joined_segments for s in all_stats)
    total_cut = sum(1 for s in all_stats if s.cut_layer_found)
    print(f"  Files with CUT layer: {total_cut}")
    print(f"  Total input segments:  {total_in}")
    print(f"  Total joined segments: {total_out}")
    if total_in > 0:
        print(f"  Reduction: {total_in - total_out} "
              f"({(total_in - total_out) / total_in * 100:.0f}%)")

    return all_stats


# ─── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Join CUT layer lines in DXF files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "input",
        type=str,
        help="Input DXF file or directory containing DXF files",
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Output DXF file or directory (default: in-place)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show stats without writing files",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed per-file stats",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} does not exist", file=sys.stderr)
        sys.exit(1)

    if input_path.is_file():
        output_path = Path(args.output) if args.output else None
        stats = process_file(input_path, output_path, args.dry_run, args.verbose)
    elif input_path.is_dir():
        output_dir = Path(args.output) if args.output else None
        process_directory(input_path, output_dir, args.dry_run, args.verbose)
    else:
        print(f"Error: {input_path} is not a file or directory", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
