# Implementation Guide: V3 CNC Toolpath Optimization (`sort_frez_outer_to_inner`)

## Context & Objective
We are optimizing CNC toolpaths for 4mm Etalbond panels on a vacuum table. [cite_start]Tool 9 (Tapered Tipped, 13mm diameter) is used to score the panel at Z=-3mm to create living hinges[cite: 3, 4]. Because vacuum hold-down can be imperfect on large panels (e.g., 1250x3200mm), we must machine these stress-relieving folds from the outside-in (outermost lines first, moving toward the center) in a continuous, logical sequence.

Currently, the human-generated PowerMill file (`m-human.nc`) takes an optimal clockwise, peeling-the-onion approach. [cite_start]It starts at the bottom-right corner (X:1250, Y:36) [cite: 3][cite_start], cuts to X:0 [cite: 4][cite_start], then immediately starts the next closest segment on the left edge at Y:16 and cuts upwards[cite: 5]. 

The V2 algorithm in `geometry.py` (`sort_frez_outer_to_inner`) attempts this but fails due to two flaws:
1. It uses a Nearest Neighbor search within a sliding 5% tension band. [cite_start]This causes erratic jumps across the board (e.g., moving from X:0 back to X:1250 [cite: 12, 13]) instead of following the perimeter.
2. It only calculates distance to `contour.points[0]`, forcing unidirectional cuts and creating massive rapid travel distances.

**Objective:** Refactor `sort_frez_outer_to_inner` in `geometry.py` to naturally route the toolpath in a clockwise, outside-in pattern using Polar Coordinate sorting and Bidirectional cutting. Do not hardcode edge detection.

## The V3 Algorithm Implementation Steps

Please rewrite `sort_frez_outer_to_inner` using the following logical progression:

### Step 1: Retain the Tension Score
Keep the existing `tension_score` calculation. We still need to evaluate how close a contour's points are to the `stock_bbox` to understand its depth into the panel.

### Step 2: Cluster into Concentric "Rings"
Instead of a continuous sliding band, group the contours into distinct "rings" based on their tension scores. 
* Calculate the tension score for all contours.
* Group them into buckets/clusters (e.g., contours with a score of 0-25mm are "Ring 1", 25-100mm are "Ring 2", etc.). A dynamic clustering approach (like finding natural breaks in the sorted tension scores) is preferred over hardcoded distance brackets.

### Step 3: Polar Angle Sorting (Clockwise Sweep)
For each ring, we want to trace the perimeter seamlessly. 
* Calculate the absolute center of the `stock_bbox` (`cx`, `cy`).
* For every contour in the current ring, find its centroid.
* Calculate the polar angle of that centroid relative to the panel's center `(cx, cy)`. 
* **Crucial:** Offset the angle so that the bottom-right corner (or the outermost starting point) represents the 0-degree start of the sweep.
* Sort the contours within that ring by their angular value to simulate a clockwise progression.

### Step 4: Bidirectional Nearest Endpoint (The Handshake)
Once the list of contours is sorted by ring and then by angle, iterate through them to build the final route.
* Maintain a `current_pos` variable (starting at the first point of the first contour).
* For the next contour in the sorted list, calculate the distance from `current_pos` to `points[0]` AND `points[-1]`.
* If `points[-1]` is closer, **reverse the order of the points** in that `Contour` object.
* Append the contour to the final list and update `current_pos` to the new end of the contour.

## Constraints
* Do not hardcode specific coordinate checks (e.g., `if x == 0`).
* The function signature must remain: `def sort_frez_outer_to_inner(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:`
* Ensure the output naturally handles gaps (collinear lines on the same edge will have similar angles and be processed sequentially).