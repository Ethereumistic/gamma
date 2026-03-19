"""
FREZ bending-line sort — algo_juggler
======================================

Fixes two concrete defects from conman_v2:

DEFECT 1 — Raw-mm score unfairly penalises horizontal lines on tall sheets
---------------------------------------------------------------------------
ACM sheet stock is 1 250 × 3 200 mm (W:H ≈ 0.39 : 1).

conman_v2 measures "distance to nearest edge in mm".  Because the sheet
is much taller than it is wide, a vertical line must travel only ~17 mm
from the left/right wall to have the same *percentage penetration* as a
horizontal line that is 17 mm × (3200/1250) ≈ 43 mm from the top/bottom wall.

With raw-mm scoring a horizontal line at Y=79 mm (raw = 79 mm, depth ≈ 2.5 %)
sorts AFTER a vertical line at X=37 mm (raw = 37 mm, depth ≈ 3.0 %),
even though the horizontal line is physically closer to its edge in
proportional terms.  In the test file this mis-ordering puts the outer
H lines (segs 9–10) *inside* the first V-tier instead of *before* it,
which violates vacuum-integrity rules.

Fix: normalise each contour's raw perpendicular distance by the sheet
half-dimension in its own axis before comparing with the other axis:

    vertical   → norm = raw_dist / (sheet_width  / 2)
    horizontal → norm = raw_dist / (sheet_height / 2)

Both axes now live on a [0 … 1] scale where 0 = sheet edge, 1 = centre.
The sort order reflects "fraction of the way to the centre", not mm.

DEFECT 2 — Circus-juggler anti-pattern
---------------------------------------
conman_v2 (and shapely before it) interleaves opposite sides: L, R, L, R, …
This was designed to ensure symmetric tension relief but it forces the tool
to sprint across the full sheet width after every single line.

For the vacuum-hold-down constraint the critical requirement is:

    Cut lines from the outside IN, so that vacuum area is never
    reduced from the centre before the edges are committed.

Symmetric L↔R alternation is not required; what is required is that no
inner line is cut before ALL lines at smaller normalised depth are done.

Within a depth tier the tool is free to cut whichever contour minimises
the rapid-travel distance (greedy NN), regardless of which side it is on.
The NN pass naturally clusters nearby lines (e.g. two adjacent vertical
lines on the same side) without any cross-sheet juggling.

Result: depth-ordered tiers are still strictly preserved (outside → inside),
but within each tier the tool flows smoothly rather than zigzagging.

DEFECT 3 — Tier-merge tolerance was axis-agnostic
---------------------------------------------------
conman_v2 merges tiers within 15 mm regardless of axis.  With normalised
scoring the merge tolerance is applied in the [0,1] space so that a 15 mm
gap on the short axis is treated consistently with a 15 mm gap on the long
axis.  The normalised merge tolerance is set to 0.02 (2 % of half-dimension),
which corresponds to 12.5 mm on the W-axis and 32 mm on the H-axis — a
deliberately asymmetric window that handles the physical discreteness of
both axes correctly without the single-number hack.

Pipeline
--------
1.  Score every contour: norm_score = raw_dist / half_dim  (axis-specific).
2.  Sort ALL entries globally ascending by norm_score.
3.  Group into raw tiers using TIER_TOL_NORM = 0.002 (≈ 1 mm on W-axis).
4.  Merge adjacent raw tiers within MERGE_TOL_NORM = 0.02.
5.  For each merged tier run a single greedy NN pass with endpoint flip.
6.  Return the flat ordered list of direction-adjusted Contour objects.

Measured improvement on test-0.dxf (32 FREZ segments, 1250 × 3200 mm sheet)
-----------------------------------------------------------------------------
  shapely (original)    21 586 mm total rapids
  conman v2              7 265 mm total rapids
  juggler               ~5 000 mm total rapids  (estimated pre-run)

The main gain versus conman_v2 is that the 4 outermost H lines (at Y≈79 mm,
norm≈0.049) now sort BEFORE the second-ring V lines (at X=37 mm, norm≈0.059),
which is both physically correct (they are closer to their edge in normalised
space) and produces shorter rapids because outer-bottom lines terminate near
the same corners as outer-left/right lines.
"""

from .models import Contour, BBox


# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

# Group entries whose normalised scores differ by ≤ this into one raw tier.
# 0.002 ≈ 1.25 mm on the W-axis  (0.002 × 625)
TIER_TOL_NORM   = 0.002

# Merge adjacent raw tiers whose normalised scores differ by ≤ this.
# 0.02 ≈ 12.5 mm on the W-axis  (0.02 × 625)
MERGE_TOL_NORM  = 0.02


# ---------------------------------------------------------------------------
# Internal geometry helpers
# ---------------------------------------------------------------------------

def _line_bbox(contour: Contour) -> tuple[float, float, float, float]:
    """Return (x_min, y_min, x_max, y_max) of a contour's point set."""
    xs = [p.x for p in contour.points]
    ys = [p.y for p in contour.points]
    return min(xs), min(ys), max(xs), max(ys)


def _norm_score(
    contour: Contour,
    sheet_xmin: float,
    sheet_ymin: float,
    sheet_xmax: float,
    sheet_ymax: float,
) -> float:
    """
    Normalised perpendicular score in [0 … 1].

    0 = line sits right on the sheet edge.
    1 = line sits exactly in the centre of the sheet.

    Vertical contours   (bbox height ≥ width):
        raw = min(x_mid − xmin, xmax − x_mid)
        norm = raw / half_W          where half_W = (xmax − xmin) / 2

    Horizontal contours (bbox width > height):
        raw = min(y_mid − ymin, ymax − y_mid)
        norm = raw / half_H          where half_H = (ymax − ymin) / 2

    Dividing by the axis-specific half-dimension puts both axes on the
    same [0, 1] scale so they can be compared directly despite the
    non-square sheet geometry.
    """
    x_min, y_min, x_max, y_max = _line_bbox(contour)
    dx = x_max - x_min
    dy = y_max - y_min

    half_W = (sheet_xmax - sheet_xmin) / 2.0
    half_H = (sheet_ymax - sheet_ymin) / 2.0

    if dy >= dx:                            # VERTICAL
        x_mid = (x_min + x_max) / 2.0
        raw   = min(x_mid - sheet_xmin, sheet_xmax - x_mid)
        return raw / half_W if half_W > 0 else 0.0
    else:                                   # HORIZONTAL
        y_mid = (y_min + y_max) / 2.0
        raw   = min(y_mid - sheet_ymin, sheet_ymax - y_mid)
        return raw / half_H if half_H > 0 else 0.0


def _dist_sq(ax: float, ay: float, bx: float, by: float) -> float:
    return (ax - bx) ** 2 + (ay - by) ** 2


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

_Entry = tuple[float, Contour]          # (norm_score, contour)
_Tier  = tuple[float, list[_Entry]]    # (representative_score, entries)


# ---------------------------------------------------------------------------
# Tier grouping
# ---------------------------------------------------------------------------

def _group_into_raw_tiers(entries: list[_Entry], tol: float) -> list[_Tier]:
    """
    Group a globally sorted list of (score, contour) entries into consecutive
    tiers whose scores differ by at most *tol*.
    """
    if not entries:
        return []

    tiers: list[_Tier] = []
    rep   = entries[0][0]
    group: list[_Entry] = [entries[0]]

    for entry in entries[1:]:
        if abs(entry[0] - rep) <= tol:
            group.append(entry)
        else:
            tiers.append((rep, group))
            rep   = entry[0]
            group = [entry]

    tiers.append((rep, group))
    return tiers


# ---------------------------------------------------------------------------
# Tier merging
# ---------------------------------------------------------------------------

def _merge_adjacent_tiers(raw_tiers: list[_Tier], merge_tol: float) -> list[_Tier]:
    """
    Collapse adjacent raw tiers whose representative scores differ by at most
    *merge_tol* into a single merged tier.

    The merged tier inherits the MINIMUM score of its constituent raw tiers so
    that correct outside-in ordering between merged tiers is preserved.

    This handles the common case where the same physical flange depth produces
    slightly different perpendicular scores for V-lines vs H-lines due to
    geometry discretisation.
    """
    if not raw_tiers:
        return []

    merged: list[_Tier] = []
    cur_score, cur_entries = raw_tiers[0]

    for next_score, next_entries in raw_tiers[1:]:
        if next_score - cur_score <= merge_tol:
            # Absorb: keep the lower (outer) score as the tier representative
            cur_entries = cur_entries + next_entries
            # cur_score stays as-is (it is already the minimum)
        else:
            merged.append((cur_score, cur_entries))
            cur_score   = next_score
            cur_entries = next_entries

    merged.append((cur_score, cur_entries))
    return merged


# ---------------------------------------------------------------------------
# Nearest-neighbour traversal within one tier (no side juggling)
# ---------------------------------------------------------------------------

def _nn_within_tier(
    tier_entries: list[_Entry],
    cx: float,
    cy: float,
) -> tuple[list[Contour], float, float]:
    """
    Greedy nearest-neighbour traversal across ALL contours in *tier_entries*
    starting from tool position (cx, cy).

    For each open contour the cheaper endpoint is chosen as the entry point;
    the contour is reversed when points[-1] is closer than points[0].

    No side-juggling: the tool simply visits whichever uncut contour's nearest
    endpoint is closest to the current position.  Because tiers contain
    contours from all sides simultaneously the NN pass routes naturally along
    sheet perimeters without forced cross-sheet rapids.

    Returns
    -------
    ordered : contours in visit order with directions adjusted
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
# Public entry point
# ---------------------------------------------------------------------------

def sort_frez_juggler(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sort FREZ (bending) lines in outside-in, vacuum-integrity order with
    aspect-ratio-normalised scoring and minimal rapid-travel routing.

    Drop-in replacement for sort_frez_shapely and sort_frez_conman_v2.

    Parameters
    ----------
    contours   : list of Contour objects representing bending lines
    stock_bbox : BBox of the sheet stock  (min_x / min_y / max_x / max_y)

    Returns
    -------
    Sorted list of Contour objects with directions adjusted for minimum
    rapid travel, ready for NC output.

    Key differences from conman_v2
    --------------------------------
    1. Normalised scoring  — raw_dist / half_dim instead of raw_dist.
       Corrects the systematic bias that made vertical lines sort before
       horizontal lines of equal proportional depth on non-square sheets.

    2. No side juggling    — within each depth tier the greedy NN pass
       visits all contours in distance order regardless of which side they
       belong to.  Vacuum integrity is preserved by the tier ordering;
       within a tier the tool is free to take the shortest path.

    3. Normalised merge tolerance — applied in [0,1] space so that a
       typical 5–15 mm geometry discretisation gap is handled correctly
       on both axes without axis-specific tuning.
    """
    if not contours:
        return []

    sheet_xmin = stock_bbox.min_x
    sheet_ymin = stock_bbox.min_y
    sheet_xmax = stock_bbox.max_x
    sheet_ymax = stock_bbox.max_y

    # ------------------------------------------------------------------
    # Step 1 — Compute normalised score for every contour
    # ------------------------------------------------------------------
    all_entries: list[_Entry] = []

    for c in contours:
        if len(c.points) < 2:
            # Degenerate single-point contour — park at the very end
            all_entries.append((float("inf"), c))
            continue

        score = _norm_score(c, sheet_xmin, sheet_ymin, sheet_xmax, sheet_ymax)
        all_entries.append((score, c))

    # ------------------------------------------------------------------
    # Step 2 — Sort globally ascending by normalised score (outside → in)
    # ------------------------------------------------------------------
    all_entries.sort(key=lambda e: e[0])

    # ------------------------------------------------------------------
    # Step 3 — Group into raw tiers (tight tolerance in normalised space)
    # ------------------------------------------------------------------
    raw_tiers = _group_into_raw_tiers(all_entries, TIER_TOL_NORM)

    # ------------------------------------------------------------------
    # Step 4 — Merge adjacent tiers that represent the same flange depth
    #
    # A 0.02 normalised gap ≈ 12.5 mm on the W-axis / 32 mm on H-axis.
    # This catches V-score vs H-score drift that arises from geometry
    # discretisation in Orgadata / LogiKal exports without merging tiers
    # that genuinely represent different flange depths.
    # ------------------------------------------------------------------
    merged_tiers = _merge_adjacent_tiers(raw_tiers, MERGE_TOL_NORM)

    # ------------------------------------------------------------------
    # Step 5 — Process each merged tier with a single global NN pass
    # ------------------------------------------------------------------
    result: list[Contour] = []

    if merged_tiers:
        seed = merged_tiers[0][1][0][1]     # first tier → first entry → Contour
        cx   = seed.points[0].x
        cy   = seed.points[0].y
    else:
        cx, cy = sheet_xmin, sheet_ymin

    for _score, tier_entries in merged_tiers:
        ordered, cx, cy = _nn_within_tier(tier_entries, cx, cy)
        result.extend(ordered)

    return result