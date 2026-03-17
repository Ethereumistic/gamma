# Implementation Plan: FREZ Sequencing Algorithm V5

## Objective
Replace the current `sort_frez_outer_to_inner` (V4) algorithm in `cnc_pipeline/geometry.py` with Algorithm V5. V5 shifts the mechanical strategy from "perimeter rigidity" to "vacuum anchor preservation." The goal is to maximize vacuum hold-down by cutting outer perimeter flanges first, isolated small internal geometries next, internal open bridges third, and saving the largest closed central geometry (the main vacuum anchor) for absolute last.

## Target File
`cnc_pipeline/geometry.py`

## Phase 1: Required Helper Functions
Add or adapt the following helper functions inside `geometry.py` (above the main sorting function):

1.  **`contour_area(c: Contour) -> float`**
    * Create a function to calculate the bounding box area of a contour.
    * *Logic:* `(max_x - min_x) * (max_y - min_y)`.
    * *(Note: The `bbox_area` function currently nested inside `sort_nearest_neighbour` can be hoisted to the module level so V5 can use it).*

2.  **`tension_score(c: Contour, stock_bbox: BBox) -> float`**
    * Extract the `tension_score` logic currently nested inside the V4 algorithm.
    * *Logic:* Returns the maximum depth a contour reaches into the panel interior (min distance to any `stock_bbox` edge).

3.  **`nn_sort(contours: list[Contour], start_pos: Point) -> list[Contour]`**
    * Extract the nearest-neighbor sorting logic currently inside `sort_nearest_neighbour` to a standalone helper function so we can use it to sort subgroups efficiently.

## Phase 2: Classification Logic
Inside the new `sort_frez_outer_to_inner_v5(contours: list[Contour], stock_bbox: BBox) -> list[Contour]`:
Initialize four lists:
* `outermost_open: list[Contour] = []`
* `internal_open: list[Contour] = []`
* `closed_loops: list[Contour] = []`
* `largest_closed: list[Contour] = []`

**Classification Rules (Iterate through all contours):**
1.  **If `contour.is_closed` is True:**
    * Append to `closed_loops`.
2.  **If `contour.is_closed` is False:**
    * Calculate `depth = tension_score(contour, stock_bbox)`.
    * If `depth < 50.0` (Threshold to determine if it's a perimeter flange staying near the edge): Append to `outermost_open`.
    * Else: Append to `internal_open`.

## Phase 3: Processing & Priority Assignment
Process the lists in strict priority order to build the final sequence.

**Priority 1: Outermost Open Lines (Perimeter Flanges)**
* Sort `outermost_open` using the `nn_sort` helper, starting from `Point(stock_bbox.min_x, stock_bbox.min_y)`.
* Append sorted contours to the `final_result` list.
* Update `current_pos` to the end point of the last contour in this group.

**Priority 4 (Pre-calculation): Find the Anchor**
* If `closed_loops` is not empty, find the contour with the absolute maximum `contour_area`.
* Pop this contour out of `closed_loops` and assign it to `largest_closed`.

**Priority 2: Smallest Closed Loops**
* Sort the remaining `closed_loops` by area, **ascending** (smallest first).
* Append to `final_result`.
* Update `current_pos` to the end point of the last contour.

**Priority 3: Internal Open Lines (Bridges)**
* Sort `internal_open` using the `nn_sort` helper, starting from the current `current_pos`.
* Append to `final_result`.
* Update `current_pos`.

**Priority 4 (Execution): The Anchor**
* Append the single `largest_closed` contour to `final_result`. This guarantees the largest vacuum surface area is severed last.

## Phase 4: Bidirectional Handshake (Preserve from V4)
Apply the bidirectional handshake to `final_result` to optimize rapid moves:
* Iterate through `final_result`.
* For each contour, check the squared distance from `current_pos` to `contour.points[0]` (forward) vs `contour.points[-1]` (reverse).
* If the reverse distance is shorter, reverse the list of points in that contour.
* Update `current_pos` to the newly determined end point.

## Refactoring Cleanup
* Rename `sort_frez_outer_to_inner` to `sort_frez_outer_to_inner_v4` (or delete it).
* Name the new function `sort_frez_outer_to_inner` so `pipeline.py` calls it seamlessly without requiring changes to the pipeline routing.