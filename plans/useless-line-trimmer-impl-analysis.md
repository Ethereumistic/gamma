# Useless Line Trimmer - Implementation Analysis

## What Was Done

### Problem
When flanges are MITRE'd using V-notch relief, FREZ (purple fold/mill) lines extend as unbroken segments through V-notch cutout areas at corners. These "useless lines" appear in empty space where metal has been removed by the notch.

### Root Cause
CUT (green) lines were properly segmented around V-notches via `addHorizontalCutEdge`/`addVerticalCutEdge`, but all FREZ lines were drawn as simple `addLine()` calls spanning the full side width/height with no awareness of notch boundaries.

### Changes Made to `geometry.ts`

**1. Added trimming utility functions (lines ~324-738)**

- `isInsideMetalHorizontal(x, fixedY, ...)` - Tests if a point on a horizontal line is inside valid metal
- `isInsideMetalVertical(fixedX, y, ...)` - Tests if a point on a vertical line is inside valid metal
- `getHorizontalCritXs(...)` / `getVerticalCritYs(...)` - Collects critical coordinates where inside/outside status changes
- `addTrimmableHorizontalLine(...)` - Segments horizontal line at critical points, only draws inside-metal segments
- `addTrimmableVerticalLine(...)` - Same for vertical lines
- `addTrimmableDiagonalLine(...)` - Same for 45-degree flap lines

**2. Restructured `_computeSheetMetalGeometry` (lines ~857-1205)**

- **Phase 1**: All notch arrays computed FIRST (frez-driven notches, inner frez notches, flange relief notches)
- **Phase 2**: All FREZ lines drawn using trimming functions, clipped against complete notch arrays
- Flap diagonal line data collected separately from notch creation

**3. All 20 FREZ `addLine` calls replaced with trimming versions**

No direct `addLine(shapes, "FREZ", ...)` calls remain.

### Verification

- TypeScript compiles cleanly (`tsc --noEmit` passes)
- Vite build succeeds
- Logic verified through simulation: for a model with all four flanges having V-notch reliefs, the trimming correctly removes FREZ line segments that fall inside the notch cutout areas

## Diagnostic: Why You May Not See a Difference

The trimming logic has been verified correct through standalone simulation. If you see no visual change, please check:

### 1. Hard-refresh the browser
The Vite dev server should hot-reload, but sometimes a hard refresh (Ctrl+Shift+R) is needed.

### 2. Check the browser console
I've added `[TRIM]` diagnostic logs. Open the browser DevTools console (F12). When the geometry computes, you should see lines like:
```
[TRIM] Horizontal line y=110.00 x=[0.00,227.00] notches: T=2 B=2 L=2 R=2
[TRIM]   REMOVED segment [0.00,15.00]
[TRIM]   REMOVED segment [205.00,227.00]
```
If you see these, the trimming IS working. If you see no `[TRIM]` logs at all, the notch arrays are empty for your configuration.

### 3. Verify your configuration has V-notch reliefs enabled
The trimming only activates when:
- Flanges have **reliefs** enabled (the checkboxes labeled with corner names like TL, TR, BL, BR)
- OR frez lines have **notches** enabled

If neither is set, no V-notches exist and there's nothing to trim (the fast-path just draws the full line).

### 4. Configuration that should show trimming
To test, create a model with:
- Flanges on at least two adjacent sides (e.g., top and left)
- Both flanges with `reliefs.start` enabled (the checkbox for the shared corner)
- The FREZ fold lines at the shared corner should be trimmed

## How the Trimming Works

For each FREZ line:
1. Collect all V-notch boundaries from all four edges
2. Find critical coordinates where the line might cross a notch boundary
3. Split the line into segments at these critical points
4. For each segment, check if its midpoint is inside the metal area
5. Only draw segments that are inside metal

The "inside metal" check considers all four edge notch arrays:
- **Top notches**: point removed when `Y > apexY + (|X - apexX| + D)`
- **Bottom notches**: point removed when `Y < apexY - (|X - apexX| + D)`
- **Left notches**: point removed when `X < apexX - (|Y - apexY| + D)`
- **Right notches**: point removed when `X > apexX + (|Y - apexY| + D)`

Where `D = flap * sqrt(2)` is the flap diagonal offset.
