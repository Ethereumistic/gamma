// ────────────────────────────────────────────────────────────────────────────────
// Sheet-Metal — Polyline Closure Algorithm
//
// Stitches a set of line segments into one or more polylines by walking
// their endpoint graph. Pure, deterministic, no Maker.js dependency.
//
// Plan refs: TASK 10 §4.1, §5
// ────────────────────────────────────────────────────────────────────────────────

// ── Polyline type ────────────────────────────────────────────────────────────

/** A closed (or open) polyline, stored as a sequence of points. */
export type Polyline = {
  /** Ordered vertices, in mm, in part-local coordinates */
  points: Array<{ x: number; y: number }>;
  /** Whether the polyline closes (first point ≈ last point within tol) */
  closed: boolean;
  /** Which layer this polyline belongs to (always "CUT" for now) */
  layer: "CUT";
};

/** Default snap tolerance for vertex matching. Matches COINCIDENCE_TOL. */
export const POLYLINE_SNAP_TOL = 0.01; // mm

// ── Internal helpers ─────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type RawSegment = { x1: number; y1: number; x2: number; y2: number };

/** Euclidean distance between two points. */
function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a canonical vertex key for a point by clustering nearby points
 * together. Uses a sorted-scan approach: sort all endpoints, then assign
 * cluster keys by scanning in order and grouping points within tolerance.
 *
 * This avoids the boundary problem of a snap grid (where points at 10.000
 * and 10.005 round to different cells at tol=0.01).
 */
function buildVertexClusters(
  endpoints: Array<{ x: number; y: number; idx: number }>,
  tol: number,
): Map<number, string> {
  // For each endpoint, create a cluster key based on its quantized position.
  // We use a two-pass approach: first cluster X coordinates, then Y.

  // Collect all unique X and Y values
  const allX = endpoints.map((p) => p.x);
  const allY = endpoints.map((p) => p.y);

  // Sort and cluster X values
  const sortedX = [...allX].sort((a, b) => a - b);
  const xClusters = new Map<number, number>(); // original X → cluster center
  let clusterX = sortedX[0];
  for (const x of sortedX) {
    if (Math.abs(x - clusterX) > tol) {
      clusterX = x;
    }
    xClusters.set(x, clusterX);
  }

  // Sort and cluster Y values
  const sortedY = [...allY].sort((a, b) => a - b);
  const yClusters = new Map<number, number>(); // original Y → cluster center
  let clusterY = sortedY[0];
  for (const y of sortedY) {
    if (Math.abs(y - clusterY) > tol) {
      clusterY = y;
    }
    yClusters.set(y, clusterY);
  }

  // Build the endpoint → key mapping
  const keyMap = new Map<number, string>();
  for (const ep of endpoints) {
    const cx = xClusters.get(ep.x) ?? ep.x;
    const cy = yClusters.get(ep.y) ?? ep.y;
    keyMap.set(ep.idx, `${cx.toFixed(4)},${cy.toFixed(4)}`);
  }

  return keyMap;
}

// ── Main algorithm ────────────────────────────────────────────────────────────

/**
 * Stitch a set of line segments into one or more polylines by walking
 * their endpoint graph. Pure, deterministic, no Maker.js dependency.
 *
 * Algorithm:
 *  1. Cluster endpoints within tolerance to build a vertex graph.
 *  2. Build adjacency: each edge connects two vertex cluster keys.
 *  3. Find connected components via BFS.
 *  4. For each component, trace polylines:
 *     a. Start at degree-1 vertices (open chains) or any vertex (closed loops).
 *     b. Walk edges until no more edges remain from the current vertex.
 *     c. If the walk returns to the start vertex, mark as closed.
 *  5. Filter out zero-length edges and degenerate polylines (< 2 points).
 *
 * Complexity: O(n log n) for the sort, O(n) for the rest.
 */
export function computeCutPolylines(
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  snapTol: number = POLYLINE_SNAP_TOL,
): Polyline[] {
  if (segments.length === 0) return [];

  const tol = snapTol;

  // ── Step 0: Filter out zero-length segments ───────────────────────────
  const valid: RawSegment[] = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    if (Math.sqrt(dx * dx + dy * dy) > tol * 0.1) {
      valid.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
    }
  }

  if (valid.length === 0) return [];

  // ── Step 1: Build vertex clusters ─────────────────────────────────────
  // Collect all endpoints with their segment and endpoint indices
  const endpoints: Array<{ x: number; y: number; idx: number }> = [];
  for (let i = 0; i < valid.length; i++) {
    endpoints.push({ x: valid[i].x1, y: valid[i].y1, idx: i * 2 });
    endpoints.push({ x: valid[i].x2, y: valid[i].y2, idx: i * 2 + 1 });
  }

  const keyMap = buildVertexClusters(endpoints, tol);

  // Map endpoint index to its cluster center point (for output coordinates)
  const clusterCenter = new Map<string, Point>();
  for (const ep of endpoints) {
    const key = keyMap.get(ep.idx)!;
    if (!clusterCenter.has(key)) {
      clusterCenter.set(key, { x: ep.x, y: ep.y });
    }
    // Use the first-seen point as the canonical position for this cluster
    // (this ensures consistent output coordinates)
  }

  // ── Step 2: Build adjacency ──────────────────────────────────────────
  type EdgeInfo = {
    index: number;
    keyA: string;
    keyB: string;
  };

  const adjacency = new Map<string, number[]>(); // vertex key → edge indices
  const edges: EdgeInfo[] = [];

  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    const keyA = keyMap.get(i * 2)!;
    const keyB = keyMap.get(i * 2 + 1)!;
    const edgeIdx = edges.length;

    edges.push({ index: edgeIdx, keyA, keyB });

    if (!adjacency.has(keyA)) adjacency.set(keyA, []);
    if (!adjacency.has(keyB)) adjacency.set(keyB, []);
    adjacency.get(keyA)!.push(edgeIdx);
    adjacency.get(keyB)!.push(edgeIdx);
  }

  // ── Step 3: Find connected components via BFS ────────────────────────
  const visitedEdges = new Set<number>();
  const visitedVertices = new Set<string>();
  const components: string[][] = []; // each component is a list of vertex keys

  for (const startKey of adjacency.keys()) {
    if (visitedVertices.has(startKey)) continue;

    const component: string[] = [];
    const queue: string[] = [startKey];
    visitedVertices.add(startKey);

    while (queue.length > 0) {
      const vk = queue.shift()!;
      component.push(vk);

      for (const eIdx of adjacency.get(vk) ?? []) {
        if (visitedEdges.has(eIdx)) continue;
        visitedEdges.add(eIdx);

        const e = edges[eIdx];
        const neighborKey = e.keyA === vk ? e.keyB : e.keyA;
        if (!visitedVertices.has(neighborKey)) {
          visitedVertices.add(neighborKey);
          queue.push(neighborKey);
        }
      }
    }

    components.push(component);
  }

  // ── Step 4: For each component, trace polylines ───────────────────────
  const polylines: Polyline[] = [];

  for (const component of components) {
    // Build a working adjacency that we can mutate (remove used edges)
    const workAdj = new Map<string, number[]>();
    for (const vk of component) {
      workAdj.set(vk, [...(adjacency.get(vk) ?? [])]);
    }

    // Count degree for each vertex in this component
    const degree = new Map<string, number>();
    for (const vk of component) {
      degree.set(vk, workAdj.get(vk)?.length ?? 0);
    }

    // Find degree-1 vertices (open chain endpoints)
    const deg1 = component.filter(
      (vk) => (degree.get(vk) ?? 0) % 2 === 1,
    );

    // Count remaining edges
    let remaining = component.reduce(
      (sum, vk) => sum + (workAdj.get(vk)?.length ?? 0),
      0,
    ) / 2;

    while (remaining > 0) {
      // Pick a start vertex: prefer degree-1 (open chain end), else any with edges
      let startKey: string | null = null;

      // First try degree-1 vertices
      for (const vk of deg1) {
        if ((workAdj.get(vk)?.length ?? 0) > 0) {
          startKey = vk;
          break;
        }
      }

      // If no degree-1 vertices, pick any vertex with remaining edges
      if (startKey === null) {
        for (const vk of component) {
          if ((workAdj.get(vk)?.length ?? 0) > 0) {
            startKey = vk;
            break;
          }
        }
      }

      if (startKey === null) break;

      // Walk the chain/loop from startKey
      const chainPts: Point[] = [clusterCenter.get(startKey)!];
      let currentKey = startKey;
      let isClosed = false;

      while (true) {
        const neighbors = workAdj.get(currentKey);
        if (!neighbors || neighbors.length === 0) break;

        // Pick the first available edge from currentKey
        const edgeIdx = neighbors.shift()!;
        const edge = edges[edgeIdx];

        // Determine the other vertex
        const otherKey = edge.keyA === currentKey ? edge.keyB : edge.keyA;

        // Remove this edge from the other vertex's adjacency list too
        const otherNeighbors = workAdj.get(otherKey);
        if (otherNeighbors) {
          const idx = otherNeighbors.indexOf(edgeIdx);
          if (idx >= 0) otherNeighbors.splice(idx, 1);
        }

        remaining--;

        // Check if we've returned to start → closed loop
        if (otherKey === startKey) {
          isClosed = true;
          currentKey = otherKey;
          break;
        }

        chainPts.push(clusterCenter.get(otherKey)!);
        currentKey = otherKey;
      }

      // If closed, add start point at end for closure
      if (isClosed) {
        chainPts.push(clusterCenter.get(startKey)!);
      }

      // Deduplicate consecutive identical points
      const deduped: Point[] = [chainPts[0]];
      for (let i = 1; i < chainPts.length; i++) {
        if (dist(chainPts[i], deduped[deduped.length - 1]) > tol * 0.01) {
          deduped.push(chainPts[i]);
        }
      }

      if (deduped.length >= 2) {
        polylines.push({
          points: deduped,
          closed: isClosed,
          layer: "CUT",
        });
      }
    }
  }

  // ── Step 5: Snap closed polylines ────────────────────────────────────
  // For closed polylines, snap the last point to match the first exactly.
  for (const poly of polylines) {
    if (poly.closed && poly.points.length >= 2) {
      const first = poly.points[0];
      poly.points[poly.points.length - 1] = { x: first.x, y: first.y };
    }
  }

  return polylines;
}