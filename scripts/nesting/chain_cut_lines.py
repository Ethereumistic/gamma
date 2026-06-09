#!/usr/bin/env python3
"""
CUT Layer Endpoint Chainer for DXF files
=========================================

Standalone script that processes DXF files in batch, extracting CUT layer
entities and chaining them into continuous LWPOLYLINE cutting paths by
connecting segments at shared endpoints.

The problem this solves:
  Your nesting output has N individual LINE entities on the CUT layer.
  Many of these lines share endpoints (one line ends exactly where the
  next begins). The CNC should follow a continuous path, not lift between
  every 2-point segment.

What "chaining" means:
  1. Extract all CUT entities (LINE, LWPOLYLINE, POLYLINE) → individual segments
  2. Build a graph: endpoints → which segments touch them
  3. Walk the graph: trace continuous chains from loose ends
  4. Write each chain as a single LWPOLYLINE on the CUT layer

No collinear merging. No "making lines longer". Just connecting dots.

Usage:
    # Process all .dxf files in a directory (output to separate dir)
    python chain_cut_lines.py nesting_sheets/ -o chained_output/

    # Single file
    python chain_cut_lines.py input.dxf -o output.dxf

    # Dry run (stats only)
    python chain_cut_lines.py nesting_sheets/ --dry-run -v

    # In-place (overwrites originals)
    python chain_cut_lines.py nesting_sheets/ --in-place
"""

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import ezdxf

# ─── Tolerance ──────────────────────────────────────────────────────────────

SNAP_TOL = 0.01  # mm — endpoints closer than this are "the same point"


def snap(v: float) -> float:
    """Snap a coordinate to the tolerance grid."""
    return round(v / SNAP_TOL) * SNAP_TOL


def pt_key(x: float, y: float) -> tuple[float, float]:
    """Quantized point key for endpoint matching."""
    return (snap(x), snap(y))


# ─── Data ───────────────────────────────────────────────────────────────────

@dataclass
class Segment:
    """A 2D line segment with original entity reference for tracing."""
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
    def start_key(self) -> tuple[float, float]:
        return pt_key(self.x1, self.y1)

    @property
    def end_key(self) -> tuple[float, float]:
        return pt_key(self.x2, self.y2)

    def other_end(self, pt: tuple[float, float]) -> tuple[float, float]:
        """Given one endpoint key, return the other."""
        if pt == self.start_key:
            return self.end_key
        return self.start_key

    def point_at(self, pt: tuple[float, float]) -> tuple[float, float]:
        """Return actual (unsnapped) coordinates at this end."""
        if pt == self.start_key:
            return (self.x1, self.y1)
        return (self.x2, self.y2)


@dataclass
class ChainStats:
    """Statistics for a single file."""
    filename: str
    input_entities: int = 0
    input_segments: int = 0
    chains: int = 0
    total_chain_points: int = 0
    cut_layer_found: bool = False
    # Diagnostics
    loose_ends: int = 0
    internal_points: int = 0
    junctions: int = 0
    unchained_segments: int = 0


# ─── DXF extraction ─────────────────────────────────────────────────────────

def extract_cut_segments(doc) -> list[Segment]:
    """Extract all line segments from the CUT layer."""
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
            pts = [(v.dxf.location.x, v.dxf.location.y)
                   for v in entity.vertices]
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


# ─── Endpoint chaining ──────────────────────────────────────────────────────

def build_endpoint_map(segments: list[Segment]) -> dict[tuple, list[int]]:
    """Build a map from quantized endpoint → list of segment indices."""
    ep_map: dict[tuple[float, float], list[int]] = defaultdict(list)
    for i, seg in enumerate(segments):
        ep_map[seg.start_key].append(i)
        ep_map[seg.end_key].append(i)
    return ep_map


def trace_chains(segments: list[Segment]) -> tuple[list[list[tuple[float, float]]], int]:
    """
    Trace continuous chains through the endpoint graph.

    Returns:
        chains: list of chains, each chain is a list of (x, y) points
        unchained: count of segments that couldn't be chained
                   (involved in T-junctions or degree>2 nodes)
    """
    if not segments:
        return [], 0

    ep_map = build_endpoint_map(segments)

    # Classify endpoints by degree (number of unique segments touching them)
    degree: dict[tuple[float, float], int] = {}
    for pt, idxs in ep_map.items():
        degree[pt] = len(set(idxs))

    # Identify loose ends (degree 1) — these are chain start/end points
    loose_ends = {pt for pt, d in degree.items() if d == 1}

    # Junction points (degree > 2) — we don't trace through these
    # Each segment at a junction is treated as a separate chain end
    junctions = {pt for pt, d in degree.items() if d > 2}

    visited: set[int] = set()
    chains: list[list[tuple[float, float]]] = []
    unchained = 0

    def trace_from(seg_idx: int, start_pt: tuple[float, float]) -> list[tuple[float, float]]:
        """Trace a chain starting from a given segment endpoint."""
        chain = [start_pt]
        current_pt = start_pt
        visited.add(seg_idx)

        while True:
            seg = segments[seg_idx]
            next_pt = seg.other_end(current_pt)
            chain.append(seg.point_at(next_pt))

            # Stop at loose end, junction, or dead end
            if next_pt in loose_ends or next_pt in junctions:
                break

            # Find unvisited segments at next_pt
            candidates = [j for j in ep_map[next_pt] if j not in visited]
            if not candidates:
                break

            seg_idx = candidates[0]
            visited.add(seg_idx)
            current_pt = next_pt

        return chain

    # Phase 1: Start chains from loose ends (open chains)
    for pt in sorted(loose_ends):  # sorted for determinism
        candidates = [i for i in ep_map[pt] if i not in visited]
        if not candidates:
            continue
        chain = trace_from(candidates[0], pt)
        chains.append(chain)

    # Phase 2: Handle junction segments — trace each unvisited segment
    # at junctions as a separate short chain
    for pt in junctions:
        for seg_idx in ep_map[pt]:
            if seg_idx in visited:
                continue
            chain = trace_from(seg_idx, pt)
            chains.append(chain)

    # Phase 3: Handle closed loops (all degree-2 segments not yet visited)
    for i, seg in enumerate(segments):
        if i in visited:
            continue
        # This segment is part of a closed loop (all endpoints degree 2)
        chain = trace_from(i, seg.start_key)
        # Close the loop if the chain ends at the start
        if len(chain) > 2 and pt_key(chain[-1][0], chain[-1][1]) == pt_key(chain[0][0], chain[0][1]):
            chain[-1] = chain[0]  # ensure exact closure
        chains.append(chain)

    unchained = sum(1 for i in range(len(segments)) if i not in visited)
    return chains, unchained


# ─── DXF writing ────────────────────────────────────────────────────────────

def replace_cut_with_chains(
    doc,
    chains: list[list[tuple[float, float]]],
) -> int:
    """
    Remove all CUT entities and replace with chained polylines.
    Uses POLYLINE (2D) for maximum DXF version compatibility (R12+).
    Returns number of polyline entities written.
    """
    msp = doc.modelspace()

    # Remove old CUT entities
    to_remove = []
    for entity in msp:
        if entity.dxf.layer.upper() == "CUT":
            to_remove.append(entity)
    for entity in to_remove:
        msp.delete_entity(entity)

    # Ensure CUT layer exists with correct color (green ACI 3)
    if "CUT" not in doc.layers:
        doc.layers.add("CUT", color=3)

    # Write each chain as a POLYLINE (2D) — works in all DXF versions
    written = 0
    for chain in chains:
        if len(chain) < 2:
            continue

        # Check if chain is closed (first and last point match)
        first_key = pt_key(chain[0][0], chain[0][1])
        last_key = pt_key(chain[-1][0], chain[-1][1])
        closed = (first_key == last_key) and len(chain) > 2

        points = [(p[0], p[1]) for p in chain]
        if closed:
            points = points[:-1]  # remove duplicate closing point

        if len(points) < 2:
            continue

        # Use add_polyline2d for R12+ compatibility
        poly = msp.add_polyline2d(
            points,
            close=closed,
            dxfattribs={"layer": "CUT"},
        )
        written += 1

    return written


# ─── Main processing ────────────────────────────────────────────────────────

def process_file(
    input_path: Path,
    output_path: Optional[Path] = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> ChainStats:
    """Process a single DXF file: extract → chain → write."""
    stats = ChainStats(filename=input_path.name)

    doc = ezdxf.readfile(str(input_path))
    msp = doc.modelspace()

    # Count input entities on CUT layer
    for entity in msp:
        if entity.dxf.layer.upper() == "CUT":
            stats.cut_layer_found = True
            stats.input_entities += 1

    if not stats.cut_layer_found:
        if verbose:
            print(f"  {input_path.name}: No CUT layer, skipping.")
        return stats

    # Extract segments
    segments = extract_cut_segments(doc)
    stats.input_segments = len(segments)

    if not segments:
        if verbose:
            print(f"  {input_path.name}: No CUT segments found.")
        return stats

    # Diagnostics: endpoint degree distribution
    ep_map = build_endpoint_map(segments)
    degree_dist: dict[int, int] = defaultdict(int)
    for pt, idxs in ep_map.items():
        degree_dist[len(set(idxs))] += 1

    stats.loose_ends = degree_dist.get(1, 0)
    stats.internal_points = degree_dist.get(2, 0)
    stats.junctions = sum(v for k, v in degree_dist.items() if k > 2)

    if verbose:
        print(f"  {input_path.name}: {stats.input_entities} entities → "
              f"{stats.input_segments} segments")
        print(f"    Endpoints: {stats.loose_ends} loose, "
              f"{stats.internal_points} internal, "
              f"{stats.junctions} junctions")

    # Chain
    chains, unchained = trace_chains(segments)
    stats.chains = len(chains)
    stats.total_chain_points = sum(len(c) for c in chains)
    stats.unchained_segments = unchained

    reduction = stats.input_entities - stats.chains
    print(f"  {input_path.name}: {stats.input_entities} entities → "
          f"{stats.chains} chains "
          f"({stats.total_chain_points} pts, "
          f"-{reduction} entities, "
          f"{reduction / stats.input_entities * 100:.0f}% fewer)")

    if dry_run:
        if verbose and chains:
            for i, c in enumerate(chains):
                print(f"    Chain {i}: {len(c)} points")
        return stats

    # Write
    count = replace_cut_with_chains(doc, chains)

    if output_path is None:
        output_path = input_path

    doc.saveas(str(output_path))
    return stats


def process_directory(
    input_dir: Path,
    output_dir: Optional[Path] = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> list[ChainStats]:
    """Process all .dxf files in a directory."""
    dxf_files = sorted(input_dir.glob("*.dxf"))
    if not dxf_files:
        print(f"No .dxf files found in {input_dir}")
        return []

    print(f"Found {len(dxf_files)} DXF file(s) in {input_dir}\n")

    if output_dir and not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    all_stats: list[ChainStats] = []
    errors = 0
    for f in dxf_files:
        out = output_dir / f.name if output_dir else None
        try:
            s = process_file(f, out, dry_run, verbose)
            all_stats.append(s)
        except Exception as e:
            print(f"  ERROR {f.name}: {e}", file=sys.stderr)
            errors += 1

    # Summary
    total_in = sum(s.input_entities for s in all_stats)
    total_chains = sum(s.chains for s in all_stats)
    total_pts = sum(s.total_chain_points for s in all_stats)
    cut_files = sum(1 for s in all_stats if s.cut_layer_found)
    print(f"\n{'='*60}")
    print(f"Summary: {len(all_stats)} files processed ({errors} errors)")
    print(f"  Files with CUT layer: {cut_files}")
    print(f"  Total input entities:  {total_in}")
    print(f"  Total output chains:   {total_chains}")
    print(f"  Total chain points:    {total_pts}")
    if total_in > 0:
        print(f"  Entity reduction: {total_in - total_chains} "
              f"({(total_in - total_chains) / total_in * 100:.0f}% fewer entities)")

    return all_stats


# ─── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Chain CUT layer lines into continuous LWPOLYLINE paths",
    )
    parser.add_argument("input", help="Input DXF file or directory")
    parser.add_argument("-o", "--output", default=None,
                        help="Output file or directory (default: in-place with --in-place)")
    parser.add_argument("--in-place", action="store_true",
                        help="Overwrite input files")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show stats without writing")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Detailed per-file stats")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} does not exist", file=sys.stderr)
        sys.exit(1)

    if input_path.is_file():
        output = Path(args.output) if args.output else None
        if not output and not args.in_place and not args.dry_run:
            print("Error: specify -o <output> or --in-place", file=sys.stderr)
            sys.exit(1)
        process_file(input_path, output, args.dry_run, args.verbose)
    elif input_path.is_dir():
        output_dir = Path(args.output) if args.output else None
        if not output_dir and not args.in_place and not args.dry_run:
            print("Error: specify -o <dir> or --in-place", file=sys.stderr)
            sys.exit(1)
        process_directory(input_path, output_dir, args.dry_run, args.verbose)
    else:
        print(f"Error: {input_path} is not a file or directory", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
