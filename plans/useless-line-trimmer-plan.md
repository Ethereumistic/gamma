# Useless Line Trimmer Plan

## Problem Analysis
Currently, the geometry engine in `alugamma/src/features/sheet-metal/geometry.ts` segments and trims "CUT" (green) lines using a notch-based logic, but it adds "FREZ" (purple) lines as simple, non-segmented segments spanning the full width or height of a side. 

When flanges are deep (high TOP/BOTTOM or wide LEFT/RIGHT), these FREZ lines extend into corner areas that should be relieved by V-notches. This results in "useless lines" that overlap or extend into empty space outside the metal boundary, as seen in the reported images.

## Proposed Solution
We need to introduce a line-clipping mechanism for all `FREZ` and `HOLES` lines that respects the cumulative boundaries defined by all V-notches.

### 1. Refactor Boundary Calculation
Extract the "innermost" boundary logic from `addHorizontalCutEdge` and `addVerticalCutEdge` into reusable utility functions:
- `getTopBoundaryY(x)`: returns the minimum Y (deepest cut) among all top notches at position X. 
- `getBottomBoundaryY(x)`: returns the maximum Y among all bottom notches at position X.
- `getLeftBoundaryX(y)`: returns the maximum X among all left notches at position Y.
- `getRightBoundaryX(y)`: returns the minimum X among all right notches at position Y.

### 2. Implement `isInsideMetal(x, y)`
Create a helper that checks if a point `(x, y)` is within the valid sheet metal area:
```typescript
function isInsideMetal(x, y) {
  return (
    y <= getTopBoundaryY(x) + EPS &&
    y >= getBottomBoundaryY(x) - EPS &&
    x >= getLeftBoundaryX(y) - EPS &&
    x <= getRightBoundaryX(y) + EPS
  );
}
```

### 3. Implement `addTrimmableLine`
Instead of calling `addLine` directly for `FREZ` and `HOLES` layers, use a new utility that:
1. **Identifies Critical Points**: Collects all X (for horizontal) or Y (for vertical) coordinates where the boundary might change slope or intersect the line.
   - For a horizontal line at `fixedY`:
     - All `apexX` and `shoulderX` from top/bottom notches.
     - Intersection points of `fixedY` with the angled lines of left/right notches (using `getInnerNotchX`).
2. **Segments the Line**: Splits the line at these unique critical points.
3. **Validates Segments**: For each segment, check its midpoint using `isInsideMetal`.
4. **Draws**: Only calls `addLine` for segments that are "inside".

### 4. Integration
Update `_computeSheetMetalGeometry` to use `addTrimmableLine` for:
- Main fold lines for all sides.
- Diagonal relief lines (added in the flange loops).
- Inner FREZ lines (from `innerFrezLines`).
- Hole lines (added in `addHoleLines`).

## Success Criteria
- [ ] Purple fold lines (FREZ) are trimmed at the edge of V-notches instead of going straight through them.
- [ ] No lines of any layer (except CUT) exist outside the boundary defined by the active notches.
- [ ] Diagonal relief transitions remain intact but are trimmed if they hit a second notch from another side.

## Technical Notes
- **Precision**: Use a small epsilon (e.g., `1e-5`) for boundary comparisons to avoid floating point gaps.
- **Performance**: Notch counts are small, so per-segment midpoint checks are computationally negligible.
- **Diagonal Lines**: For diagonal lines (like relief transitions), use a slightly more general approach or parameterize the clipping logic to handle any line `y = mx + b`.
