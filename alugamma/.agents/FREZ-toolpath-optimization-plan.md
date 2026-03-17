# Implementation Plan: FREZ Line Outer-to-Inner Sorting Algorithm

## For: Claude Sonnet 4.6 in IDE
## Scope: STRICTLY LIMITED to `geometry.py` — one new function and one modification to how `sort_outer_to_inner` works for FREZ layers

---

## ⛔ Critical Constraints — Read Before Touching Anything

**You are only allowed to modify `geometry.py` and the single call site in `pipeline.py` that invokes `sort_outer_to_inner` for FREZ/FREZ_135 layers.**

Do NOT touch:
- `dxf_reader.py` — no changes
- `toolpath.py` — no changes
- `gcode_writer.py` — no changes
- `config.py` — no changes
- `main.py` — no changes
- Any frontend files — no changes
- Any other sorting function (`sort_nearest_neighbour` etc.) — no changes
- The CUT layer sorting logic — no changes
- The HOLES layer sorting logic — no changes

If you find yourself editing anything outside `geometry.py` and the one call site in `pipeline.py`, stop. You are out of scope.

---

## Context: What Currently Exists

In `geometry.py`, there is an existing function:

```python
def sort_outer_to_inner(contours: list[Contour], sheet_bbox: BBox) -> list[Contour]:
```

This function currently sorts by **maximum Euclidean distance to the centroid of the bounding box** — it is the function being replaced for FREZ layers only.

In `pipeline.py`, this function is called for FREZ and FREZ_135 layers:

```python
if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
    ordered = sort_outer_to_inner(contours, bbox)
```

The `bbox` passed here comes from `reader.get_bounding_box()` which returns the **SHEETS layer bounding box** if present, otherwise the geometry bounding box. This is the physical sheet boundary and is correct to use as-is — do not change how `bbox` is obtained.

---

## The Physics Background (Read to Understand Why)

The material is Etalbond® — a 4mm aluminium composite panel (two 0.5mm aluminium skins bonded to a polyethylene core). FREZ lines are scored at Z=-3mm, creating a living hinge that penetrates most of the panel thickness. On an imperfect vacuum table, scoring a line releases local tension. Scoring interior lines early causes the panel to warp and lift.

**The structural requirement:** lines closest to the physical sheet boundary must be scored before lines deeper in the interior. This preserves the panel's rigidity and the vacuum table's hold-down effectiveness for as long as possible.

**The travel reality:** in 80%+ of jobs, the FREZ toolpath should begin near a corner of the sheet (bottom-left or bottom-right), not from wherever the previous T7 HOLES toolpath ended. The HOLES tool typically finishes somewhere in the middle of the sheet, which is the wrong starting position for FREZ sequencing.

---

## The Algorithm to Implement

### Step 1: Scoring Function — Mean Distance to Boundary

For each contour, calculate its **tension score** as the **mean distance to the closest physical sheet edge**, averaged over all tessellated points in the contour.

```
tension_score(contour) = mean over all points p of:
    min(
        p.x - stock_bbox.min_x,
        stock_bbox.max_x - p.x,
        p.y - stock_bbox.min_y,
        stock_bbox.max_y - p.y
    )
```

**Why mean, not min or max:**
- `min()` fails for long lines that start at the edge but penetrate to the center — it classifies a 600mm penetrating line as "outermost" because one endpoint is near the boundary. This is physically dangerous.
- `max()` cannot distinguish a small center notch from a long penetrating line — both score the same.
- `mean()` over all tessellated points correctly penalises lines that spend most of their length in the interior, even if one end touches the boundary. A 600mm edge-to-center line scores ~300mm average. A 40mm edge-hugging line scores ~10mm average. Correct ordering results.

The contours arriving here have already been through `path.flattening(0.01)` in `dxf_reader.py`, so they have sufficient intermediate points for mean scoring to be meaningful. Do not re-tessellate.

### Step 2: Sort by Tension Score Ascending

Sort all contours by their tension score, lowest first. Low score = close to boundary = outer = cut first. High score = deep interior = cut last. This single sort satisfies the structural requirement completely.

### Step 3: Self-Calibrating Band for NN Travel Optimisation

After sorting, apply nearest-neighbour reordering within a tolerance band to reduce machine travel, without violating structural ordering.

```
score_range = max(scores) - min(scores)
band_tolerance = score_range * 0.05
```

The 5% band is self-calibrating:
- If all FREZ lines score between 38mm and 45mm (tightly clustered job), band = 0.35mm → essentially strict score order, minimal reordering
- If FREZ lines span 10mm to 400mm (complex nested job), band = 19.5mm → meaningful travel optimisation within each depth level

No hardcoded millimeter values. No external libraries.

### Step 4: Starting Position — Corner Entry, Not Tool Position

**This is the most operationally important step.**

Do NOT start NN traversal from wherever T7 HOLES ended. Instead:

1. Identify the four corners of the stock bounding box:
   - Bottom-left: `(stock_bbox.min_x, stock_bbox.min_y)`
   - Bottom-right: `(stock_bbox.max_x, stock_bbox.min_y)`
   - Top-left: `(stock_bbox.min_x, stock_bbox.max_y)`
   - Top-right: `(stock_bbox.max_x, stock_bbox.max_y)`

2. Find which corner is **closest to the first contour in the outermost band** (the contour with the lowest tension score). Use the start point (`contour.points[0]`) of that contour.

3. That corner becomes the `entry_point` for the NN traversal.

**Why:** 80%+ of real jobs begin the FREZ pass from a bottom corner, proceeding clockwise around the sheet perimeter. This matches the physical reality of how the original human-programmed files are sequenced. The algorithm must replicate this natural entry behaviour, not inherit a random mid-sheet position from the HOLES toolpath.

---

## Complete Implementation

Add the following function to `geometry.py`. Do not remove or modify `sort_outer_to_inner` — rename the new function as specified so the call site change is minimal and surgical:

```python
def sort_frez_outer_to_inner(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sort FREZ/FREZ_135 contours from outermost (closest to sheet boundary)
    to innermost (deepest into sheet interior).

    Uses mean dist-to-boundary over all tessellated contour points.
    This correctly handles long penetrating lines that min() would misclassify.

    Travel efficiency is optimised via nearest-neighbour within a self-calibrating
    5% score-range band. No hardcoded parameters.

    Entry point is always the sheet corner nearest to the outermost contour,
    NOT the tool's position from the previous toolpath.
    """
    if not contours:
        return []

    def tension_score(contour: Contour) -> float:
        if not contour.points:
            return 0.0
        total = 0.0
        for p in contour.points:
            d = min(
                p.x - stock_bbox.min_x,
                stock_bbox.max_x - p.x,
                p.y - stock_bbox.min_y,
                stock_bbox.max_y - p.y,
            )
            total += d
        return total / len(contour.points)

    # Score every contour
    scored = [(tension_score(c), c) for c in contours]
    scored.sort(key=lambda x: x[0])

    scores = [s for s, _ in scored]
    sorted_contours = [c for _, c in scored]

    # Self-calibrating band for NN travel optimisation
    score_range = (max(scores) - min(scores)) if len(scores) > 1 else 0.0
    band = score_range * 0.05

    # Determine entry point: corner of stock bbox nearest to outermost contour
    corners = [
        Point(stock_bbox.min_x, stock_bbox.min_y),  # bottom-left
        Point(stock_bbox.max_x, stock_bbox.min_y),  # bottom-right
        Point(stock_bbox.min_x, stock_bbox.max_y),  # top-left
        Point(stock_bbox.max_x, stock_bbox.max_y),  # top-right
    ]
    outermost_start = sorted_contours[0].points[0]
    entry_point = min(corners, key=lambda corner: dist_sq(corner, outermost_start))

    # NN traversal within score band — structural order preserved
    result = []
    remaining = list(range(len(sorted_contours)))
    current_pos = entry_point

    while remaining:
        current_score = scores[remaining[0]]  # lowest score in remaining (structural anchor)

        # Candidates: all remaining contours within band_tolerance of current structural front
        candidates = [
            i for i in remaining
            if scores[i] <= current_score + band
        ]

        # Among candidates, pick nearest to current position
        best = min(candidates, key=lambda i: dist_sq(current_pos, sorted_contours[i].points[0]))

        result.append(sorted_contours[best])
        current_pos = sorted_contours[best].points[-1]
        remaining.remove(best)

    return result
```

### Call Site Change in `pipeline.py`

Change the single FREZ sorting call from:

```python
# BEFORE
if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
    ordered = sort_outer_to_inner(contours, bbox)
```

To:

```python
# AFTER
if layer_name in (LAYER_FREZ, LAYER_FREZ_135):
    ordered = sort_frez_outer_to_inner(contours, bbox)
```

Also update the import line at the top of `pipeline.py` to include the new function:

```python
# BEFORE
from .geometry import join_segments, sort_outer_to_inner, sort_nearest_neighbour, simplify_contour

# AFTER
from .geometry import join_segments, sort_outer_to_inner, sort_frez_outer_to_inner, sort_nearest_neighbour, simplify_contour
```

`sort_outer_to_inner` remains in the import because it may be used elsewhere. Do not remove it.

---

## Verification Checklist

After implementing, verify each of these before considering the task done:

- [ ] `geometry.py` has the new `sort_frez_outer_to_inner` function
- [ ] The original `sort_outer_to_inner` function is **unchanged and still present**
- [ ] `sort_nearest_neighbour` is **unchanged and still present**
- [ ] `pipeline.py` import line includes `sort_frez_outer_to_inner`
- [ ] `pipeline.py` call site uses `sort_frez_outer_to_inner` for FREZ/FREZ_135 only
- [ ] CUT layer still uses `sort_nearest_neighbour` — unchanged
- [ ] HOLES layer still uses `sort_nearest_neighbour` — unchanged
- [ ] No other files were modified
- [ ] Python syntax check passes: `python -m py_compile geometry.py pipeline.py`
- [ ] On a test job with FREZ lines, the first cut starts near a sheet corner, not the center

---

## What Success Looks Like

On any FREZ toolpath output, verify manually that:

1. The first FREZ cut is near the bottom-left or bottom-right corner of the sheet — not in the middle
2. Subsequent cuts proceed roughly outward-to-inward — perimeter-adjacent lines before center lines
3. Long lines that cross most of the sheet width appear **later** in the sequence, not first
4. The NC file still has the correct tool order: T7(HOLES) → T9(FREZ) → T7(CUT)
5. The CUT toolpath is completely unaffected