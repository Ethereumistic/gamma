
# Implementation Plan: Respect Native DXF Polylines & Remove `join_segments`

## Objective
The current pipeline destroys pre-joined AutoCAD geometry by flattening polylines into individual segments and attempting to re-join them based on proximity (which creates mutations at T-junctions). We need to bypass `join_segments` entirely. The system must read native DXF entities (Lines, Polylines, Circles) and convert them directly into 1:1 `Contour` objects.

## Phase 1: Shared Models & Resolve Circular Imports
To prevent circular dependencies between `dxf_reader` and `geometry`, we will centralize all shared data structures.

1. **Create `cnc_pipeline/models.py`**:
   * Move `Point`, `BBox`, `Contour`, and `Segment` from `cnc_pipeline/dxf_reader.py` and `cnc_pipeline/geometry.py`.
   * Move `Move` from `cnc_pipeline/toolpath.py`.
2. **Update Imports**:
   * Update `dxf_reader.py`, `geometry.py`, `toolpath.py`, `pipeline.py`, and `gcode_writer.py` to import these types from `.models`.

## Phase 2: Refactor `dxf_reader.py`
Inside `DXFReader`, replace the segment-based logic with contour-based logic.

1. **New `get_contours` method**:
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

2. **Update `get_bounding_box`**:
   * Modify to iterate over `get_contours` instead of `get_entities`.
   * Ensure it correctly handles the `SHEETS` layer and falls back to all geometry if `SHEETS` is missing.

3. **Deprecate `get_entities`**: Mark as deprecated or remove if unused.

## Phase 3: Update `pipeline.py` Orchestrator
1. **Imports:** Remove `join_segments` from the `geometry` import list.
2. **Core Loop Logic (around line 50):**
   * *Change:* `segments = reader.get_entities(layer_name)` → `contours = reader.get_contours(layer_name)`
   * *Remove:* `contours = join_segments(segments)`
   * *Keep:* `contours = [simplify_contour(c) for c in contours]` (Ensures collinear points are still filtered).
3. **Reference Layers Loop (around line 98):**
   * *Change:* `ref_segments = reader.get_entities(ref_layer)` → `ref_contours = reader.get_contours(ref_layer)`
   * *Update internal loop* to iterate through points and handle closure (same logic as the main toolpath visualization loop).

## Phase 4: Clean up `geometry.py`
1. **Delete `join_segments`**: This function is now redundant and dangerous.
2. **Review Sorting Algorithms**: Ensure `sort_frez_anchor` and `sort_frez_raptor` still correctly accept the list of `Contour` objects and return them ordered.

## Phase 5: Update Unit Tests
The existing tests rely heavily on `Segment` and `join_segments`.
1. **`tests/test_geometry.py`**:
   * Remove `test_join_segments` and `test_join_open_segments`.
   * Add new tests for `simplify_contour` ensuring it handles the new `Contour` structure.
2. **`tests/test_dxf_reader.py`**:
   * Replace `test_get_entities_*` with `test_get_contours_*`.
   * Verify that a closed `CIRCLE` and `LWPOLYLINE` correctly return `is_closed=True`.
3. **`tests/test_pipeline.py`**:
   * Update integration test to pass through the new contour-native flow.
