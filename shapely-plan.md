Objective

Refactor the monolithic geometry.py file by extracting the existing FREZ sorting algorithms into their own dedicated files. Then, create a brand-new, unbiased algorithm using the shapely library that sorts lines based strictly on their distance to a global convex hull.

Please execute this plan step-by-step.

Step 1: Update Requirements

Add the shapely library to the project's dependencies.

Open requirements.txt.

Add the following line to the end of the file:
shapely==2.0.3

Step 2: Extract Existing Algorithms

Create three new files in the cnc_pipeline directory and move the specific algorithm functions from geometry.py into them.

Important: You must import required shared helpers (like Contour, BBox, Point, dist_sq, frez_tension_score, nn_sort_contours, contour_bbox, optimize_closed_start_and_direction) from .geometry and .models into these new files.

Create cnc_pipeline/algo_raptor.py

Move sort_frez_raptor into this file.

Note: The nested cluster_into_rings function moves with it.

Create cnc_pipeline/algo_anchor.py

Move sort_frez_anchor into this file.

Create cnc_pipeline/algo_oracle.py

Move sort_frez_oracle into this file.

Move all Oracle-specific helper functions (_oracle_is_horizontal, _oracle_is_vertical, _oracle_axis_depth, _oracle_tier, _oracle_assign_side, _oracle_decide_side_order, _oracle_tier_sort_key, _oracle_flip_if_closer) into this file.

Step 3: Implement the New Shapely Algorithm

Create a completely new file for the 0-bias algorithm. This algorithm creates a "rubber band" (convex hull) around all contours on the entire sheet, measures the distance of every contour to that boundary, and cuts the closest ones first.

Create cnc_pipeline/algo_shapely.py

Insert the following complete implementation:

# cnc_pipeline/algo_shapely.py
from shapely.geometry import LineString, MultiLineString
from .models import Contour, BBox

def sort_frez_shapely(contours: list[Contour], stock_bbox: BBox) -> list[Contour]:
    """
    Sorts FREZ lines purely by their minimum distance to the global 
    convex hull of all lines on the sheet. Outside-in macro sorting.
    """
    if not contours:
        return []

    # 1. Convert all contours into Shapely geometries
    shapely_lines = []
    valid_contours = []
    
    for c in contours:
        # Need at least 2 points to make a valid line
        if len(c.points) >= 2:
            pts = [(p.x, p.y) for p in c.points]
            shapely_lines.append(LineString(pts))
            valid_contours.append(c)
        else:
            # If a contour is just a point, we keep it but don't use it for the hull
            valid_contours.append(c)

    if not shapely_lines:
        return contours

    # 2. Compute the global Convex Hull
    # This acts as a virtual boundary around all parts on the sheet
    global_collection = MultiLineString(shapely_lines)
    global_hull = global_collection.convex_hull

    # 3. Calculate distance from each contour to the global hull
    scored_contours = []
    for c in valid_contours:
        if len(c.points) >= 2:
            pts = [(p.x, p.y) for p in c.points]
            geom = LineString(pts)
            dist = geom.distance(global_hull)
        else:
            dist = 0.0 # Fallback for malformed contours
            
        scored_contours.append((dist, c))

    # 4. Sort ascending (Distance 0.0 = touching the outer boundary)
    scored_contours.sort(key=lambda x: x[0])

    # 5. Extract and return the sorted contours
    return [c for dist, c in scored_contours]


Step 4: Clean Up & Wire Up geometry.py

Now that the algorithms are extracted, clean up cnc_pipeline/geometry.py.

Keep Shared Helpers: Ensure dist_sq, is_collinear, simplify_contour, contour_bbox, bbox_contains, optimize_closed_start_and_direction, contour_bbox_area, frez_tension_score, nn_sort_contours, and sort_outer_to_inner remain in geometry.py.

Import Algorithms: At the top (or just before the dispatcher), import the 4 algorithms from their new files:

from .algo_raptor import sort_frez_raptor
from .algo_anchor import sort_frez_anchor
from .algo_oracle import sort_frez_oracle
from .algo_shapely import sort_frez_shapely


Update Dispatcher: Update the FREZ_ALGORITHMS dictionary and the sort_frez_outer_to_inner function to support all 4 options:

FREZ_ALGORITHMS: dict[str, str] = {
    "raptor": "v0.4 Raptor",
    "anchor": "v0.5 Anchor",
    "oracle": "v1.0 Oracle",
    "shapely": "v1.0 Shapely Global Hull",
}

def sort_frez_outer_to_inner(
    contours: list[Contour],
    stock_bbox: BBox,
    algorithm: str = "raptor",
) -> list[Contour]:
    """
    Public entry point for FREZ sorting. Routes to the requested algorithm.
    """
    if algorithm == "anchor":
        return sort_frez_anchor(contours, stock_bbox)
    if algorithm == "oracle":
        return sort_frez_oracle(contours, stock_bbox)
    if algorithm == "shapely":
        return sort_frez_shapely(contours, stock_bbox)
        
    # Default fallback
    return sort_frez_raptor(contours, stock_bbox)

End of Plan