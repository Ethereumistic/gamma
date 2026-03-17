# Implementation Guide: V4 CNC Toolpath Optimization (`sort_frez_outer_to_inner`)

## Context & The V3 Failure
We are optimizing CNC toolpaths for 4mm Etalbond panels. The goal is to machine stress-relieving folds from the outside-in (outermost lines first in a continuous clockwise sweep, moving toward the center).

In V3, the algorithm successfully used polar sorting but failed at clustering. It incorrectly grouped large inner rectangles and middle dividing lines into the same "Outermost Ring" as the perimeter lines. This caused the tool to abandon the outer perimeter midway through the sweep, jump to the inner rectangles, and then return to the perimeter later. 

**Root Cause:** The `tension_score` likely evaluated the *average* or *minimum* distance of a contour to the panel edges. Large rectangles have points touching the edges, artificially lowering their score and mixing them with true perimeter lines. Furthermore, it did not prioritize closed inner shapes over open inner dividers, violating vacuum hold-down principles.

**Objective:** Refactor `sort_frez_outer_to_inner` using a "Maximum Depth" tension score and a Topology Tie-Breaker (Closed vs Open) to ensure flawless logical clustering before the polar sweep.

## The V4 Algorithm Implementation Steps

Please update `sort_frez_outer_to_inner` using the following mathematical logic:

### Step 1: "Maximum Depth" Tension Score
To truly separate perimeter lines from inner geometries, we must evaluate how deep a contour penetrates the panel.
* For each point in a `Contour`, calculate its shortest distance to the `stock_bbox` edges `min(dist_left, dist_right, dist_top, dist_bottom)`.
* The `tension_score` for the entire `Contour` must be the **MAXIMUM** of these values (not the sum, average, or minimum). 
* *Logic Check:* A perimeter line stays near the edge completely (Max Depth ≈ 50mm). A large rectangle or a middle dividing line crosses through the center of the panel (Max Depth ≈ 400+mm). This guarantees perfect segregation.

### Step 2: Cluster into Concentric Rings
Sort all contours by their new `tension_score` (Max Depth) ascending. 
Group them into rings using a relative threshold (e.g., finding large gaps in the scores). 
* Ring 1 will now naturally contain ONLY the true perimeter lines.
* Ring 2+ will contain the inner rectangles and dividers.

### Step 3: Bottom-Left Anchored Polar Sweep
For the contours within Ring 1 (and sequentially for deeper rings), sort them to create a continuous clockwise path.
* Calculate the absolute center of the `stock_bbox` (`cx`, `cy`).
* Find the centroid of each contour.
* Calculate the clockwise polar angle of the centroid relative to `(cx, cy)`.
* **Anchor the Sweep:** Offset the polar angle calculations so that the Bottom-Left quadrant represents `0 degrees`, sweeping clockwise through Top-Left, Top-Right, and ending at Bottom-Right. 
* Sort the contours in the ring by this angle.

### Step 4: The Topology Tie-Breaker (Closed vs. Open)
When processing inner geometries (Ring 2+), we often encounter large closed cutouts/rectangles alongside open dividing lines. If they have similar tension scores, cutting the open divider first ruins the structural rigidity for cutting the rectangles.
* Within any given ring, if contours have similar tension scores, sort **Closed contours** (`contour.is_closed == True`) BEFORE **Open contours** (`contour.is_closed == False`).

### Step 5: Bidirectional Handshake
Retain the bidirectional logic from V3. When traversing the sorted list, always check the distance from `current_pos` to both `points[0]` and `points[-1]` of the next contour, reversing the contour's points if the end is closer to minimize rapid travel.

## Constraints
* Absolutely no hardcoding of coordinates, edge definitions, or sequence numbers.
* Rely purely on `Max Depth`, `Clockwise Polar Angle`, and `is_closed` booleans.