# Sheet-Metal Geometry Engine — Technical Deep Dive

**Document version:** v1.0  
**Date:** 2026-04-26  
**Scope:** `gamma/alugamma/src/features/sheet-metal/geometry.ts` and the entire sheet-metal feature pipeline.  
**Authoritative source:** `alugamma/src/features/sheet-metal/geometry.ts` (1,524 lines, TypeScript)

---

## 1. System Overview

The AluGamma sheet-metal module is a **2D flat-pattern parametric CAD generator**. It does **not** perform 3D bend unfolding — it directly synthesizes the 2D DXF flat pattern from a high-level parametric description (`SheetMetalModel`). The output is a set of axis-aligned line segments (`LineShape[]`) organized into four DXF layers:

| Layer | DXF Color | Purpose |
|-------|-----------|---------|
| `CUT` | 3 (Green) | Outer perimeter cut lines — offset by `offsetCut` from the true base rectangle |
| `"0"` | 7 (White) | Zero-offset reference CUT lines — used when `offsetCut > 0` for registration |
| `FREZ` | 6 (Magenta) | Bend / groove lines — where the metal will be bent or scored |
| `HOLES` | 2 (Yellow) | Optional hole markings inside flanges or FREZ bands |

The geometry engine is a single file — `geometry.ts` — that contains the entire generative pipeline from parametric model to raw line primitives. It is consumed by:
- **`dxf.ts`** — serializes `GeometryResult` to DXF via `makerjs`
- **`preview-canvas.tsx`** — renders the same `GeometryResult` to an HTML5 Canvas for interactive preview
- **CNC Pipeline Backend** — reads the exported DXF, sorts contours, and generates Siemens G-code

---

## 2. Domain Model: `SheetMetalModel`

Before understanding geometry generation, we must understand the data model defined in `types.ts`. A `SheetMetalModel` describes a **rectangular base panel** with features on all four sides.

### 2.1 Core Dimensions

```typescript
baseWidth: number;      // Width of the base rectangle (mm)
baseHeight: number;     // Height of the base rectangle (mm)
offsetCut: number;       // How much the CUT layer is offset outward (mm, default 3)
invertX: boolean;        // Mirror geometry horizontally before export
invertY: boolean;        // Mirror geometry vertically before export
```

### 2.2 Sides

Each of the 4 sides (`top`, `right`, `bottom`, `left`) carries a `SideConfig`:

```typescript
type SideConfig = {
  flanges: FlangeMeasurement[];      // Bend flanges (stacked outward from base edge)
  frezLines: FrezMeasurement[];      // Outer/inner groove lines
  frezMode: "inner" | "outer";       // Where frezLines sit relative to the base edge
  innerFrezLines: FrezMeasurement[]; // Grooves inside the base rectangle
};
```

### 2.3 Flanges

A `FlangeMeasurement` defines a **bend flange** — a strip of metal folded perpendicular to the base panel. Flanges on the same side **stack**:

```typescript
type FlangeMeasurement = Measurement & {
  reliefs: { start: boolean; end: boolean };  // Corner relief notches at fold positions
  flaps:   { start: number; end: number };    // Optional 45° flap diagonals (mm length)
  holes?: HoleData;                           // Optional hole pattern in this flange
};
```

- `reliefs.start/end`: If `true`, a V-notch is cut at the flange fold position on the orthogonal edge, preventing material tearing when bent.
- `flaps.start/end`: If `> 0`, extra 45° diagonal FREZ lines are drawn from the fold line into the notch void.

### 2.4 FREZ Lines

FREZ (Germanic "fräsen" — to groove/mill) lines are lines where the metal is scored for bending.

```typescript
type FrezMeasurement = Measurement & {
  notches: { start: boolean; end: boolean };   // Auto-create notches on orthogonal edges
  spanStart?: boolean;                        // Extend into start-side adjacent flange
  spanEnd?: boolean;                          // Extend into end-side adjacent flange
  holes?: HoleData;
};
```

- **`frezMode = "inner"`**: The FREZ line is placed **inside** the base rectangle, toward the center.
- **`frezMode = "outer"`**: The FREZ line is placed **outside** the base rectangle, in the flange zone.

`notches.start/end` automatically generates V-notches on the two orthogonal edges that meet at the start/end of the FREZ line.

### 2.5 Inner FREZ Lines

These are always inside the base rectangle and can optionally `spanStart` / `spanEnd` — extending beyond the base rectangle into adjacent flange zones.

### 2.6 Corner Reliefs

```typescript
type CornerReliefAxes = { horizontal: boolean; vertical: boolean };
```

Legacy corner-relief flags. The modern system computes corner relief dynamically from flange `reliefs` and FREZ `notches` fields.

---

## 3. Coordinate System

The geometry engine uses a **Cartesian coordinate system with Y-up** (mathematical convention, not screen convention). The Canvas renderer translates this to screen coordinates with `translateY = canvasHeight - PADDING - value`.

### 3.1 Base Rectangle

```typescript
const x0 = flangeDepths.left;                        // left edge of base rect
const y0 = flangeDepths.bottom;                      // bottom edge of base rect
const x1 = x0 + model.baseWidth;                     // right edge of base rect
const y1 = y0 + model.baseHeight;                    // top edge of base rect
```

**Why `flangeDepths` as origin offset?**  
Flanges extend outward from the base rectangle. To keep all coordinates positive and the base rect in the interior, the origin is shifted by the total flange depths on the left and bottom sides.

### 3.2 Outer Bounds (with offsetCut)

```typescript
const cutX0 = x0 - model.offsetCut;
const cutY0 = y0 - model.offsetCut;
const cutX1 = x1 + model.offsetCut;
const cutY1 = y1 + model.offsetCut;

const outerLeft   = -model.offsetCut;
const outerBottom = -model.offsetCut;
const outerRight  = model.baseWidth + flangeDepths.left + flangeDepths.right + model.offsetCut;
const outerTop    = model.baseHeight + flangeDepths.bottom + flangeDepths.top + model.offsetCut;
```

The **outer perimeter** includes all flanges plus the `offsetCut` margin. The CUT layer traces this outer perimeter.

---

## 4. V-Notch Geometry Mathematics

The most geometrically sophisticated part of the engine. Corner relief notches are **isosceles right triangles (45° V-notches)**.

### 4.1 Notch Types

```typescript
type HorizontalNotch = {
  apexX: number;    // X coordinate of the notch deepest point
  apexY: number;    // Y coordinate of the notch deepest point
  shoulderY: number; // Where the V arms meet the outer edge
  flap?: number;    // Optional flap extension length
};

type VerticalNotch = {
  apexX: number;
  apexY: number;
  shoulderX: number;
  flap?: number;
};
```

### 4.2 Notch Boundary Equation

For a **top notch** (opens upward, apex at `y1`):

```
boundaryY(x) = apexY + (|x - apexX| + D)
```

Where `D = flap * √2`. The `flap` adds an extra horizontal platform at the notch apex before the 45° slope begins.

For a **bottom notch** (opens downward, apex at `y0`):

```
boundaryY(x) = apexY - (|x - apexX| + D)
```

For **left/right notches**, the equations are symmetric with X and Y swapped.

### 4.3 Shoulder Offset

```
shoulderOff = |shoulderY - apexY|   // horizontal notch
shoulderOff = |shoulderX - apexX|   // vertical notch
```

The shoulder defines how wide the notch is at the outer edge. The notch boundary is valid only within `|x - apexX| <= shoulderOff` (plus epsilon).

---

## 5. The Five-Phase Computation Pipeline

The core function `_computeSheetMetalGeometry` executes in five distinct phases:

### Phase 1: Notch Computation (lines 1048–1216)

**Goal:** Compute ALL notch apex/shoulder/flap data before drawing a single line.

Steps:
1. Compute `topShoulderY`, `bottomShoulderY`, `leftShoulderX`, `rightShoulderX` using `getCornerShoulderOffset()`.
2. Generate **FREZ-driven notches**: Every FREZ line (outer and inner) with `notches.start/end = true` creates notches on the two orthogonal edges at its position.
3. Generate **flange relief notches**: Every flange with `reliefs.start/end = true` pushes a notch at the fold position.
4. Collect **flap diagonals**: If a flange has `flaps.start/end > 0`, two 45° diagonals are queued in `flapDiagonals[]` for later drawing.

**Why Phase 1 first?**  
All subsequent line drawing needs to know where notch boundaries are, so FREZ lines can be trimmed and CUT edges can follow the notch contours.

### Phase 2: FREZ Line Drawing (lines 1217–1332)

**Goal:** Draw all FREZ lines, trimming them against the notch boundaries computed in Phase 1.

Types of FREZ lines drawn:

| Type | Function Used | Span |
|------|--------------|------|
| Flange fold lines | `addTrimmableHorizontalLine` / `addTrimmableVerticalLine` | Full span including flanges |
| Outer FREZ lines | `addTrimmableHorizontalLine` / `addTrimmableVerticalLine` | `frezMode`-dependent span |
| Inner FREZ lines | `addTrimmableHorizontalLine` / `addTrimmableVerticalLine` | Base rectangle ± span extension |
| Flap diagonals | `addTrimmableDiagonalLine` | 45° lines queued from Phase 1 |

Every line is **trimmed** — segments that fall inside notch cutout voids are removed.

### Phase 3: CUT Edge Drawing (lines 1336–1418)

**Goal:** Draw the outer perimeter, offset by `offsetCut`, with V-notch contours.

Key steps:
1. **Offset notch geometry**: Notch apexes are shifted diagonally by `offset * √2`, shoulders by `offset` (or `offset * (√2 - 1)` for outer-edge shoulders).
2. **Clip edge spans**: The start/end of each outer edge is clipped against perpendicular offset notches using `clipHorizontalSpan` / `clipVerticalSpan`.
3. **Draw notched edges**: `addHorizontalCutEdge` / `addVerticalCutEdge` walk the edge, sampling notch boundaries at critical X/Y coordinates and emitting the jagged perimeter.
4. **Corner L-brackets**: Where no relief exists, simple L-shaped lines connect the outer bounds to the offset-cut rectangle.

### Phase 4: Holes (lines 1420–1466)

**Goal:** Add hole markings to flanges and inner FREZ bands.

`processHoles` iterates every flange and inner FREZ line and calls `addHoleLines`, which generates `HOLES`-layer lines based on:
- `placement`: `"inner"` (toward base) or `"outer"` (toward flange edge)
- `orientation`: `"horizontal"` (parallel to flange) or `"vertical"` (across flange)
- `sideOffset`: inset from left/right span edges
- `endOffset`: inset from start/end of the band
- `length`: line segment length

Two lines (`line1`, `line2`) are drawn symmetrically from the outer edges toward the middle.

### Phase 5: Inversion (lines 1468–1480)

If `invertX` or `invertY` is set, all coordinates are mirrored across the outer bounds.

---

## 6. Notch-Aware Edge Drawing Algorithm

`addHorizontalCutEdge` (lines 128–220) and `addVerticalCutEdge` (lines 222–314) are the crown jewels of the geometry engine.

### 6.1 `addHorizontalCutEdge` — Algorithm

Input: `yEdge`, `startX`, `endX`, `notches[]`

1. **Filter & sort** notches whose apexX falls within the edge span.
2. **Determine direction**: `isTopEdge = notch.apexY < yEdge` — notches open upward or downward?
3. **Collect critical X coordinates** where the boundary might change:
   - `apexX ± shoulderOff`
   - `apexX`
   - Flap transition points (`shoulderOff - D`)
   - **Pairwise intersection points** of notch boundaries
4. **Deduplicate & sort** with `1e-5` epsilon.
5. **Walk segments** between critical points:
   - Sample midpoint `xMid`.
   - Determine "active notch" — the notch whose boundary is deepest inward at that X.
   - Compute Y on the notch boundary: `apexY ± (|x - apexX| + D)`.
   - Emit vertical connectors when the active notch changes, then horizontal segments.

### 6.2 Pairwise Intersection Math

When two V-notch boundaries cross, their intersection X is:

```
xInt1 = (n1.apexY - n2.apexY + n1.apexX + n2.apexX) / 2
xInt2 = (n2.apexY - n1.apexY + n1.apexX + n2.apexX) / 2
```

This comes from solving:
```
y1 ± |x - x1| = y2 ± |x - x2|
```

by considering the four possible sign combinations. Two of the four solutions fall within the valid span.

The same logic applies symmetrically for vertical edges with Y intersections.

---

## 7. Span Clipping Against Perpendicular Notches

`clipHorizontalSpan` (lines 322–380) and `clipVerticalSpan` (lines 386–442) shrink an edge's span when a perpendicular notch's diagonal intrudes into it.

### Example: Top edge clipped by left notch

A left notch at `(apexX, apexY)` opens leftward with 45° diagonals. If the top edge sits below the notch apex, the diagonal going **down-left** could cut into the top edge:

```
dist = apexY - yEdge                    // vertical distance from notch to edge
if dist <= shoulderOff:                 // diagonal reaches the edge
  xIntersect = apexX - (dist + D)     // where diagonal meets the edge
  clippedStart = max(clippedStart, xIntersect)
```

Four cases are checked for each notch:
- Diagonal going down-left / down-right (for horizontal edges)
- Diagonal going up-left / up-right (for horizontal edges)
- Same logic mirrored for vertical edges vs top/bottom notches

---

## 8. The Useless-Line Trimming System

This subsystem prevents FREZ/diagonal lines from being drawn inside notch voids.

### 8.1 Inside-Metal Tests

`isInsideMetalHorizontal(x, fixedY, ...)` (lines 473–526) and `isInsideMetalVertical(fixedX, y, ...)` (lines 528–581) test whether a point lies in valid metal or inside a notch cutout.

**Horizontal test logic:**
- For each top notch: if `x` is within shoulder range, check `fixedY > boundaryY` → **outside metal**
- For each bottom notch: check `fixedY < boundaryY` → **outside metal**
- For left/right notches: check if `x` is past their diagonal boundary → **outside metal**

`EPS = 1e-5` provides numerical stability.

### 8.2 Trimming Algorithm

`addTrimmableHorizontalLine` (lines 696–729):
1. Gather **critical X coordinates** where inside/outside status can change.
2. Split the line into segments at those X values.
3. For each segment, test its **midpoint** with `isInsideMetalHorizontal`.
4. Only emit segments whose midpoint is inside metal.

`addTrimmableVerticalLine` (lines 734–766) is symmetric.

`addTrimmableDiagonalLine` (lines 774–863):
1. Parameterize the diagonal with `t ∈ [0, 1]`.
2. Collect critical `t` values where the line crosses notch boundaries.
3. Split into segments, test midpoints with **both** horizontal and vertical inside-metal checks.
4. Emit valid segments.

This is essentially a **manual BSP-like line clipping** specifically tailored for axis-aligned lines against 45° V-notch boundaries.

---

## 9. Hole Generation Geometry

`addHoleLines` (lines 915–991) generates HOLES-layer lines based on which side the feature belongs to and the hole configuration.

### Example: Top side, horizontal orientation, inner placement

```
y = yMin + endOffset                    // inner: close to base edge
lx1 = xMin + sideOffset
lx2 = xMax - sideOffset
len = min(length, max(0, lx2 - lx1) / 2)

line1: (lx1, y) → (lx1 + len, y)      // from left edge inward
line2: (lx2 - len, y) → (lx2, y)      // from right edge inward
```

For `placement: "outer"`, the Y (or X for vertical sides) is flipped to be close to the flange outer edge. For `orientation: "vertical"`, the lines run perpendicular to the flange.

---

## 10. The Offset-Cut Dual-Pass Trick

`computeSheetMetalGeometry` (lines 1494–1513) is the **public API**. It implements a clever two-pass strategy:

```typescript
// Pass 1: Zero offset
const zeroResult = _computeSheetMetalGeometry({ ...model, offsetCut: 0 });

if (model.offsetCut === 0) return zeroResult;

// Pass 2: Actual offset
const offsetResult = _computeSheetMetalGeometry(model);

// Merge layers
return {
  ...offsetResult,
  shapes: [
    ...zeroResult.shapes.filter(s => s.layer === "FREZ"),   // true bend lines
    ...zeroResult.shapes.filter(s => s.layer === "HOLES"),  // hole references
    ...zeroResult.shapes.filter(s => s.layer === "CUT").map(s => ({ ...s, layer: "0" })), // zero ref
    ...offsetResult.shapes.filter(s => s.layer === "CUT"),  // actual cut
  ]
};
```

**Why two passes?**  
When `offsetCut > 0` (e.g., kerf compensation for plasma/laser), we need:
- FREZ lines at the **true** fold positions (zero offset)
- CUT lines at the **offset** position (material edge)
- A `"0"` reference layer showing where the nominal rectangle would be

This separation is critical for CNC operators who need to distinguish between the bend line (FREZ) and the actual material edge (CUT).

---

## 11. DXF Export

`dxf.ts` uses `makerjs` to serialize the line geometry:

1. Each `LineShape` becomes a `makerjs.paths.Line` with its layer tag.
2. A directional arrow (optional) is drawn using 3-line path primitives.
3. `makerjs.exporter.toDXF` generates the DXF string with layer colors.
4. If `includeName` is set, a raw DXF `TEXT` entity is manually injected before `ENDSEC`.

**Layer colors in DXF:**
| Layer | Color |
|-------|-------|
| `"0"` | 7 (White/Black) |
| `CUT` | 3 (Green) |
| `FREZ` | 6 (Magenta) |
| `HOLES` | 2 (Yellow) |

---

## 12. Backend CNC Pipeline Consumption

The DXF flows to the **Python backend**:

```
frontend geometry.ts → DXF file → dxf_reader.py → Contour[] → geometry.py → toolpath.py → gcode_writer.py → .nc
```

The backend `geometry.py` does **not** regenerate geometry — it **optimizes the traversal order**:
- `sort_nearest_neighbour()` for CUT layer contours
- `sort_frez_outer_to_inner()` for FREZ lines (vacuum-hold-down constraint)
- `simplify_contour()` removes collinear points to reduce NC program size

The two FREZ sorting algorithms (`algo_juggler_gemini` and `algo_juggler_claude`) solve the vacuum-hold-down problem: bend lines must be cut from outside-in so the sheet stays firmly held until the end. The Claude variant fixes aspect-ratio bias on non-square sheets (e.g., 1250×3200 ACM panels).

---

## 13. Key Algorithms Summary

| Problem | Solution |
|---------|----------|
| V-notch boundary | `apex ± (distance + flap·√2)` |
| Overlapping notches | Critical-point segment walking + midpoint active-notch test |
| Line-in-notch trimming | Split at critical coordinates, midpoint inside-metal test |
| Diagonal line trimming | Parameter `t` segmentation, dual-axis midpoint test |
| Offset compensation | Apex shifts by `offset·√2`, shoulders by `offset` (or `offset·(√2-1)` for outer edges) |
| Span clipping | Intersection of 45° diagonal with perpendicular edge |
| Dual-pass offset | Zero-offset for FREZ/HOLES/reference, offset for CUT |

---

## 14. Appendix: Glossary

| Term | Meaning |
|------|---------|
| **Base rectangle** | The central flat panel, dimensions `baseWidth × baseHeight` |
| **Flange** | A strip of metal bent perpendicular to the base panel |
| **FREZ line** | A groove/score line where the metal will be bent |
| **Inner FREZ** | A FREZ line inside the base rectangle |
| **Outer FREZ** | A FREZ line in the flange zone outside the base rectangle |
| **Relief** | A V-notch cutout preventing tearing at a bend corner |
| **Flap** | An extra diagonal FREZ line inside a V-notch |
| **Offset cut** | Kerf compensation — how much the CUT layer is enlarged beyond true size |
| **Shoulder** | Where the V-notch arms meet the outer material edge |
| **Apex** | The deepest point of a V-notch |

---

## 15. Notable Edge Cases & Behaviors

1. **Zero-length lines** are silently dropped in `addLine` (line 39).
2. **Empty side configs** produce no geometry for that side.
3. **Large `offsetCut`** can make notch shoulders vanish (`newS <= 0` → notch skipped).
4. **Flap + shoulder interaction**: `Math.max(0, shoulderOff - D)` handles cases where the flap exceeds the shoulder.
5. **No boolean geometry ops** — notching is implemented via hand-written span-clipping, not a general Clipper library.
6. **No k-factor math** — bend allowances are not computed because the system generates flat patterns directly.

---

*End of document.*
