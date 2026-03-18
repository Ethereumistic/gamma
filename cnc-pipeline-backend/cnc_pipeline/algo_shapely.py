"""
FREZ bending-line sort — symmetric tension-relief ordering
with rapid-travel optimisation.

Core principle
--------------
ACM sheet metal must be scored from the outside in, alternating
left↔right and bottom↔top, so that vacuum hold-down force is
released symmetrically and the panel never buckles or lifts.

Why the original Shapely approach was broken
--------------------------------------------
It measured each line's distance to the *convex hull* of all lines
combined.  Every line that lies inside the hull gets distance = 0, so
interior lines race to the front of the queue instead of going last.

Correct macro-ordering metric
------------------------------
For a bending line the only geometrically meaningful distance is its
perpendicular distance to the sheet edge it is closest to in its own
axis direction:

  • Vertical line   (|dy| ≥ |dx|) → distance to nearest *vertical*
                                     sheet edge  (left or right wall)
  • Horizontal line (|dx| >  |dy|) → distance to nearest *horizontal*
                                     sheet edge  (top or bottom wall)

Micro-optimisation (rapid-travel minimisation)
----------------------------------------------
All contours that share the same side AND the same perpendicular
distance (within a 1 mm floating-point tolerance) form one *tier*.
Tiers arise naturally when a single physical flange is split into two
segments by a notch.  Within each tier the tool visits contours in
nearest-neighbour order, and for every open contour the cheaper
endpoint becomes the entry point (the contour is reversed as needed).
This collapses intra-tier rapids from hundreds of mm down to the
physical notch gap (~56 mm in test-0.dxf).

Pipeline
--------
1. Score + classify → 4 side buckets (left / right / bottom / top).
2. Sort each bucket ascending by perpendicular distance.
3. Within each bucket, group contours that share the same distance tier.
4. Interleave groups in opposite-side pairs:
     LR stream : left_grp₀, right_grp₀, left_grp₁, right_grp₁, …
     BT stream : bot_grp₀,  top_grp₀,   bot_grp₁,  top_grp₁, …
5. Sorted-merge LR and BT streams by group representative score.
6. Process each group with nearest-neighbour traversal + endpoint flip.
"""

from .models import Contour, BBox


# ---------------------------------------------------------------------------
# Internal geometry helpers
# ---------------------------------------------------------------------------

def _line_bbox(contour: Contour) -> tuple[float, float, float, float]:
    """Return (x_min, y_min, x_max, y_max) of a contour's bounding box."""
    xs = [p.x for p in contour.points]
    ys = [p.y for p in contour.points]
    return min(xs), min(ys), max(xs), max(ys)


def _classify_and_score(
    contour: Contour,
    sheet_xmin: float,
    sheet_ymin: float,
    sheet_xmax: float,
    sheet_ymax: float,
) -> tuple[float, str]:
    """
    Return (perpendicular_edge_distance, side) where side ∈
    {'left', 'right', 'bottom', 'top'}.

    Vertical contours (bbox height ≥ width) are scored against the
    nearest vertical sheet wall; horizontal ones against the nearest
    horizontal wall.
    """
    x_min, y_min, x_max, y_max = _line_bbox(contour)
    dx = x_max - x_min
    dy = y_max - y_min

    if dy >= dx:                        # VERTICAL
        x_mid   = (x_min + x_max) / 2.0
        d_left  = x_mid - sheet_xmin
        d_right = sheet_xmax - x_mid
        return (d_left, "left") if d_left <= d_right else (d_right, "right")
    else:                               # HORIZONTAL
        y_mid   = (y_min + y_max) / 2.0
        d_bot   = y_mid - sheet_ymin
        d_top   = sheet_ymax - y_mid
        return (d_bot, "bottom") if d_bot <= d_top else (d_top, "top")


def _dist_sq(ax: float, ay: float, bx: float, by: float) -> float:
    return (ax - bx) ** 2 + (ay - by) ** 2


# ---------------------------------------------------------------------------
# Tier grouping
# ---------------------------------------------------------------------------

# Type alias for a scored contour entry inside a bucket
_Entry = tuple[float, Contour]
# A tier: (representative_score, list_of_entries)
_Tier  = tuple[float, list[_Entry]]


def _group_bucket_into_tiers(
    bucket: list[_Entry],
    tol: float = 1.0,
) -> list[_Tier]:
    """
    Split a pre-sorted bucket into consecutive groups of entries whose
    perpendicular scores differ by at most *tol* mm.  Each group is a
    tier and will be visited without interruption by the other side.
    """
    if not bucket:
        return []

    tiers: list[_Tier] = []
    rep_score = bucket[0][0]
    current:  list[_Entry] = [bucket[0]]

    for entry in bucket[1:]:
        if abs(entry[0] - rep_score) <= tol:
            current.append(entry)
        else:
            tiers.append((rep_score, current))
            rep_score = entry[0]
            current   = [entry]

    tiers.append((rep_score, current))
    return tiers


# ---------------------------------------------------------------------------
# Nearest-neighbour traversal within one tier
# ---------------------------------------------------------------------------

def _nn_within_tier(
    tier_entries: list[_Entry],
    cx: float,
    cy: float,
) -> tuple[list[Contour], float, float]:
    """
    Visit every contour in *tier_entries* using a greedy nearest-neighbour
    traversal starting from (cx, cy).

    For each open contour the cheaper endpoint becomes the entry point;
    the contour is reversed when points[-1] is nearer than points[0].

    Returns
    -------
    ordered : contours in visit order, directions adjusted
    cx, cy  : tool position after the last contour
    """
    unvisited: list[_Entry] = list(tier_entries)
    ordered:   list[Contour] = []

    while unvisited:
        best_idx = 0
        best_dsq = float("inf")
        best_rev = False

        for i, (_, c) in enumerate(unvisited):
            p0 = c.points[0]
            p1 = c.points[-1]
            d0 = _dist_sq(cx, cy, p0.x, p0.y)
            d1 = _dist_sq(cx, cy, p1.x, p1.y)
            d  = min(d0, d1)
            if d < best_dsq:
                best_dsq = d
                best_idx = i
                best_rev = d1 < d0

        _, chosen = unvisited.pop(best_idx)

        if best_rev:
            chosen = Contour(list(reversed(chosen.points)), chosen.is_closed)

        ordered.append(chosen)
        cx = chosen.points[-1].x
        cy = chosen.points[-1].y

    return ordered, cx, cy


# ---------------------------------------------------------------------------
# Interleave two tier-streams (alternating whole groups, not elements)
# ---------------------------------------------------------------------------

def _interleave_tier_streams(
    a: list[_Tier],
    b: list[_Tier],
) -> list[_Tier]:
    """
    Interleave two tier-streams group-by-group:
        a[0], b[0], a[1], b[1], …

    Interleaving *whole groups* (not individual contours) is the key
    difference from the naïve element-wise interleave.  It ensures that
    all segments of a split flange stay in the same tier and are visited
    consecutively, so the tool moves only the notch-gap distance instead
    of crossing the sheet.
    """
    result: list[_Tier] = []
    for i in range(max(len(a), len(b))):
        if i < len(a):
            result.append(a[i])
        if i < len(b):
            result.append(b[i])
    return result


# ---------------------------------------------------------------------------
# Sorted merge of two tier-streams by representative score
# ---------------------------------------------------------------------------

def _merge_tier_streams(
    lr: list[_Tier],
    bt: list[_Tier],
) -> list[_Tier]:
    """
    Standard O(n) sorted merge: always pick whichever stream's next tier
    has the smaller representative score.
    """
    merged: list[_Tier] = []
    ai = bi = 0
    while ai < len(lr) or bi < len(bt):
        if ai >= len(lr):
            merged.append(bt[bi]); bi += 1
        elif bi >= len(bt):
            merged.append(lr[ai]); ai += 1
        elif lr[ai][0] <= bt[bi][0]:
            merged.append(lr[ai]); ai += 1
        else:
            merged.append(bt[bi]); bi += 1
    return merged


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def sort_frez_shapely(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sort FREZ (bending) lines in symmetric outside-in, tension-relief order
    with rapid-travel optimisation.

    Parameters
    ----------
    contours   : list of Contour objects representing bending lines
    stock_bbox : BBox of the sheet stock  (min_x / min_y / max_x / max_y)

    Returns
    -------
    Sorted list of Contour objects with directions adjusted for minimum
    rapid travel, ready for NC output.
    """
    if not contours:
        return []

    sheet_xmin = stock_bbox.min_x
    sheet_ymin = stock_bbox.min_y
    sheet_xmax = stock_bbox.max_x
    sheet_ymax = stock_bbox.max_y

    # ------------------------------------------------------------------
    # Step 1 – Score every contour and route into 4 side buckets
    # ------------------------------------------------------------------
    buckets: dict[str, list[_Entry]] = {
        "left": [], "right": [], "bottom": [], "top": [],
    }

    for c in contours:
        if len(c.points) < 2:
            # Degenerate single-point contour — park it at the very end
            buckets["bottom"].append((float("inf"), c))
            continue

        score, side = _classify_and_score(
            c, sheet_xmin, sheet_ymin, sheet_xmax, sheet_ymax
        )
        buckets[side].append((score, c))

    # ------------------------------------------------------------------
    # Step 2 – Sort each bucket ascending by perpendicular distance
    # ------------------------------------------------------------------
    for side in buckets:
        buckets[side].sort(key=lambda e: e[0])

    # ------------------------------------------------------------------
    # Step 3 – Group each bucket into same-distance tiers (tol = 1 mm)
    # ------------------------------------------------------------------
    TIER_TOL = 1.0  # mm

    left_tiers   = _group_bucket_into_tiers(buckets["left"],   TIER_TOL)
    right_tiers  = _group_bucket_into_tiers(buckets["right"],  TIER_TOL)
    bottom_tiers = _group_bucket_into_tiers(buckets["bottom"], TIER_TOL)
    top_tiers    = _group_bucket_into_tiers(buckets["top"],    TIER_TOL)

    # ------------------------------------------------------------------
    # Step 4 – Interleave opposite-side tier-streams (group by group)
    #
    #   LR : left_tier₀, right_tier₀, left_tier₁, right_tier₁, …
    #   BT : bot_tier₀,  top_tier₀,   bot_tier₁,  top_tier₁,  …
    # ------------------------------------------------------------------
    lr_stream = _interleave_tier_streams(left_tiers,   right_tiers)
    bt_stream = _interleave_tier_streams(bottom_tiers, top_tiers)

    # ------------------------------------------------------------------
    # Step 5 – Sorted merge of LR and BT tier-streams by score
    # ------------------------------------------------------------------
    merged = _merge_tier_streams(lr_stream, bt_stream)

    # ------------------------------------------------------------------
    # Step 6 – Process each tier: NN traversal + endpoint direction flip
    # ------------------------------------------------------------------
    result: list[Contour] = []

    # Seed tool position at the first point of the very first contour
    if merged:
        seed = merged[0][1][0][1]   # first tier → first entry → Contour
        cx   = seed.points[0].x
        cy   = seed.points[0].y
    else:
        cx, cy = sheet_xmin, sheet_ymin

    for _score, tier_entries in merged:
        ordered, cx, cy = _nn_within_tier(tier_entries, cx, cy)
        result.extend(ordered)

    return result