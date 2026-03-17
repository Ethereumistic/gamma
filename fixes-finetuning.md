
# Implementation Plan: Respect Native DXF Polylines & Remove `join_segments`

## Objective
The current pipeline destroys pre-joined AutoCAD geometry by flattening polylines into individual segments and attempting to re-join them based on proximity (which creates mutations at T-junctions). We need to bypass `join_segments` entirely. The system must read native DXF entities (Lines, Polylines, Circles) and convert them directly into 1:1 `Contour` objects.

## Phase 1: Resolve Circular Imports
1. Move the `@dataclass class Contour:` definition out of `cnc_pipeline/geometry.py` and place it into `cnc_pipeline/dxf_reader.py` (below `Point`, `Segment`, and `BBox`).
2. In `cnc_pipeline/geometry.py`, update the imports to fetch `Contour` from `.dxf_reader`.

## Phase 2: Refactor `dxf_reader.py`
Inside `DXFReader`, replace the `get_entities` method with a new `get_contours` method that respects the original DXF object boundaries:

```python
    def get_contours(self, layer: str) -> list[Contour]:
        contours = []
        chord_tolerance = 0.01

        for e in self.msp.query(f'*[layer=="{layer}"]'):
            if e.dxftype() not in ('LINE', 'ARC', 'LWPOLYLINE', 'CIRCLE', 'POLYLINE'):
                continue
            try:
                path = make_path(e)
                points_raw = list(path.flattening(chord_tolerance))
                if len(points_raw) < 2:
                    continue
                
                # Convert to our Point objects
                points = [Point(p.x, p.y) for p in points_raw]
                
                # Check for closure (if start and end points are essentially identical)
                is_closed = False
                dist_sq = (points[0].x - points[-1].x)**2 + (points[0].y - points[-1].y)**2
                if dist_sq <= 0.001:  # Microscopic tolerance for closure
                    is_closed = True
                    points.pop() # Remove the duplicate closing point
                    
                contours.append(Contour(points, is_closed))
            except Exception:
                pass
        return contours
```

## Phase 3: Update `pipeline.py`
1. **Imports:** Remove `join_segments` from the `geometry` import list.
2. **Toolpath Loop:** Update the main layer iteration (around line 41):
   * *Change:* `segments = reader.get_entities(layer_name)` 
     *To:* `contours = reader.get_contours(layer_name)`
   * *Remove:* `contours = join_segments(segments)`
   * *Keep:* `contours = [simplify_contour(c) for c in contours]`
3. **Reference Layers Loop:** Update the visualisation loop at the bottom (around line 77) to iterate over `Contour`s instead of `Segment`s:
   * *Change:* `ref_segments = reader.get_entities(ref_layer)`
     *To:* `ref_contours = reader.get_contours(ref_layer)`
   * *Update inner loop to match the `ordered` loop:*
     ```python
     for contour in ref_contours:
         for i in range(len(contour.points) - 1):
             p1 = contour.points[i]
             p2 = contour.points[i+1]
             out_segments.append({
                 "x1": p1.x, "y1": p1.y,
                 "x2": p2.x, "y2": p2.y,
                 "layer": ref_layer,
                 "seq_index": seq_index,
             })
             seq_index += 1
         if contour.is_closed and len(contour.points) > 0:
             p1 = contour.points[-1]
             p2 = contour.points[0]
             out_segments.append({
                 "x1": p1.x, "y1": p1.y,
                 "x2": p2.x, "y2": p2.y,
                 "layer": ref_layer,
                 "seq_index": seq_index,
             })
             seq_index += 1
     ```

## Phase 4: Clean up `geometry.py`
1. Delete the `join_segments` function completely—it is now dead, dangerous code.
