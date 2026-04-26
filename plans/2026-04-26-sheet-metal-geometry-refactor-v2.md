# Sheet-Metal Geometry Engine Refactor & Robust Trimming Resolution

## Objective

Replace the ad-hoc, edge-case-prone "useless-line trimming" system with a **unified, polygon-based metal-region representation** that clips FREZ/HOLES lines against the actual valid metal area. Simultaneously refactor the 1,524-line `geometry.ts` monolith into a modular, tested architecture that is simpler to reason about, easier to maintain, and robust against all notch configurations.

**Additionally**, implement a **bi-directional Sheet-Metal Formula DSL** — a compact textual notation (e.g. `2000x2000WF25F20AF25F20S100DF100`) that:
1. Can be fully typed into an input field to instantly generate a `SheetMetalModel` and its geometry/DXF
2. Is synchronized with the existing tanstack-hotkeys system (pressing F, Z, Q, E, WASD updates the formula in real time)
3. Provides a canonical human-readable and AI-parseable representation of any sheet-metal part

---

## Current State Analysis

### What's Working Well
- **Geometric correctness**: All CUT-layer outlines, V-notch edge contours, offset-cut dual-pass logic, and hole generation produce the correct DXF output for the vast majority of configurations.
- **Backend compatibility**: The Python CNC pipeline (`dxf_reader.py → geometry.py → toolpath.py`) consumes the DXF without issues as long as layer semantics (`CUT`, `FREZ`, `0`, `HOLES`) are preserved.
- **Coordinate system**: The Y-up Cartesian model with flange-depth origin shifting is sound and well-documented.
- **Hotkeys are functional**: There is already a tanstack-hotkeys setup for F (outer flange), Z (inner bend line), Q/E (V-notch toggles), and WASD (side selection: TOP, LEFT, BOTTOM, RIGHT).

### What's Broken / Fragile
- **Useless-line trimming (lines 453–863)**: A hand-written BSP-like midpoint-segmentation system with `isInsideMetalHorizontal`, `isInsideMetalVertical`, `getHorizontalCritXs`, `getVerticalCritYs`, and three `addTrimmable*` variants. This system:
  - Has known edge cases where FREZ lines are not trimmed correctly (adjacent overlapping notches, diagonal lines crossing multiple notch boundaries, near-zero shoulder offsets)
  - Uses duplicated logic for horizontal/vertical/diagonal cases
  - Relies on console.log debugging (`[TRIM] REMOVED segment`) left in production
  - Is extremely difficult to unit-test because it is embedded inside the monolithic `_computeSheetMetalGeometry`
- **No formula serializer**: Despite having hotkeys that build complex models, there is no way to:
  - Capture a model as a concise code string
  - Paste that string into an input to recreate the exact same shape
  - Share or version-control parametric recipes between users
  - Let AI agents reason about the geometry in a compact, symbolic form

### Code Quality Issues
- **Single-file monolith**: `geometry.ts` is 1,524 lines containing coordinate math, notch computation, edge drawing, span clipping, line trimming, hole generation, offset logic, and inversion — all without module boundaries.
- **No unit tests**: Zero test coverage for the most mathematically complex part of the frontend.
- **Magic numbers scattered**: `1e-5` epsilon, `Math.SQRT2` offsets, `offset * (Math.SQRT2 - 1)` all appear inline without named constants.
- **Duplicated boundary evaluation**: The notch boundary equation `apex ± (|dist| + D)` is evaluated in `addHorizontalCutEdge`, `isInsideMetal*`, `clipHorizontalSpan`, and `offsetHorizontalNotches` — four separate places with slight variations.
- **Imperative state mutation**: `shapes.push(...)` everywhere; no intermediate representation between model and line primitives.

### Downstream Impact Assessment
| Consumer | Dependency on geometry.ts | Sensitivity to Change |
|----------|--------------------------|----------------------|
| `dxf.ts` | Consumes `GeometryResult` (shapes + bounds) | **Low** — only needs `LineShape[]` with layer tags |
| `preview-canvas.tsx` | Renders `GeometryResult.shapes` | **Low** — same as above |
| Backend CNC pipeline | Parses exported DXF layers/colors | **Low** — DXF layer names/colors must be stable |
| `types.ts` | `SheetMetalModel` / `GeometryResult` contracts | **Medium** — these interfaces should remain stable |
| Hotkey system | Builds `SheetMetalModel` via UI actions | **Low** — will plug into the new formula state layer |

---

## Strategic Decision: Architecture Approach (Geometry Refactor)

Two high-level paths are realistic for this codebase. The plan below implements **Path A** (recommended) with **Path B** as a documented fallback.

### Path A: Extracted-Polygon Clipping (Recommended)
Build a canonical polygon representing the actual metal region (base rectangle minus all notch cutouts), then clip all non-CUT lines against this polygon using standard line-segment–polygon intersection.

**Why this is the right choice:**
- All notch boundaries are piecewise-linear (45° diagonals + horizontal/vertical shoulders).
- The valid metal region is a single polygon with concave vertices (the notches). This is a standard computational-geometry problem.
- It collapses the 4 duplicated trimming systems into **one** operation: `clipLine(poly, segment) → segments[]`.
- It is deterministic and eliminates the midpoint-sampling heuristic that causes edge cases.
- It can be implemented with minimal external dependencies (a lightweight JS line-clipping utility, or even a custom Sutherland–Hodgman / Liang–Barsky implementation since the polygon is monotone).

### Path B: Rebuild with Full 2D Boolean Library (e.g. Clipper2 JS port, polygon-clipping)
Use a robust polygon-boolean library to union the base rectangle with subtracted notch polygons, then intersect all lines against the result.

**Trade-offs:**
- More robust for degenerate cases (self-intersections, overlapping notches).
- Adds a dependency that may have bundle-size or licensing implications.
- Overkill if the notch geometry remains restricted to 45° V-shapes.
- Recommended only if Path A proves insufficient after prototyping.

### Path C: Incremental Fix (Not Recommended)
Patch the existing `isInsideMetal*` and `addTrimmable*` functions to handle more edge cases.

**Why not recommended:**
- The current approach is fundamentally heuristic-based (midpoint testing on critically-segmented intervals).
- Fixing one edge case typically introduces another due to the combinatorial explosion of notch interactions.
- The code is already unmaintainable at 1,500 lines; adding more complexity deepens the technical debt.

---

## Strategic Decision: Architecture Approach (Formula DSL)

### Design Goals for the Formula System
1. **Bi-directional**: `formula ⇄ SheetMetalModel` — typing in the formula bar builds the model; hotkey actions and manual edits update the formula bar.
2. **Human-legible**: A 20-character string should be readable by a CNC operator.
3. **AI-parseable**: LLMs / agents should be able to read and write the formula without needing to understand the full `SheetMetalModel` JSON schema.
4. **Extensible**: New feature types (e.g., custom bend radii, laser etching marks) should slot into the grammar without breaking existing strings.
5. **Backward-compatible with hotkeys**: The same mental model (WASD = side, F = flange, Z = frez, Q/E = notch toggles) is reflected in the formula syntax.

### Proposed Formula Grammar (v1 Draft)

```
[base][sideContext][features...]
```

| Token | Meaning | Example |
|-------|---------|---------|
| `WxH` | Base dimensions | `2000x1200` |
| `T|R|B|L` or `W|A|S|D` | Switch active side context | `W` = top, `A` = left, `S` = bottom, `D` = right |
| `F<amount>[r<flags>][f<flap>]` | Add flange to active side | `F25` = 25mm flange, `F25r+-` = with start/end reliefs, `F25f5` = with 5mm flap |
| `Z<amount>[n<flags>][s<flags>]` | Add outer frez line | `Z20n+-` = 20mm with notches both ends, `Z20se` = with span start/end |
| `I<amount>[s<flags>]` | Add inner frez line | `I20` = 20mm inner frez |
| `M<inner|outer>` | Set frez mode of active side | `Minner`, `Mouter` |
| `O<offset>` | Set offsetCut | `O3` |
| `H<cfg...>` | Add hole config to last feature | `Hil25` = holes, inner placement, length 25 |
| `N[+-]` | Toggle notch on last feature (Q/E) | `N+` = start notch, `N-` = end notch |
| `A` prefix on feature | Apply to **all sides** | `AF20` = 20mm flange on all 4 sides |

**Example formulas:**
- `2000x2000AF25Mouter` — 2×2 meter base, 25mm flange on all sides, outer frez mode
- `2000x2000WF25r+-F20Z20n+-Q` — top side has 25mm flange (reliefs both ends), then 20mm flange, then 20mm frez with start notch
- `2000x2000WF25f5F20WAZ20AF20S100D` — complex multi-side recipe

**Serialization rules (canonical form):**
- Always start with base dimensions
- Group features by side, with explicit side switch tokens
- Omit default values (no relief, no flap, no notches, no span) for brevity
- Use a deterministic ordering so identical models produce identical strings

### Implementation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HOTKEY CONTROLLER                         │
│  (tanstack-hotkeys)                                            │
│  F→append 'F25', Z→append 'Z20', WASD→insert side token, etc.  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FORMULA STATE (new)                           │
│  - rawFormula: string (contents of formula bar)                 │
│  - parsedModel: SheetMetalModel | null (from parser)            │
│  - parseErrors: string[] (for inline error display)             │
│  - lastValidModel: SheetMetalModel (fallback on parse error)    │
└─────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                             │
              ▼                             ▼
┌──────────────────────┐        ┌──────────────────────────────┐
│  FORMULA BAR / INPUT  │        │  GEOMETRY ENGINE            │
│  (displays rawFormula,│        │  (geometry.ts et al.)        │
│   highlights tokens,  │        │                              │
│   shows parse errors) │        │  consumes parsedModel        │
└──────────────────────┘        └──────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  SERIALIZER (SheetMetalModel → formula) │
│  - canonicalizes model into string       │
│  - called after every non-formula edit   │
│    (hotkey, manual form change, etc.)    │
└─────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase -1: Formula DSL Foundation (Parallel to Geometry Refactor)

**Goal**: Build the formula parser, serializer, state layer, and UI input before integrating with the hotkeys.

- [ ] **Design final formula grammar v1.0**  
  Write a formal grammar spec (BNF) and approve the token set. Test it against 5–10 real-world models you already have in the app to ensure the language is expressive enough.
- [ ] **Create `formula/parser.ts`**  
  Implement a simple recursive-descent or regex-based parser:
  - Input: `string` → Output: `SheetMetalModel | ParseError[]`
  - Tokenize the string into `{ type, value, position }` tokens
  - Build the `SheetMetalModel` incrementally, maintaining an `activeSide` context
  - Validate numerical ranges (e.g., flange amounts > 0, offsetCut ≥ 0)
- [ ] **Create `formula/serializer.ts`**  
  Implement the inverse:
  - Input: `SheetMetalModel` → Output: `string` (canonical formula)
  - Rules: sort sides in TRBL order, omit defaults, collapse identical all-side features into `A`-prefixed tokens where possible
- [ ] **Create `formula/state.ts` (hook)**  
  A React state hook that manages:
  - `formula: string`
  - `model: SheetMetalModel` (derived from formula OR from external edits)
  - `setFormula(f: string)` — user types in formula bar
  - `applyHotkey(token: string)` — appends a token via hotkey
  - `setModel(m: SheetMetalModel)` — external form/manual edit triggers serializer
  - Handles the "last valid model" fallback during incomplete formula typing
- [ ] **Build `FormulaBar` component**  
  A text input that:
  - Shows the current formula
  - Token-highlights individual segments (colors for side tokens, feature tokens, dimensions)
  - Shows inline parse errors with red underlines
  - Auto-formats on blur (canonicalizes via serializer)
  - Has placeholder text showing an example
- [ ] **Write unit tests for parser/serializer round-trip**  
  - For every golden `SheetMetalModel`, serialize → parse → compare to original (deep equality)
  - For every sample formula string, parse → serialize → compare to canonical form
- [ ] **Write unit tests for partial/incomplete formulas**  
  - `2000x2000` → should parse to a valid model with empty sides
  - `2000x2000W` → should parse (side selected, no features)
  - `2000x2000WF` → should produce a parse error (missing amount), keep last valid model
  - `2000x2000WFabc` → should produce a parse error (non-numeric amount)

### Phase 0: Pre-Flight Safety & Baseline (Geometry)

**Goal**: Ensure we can refactor without breaking production.

- [ ] **Audit the trimming edge cases**: Catalog every configuration where trimming currently fails. Work with the reporter to collect:
  - The exact `SheetMetalModel` JSON that triggers each failure
  - Screenshot of current vs expected output
  - Whether the failure is in horizontal, vertical, or diagonal trimming
- [ ] **Establish golden-file regression tests**: For 3–5 representative models (simple rectangle, deep flanges with all reliefs, inner FREZ with notches, complex multi-flange), compute the current `GeometryResult`, commit it as `geometry.golden.json`, and verify that `dxf.ts` produces byte-identical DXF output for these models.
- [ ] **Verify backend compatibility**: Confirm that the Python backend's `test_geometry.py` and `test_dxf_reader.py` pass against DXFs generated from the golden models.
- [ ] **Seed formula grammar with golden models**: Each golden model should have a corresponding canonical formula string that produces an identical model. Add these to the parser/serializer test suite.

### Phase 1: Modularize `geometry.ts` — Extraction Without Logic Change

**Goal**: Split the monolith into coherent modules so that each piece can be tested and replaced independently. **No behavioral changes in this phase.**

- [ ] **Create `geometry/math.ts`**  
  Extract pure math utilities:
  - `EPS` constant, `clamp()`, `isNearlyEqual()`
  - `sumMeasurements()`, `getCumulativeOffsets()`
  - `getFlangeDepths()`, `getFrezOffsets()`, `getResolvedFrezPositions()`
  - `getCornerShoulderOffset()`
  - `collectWarnings()`
- [ ] **Create `geometry/notches.ts`**  
  Extract notch data structures and boundary evaluation:
  - `HorizontalNotch`, `VerticalNotch` types
  - `evaluateTopBoundaryY(x, notch)`, `evaluateBottomBoundaryY(x, notch)`, `evaluateLeftBoundaryX(y, notch)`, `evaluateRightBoundaryX(y, notch)` — single source of truth for the boundary equation
  - `computeNotches(model)` — Phase 1 logic: build the four notch arrays from frez-driven, inner-frez, and flange-relief sources
  - `offsetNotches(notches, offset, ...)` — the offset-cut notch transformation
- [ ] **Create `geometry/edges.ts`**  
  Extract CUT-edge drawing:
  - `addHorizontalCutEdge()`
  - `addVerticalCutEdge()`
  - `clipHorizontalSpan()`
  - `clipVerticalSpan()`
- [ ] **Create `geometry/holes.ts`**  
  Extract hole generation:
  - `addHoleLines()`
  - `processHoles()`
- [ ] **Create `geometry/trim.ts`** (temporary, to be replaced in Phase 3)  
  Extract the existing trimming system verbatim:
  - `isInsideMetalHorizontal()`, `isInsideMetalVertical()`
  - `getHorizontalCritXs()`, `getVerticalCritYs()`
  - `addTrimmableHorizontalLine()`, `addTrimmableVerticalLine()`, `addTrimmableDiagonalLine()`
- [ ] **Rewrite `geometry.ts`** as a thin orchestrator  
  Import the above modules and keep only:
  - `_computeSheetMetalGeometry()` — the 5-phase pipeline
  - `computeSheetMetalGeometry()` — the dual-pass wrapper
  - Public exports (`getSideTotal`, `countShapes`, etc.)
- [ ] **Run golden-file tests** after each extraction to confirm zero behavioral drift.

### Phase 2: Introduce `MetalRegion` Polygon Abstraction

**Goal**: Replace the implicit metal region (a rectangle with ad-hoc notch checks) with an explicit polygon that can be queried, clipped, and visualized.

- [ ] **Create `geometry/region.ts`**  
  Define:
  - `type Point = { x: number; y: number }`
  - `type Polygon = Point[]` (closed, CCW)
  - `function buildMetalRegion(model, notches): Polygon`
    1. Start with the outer rectangle `[outerLeft,outerBottom] → [outerRight,outerBottom] → [outerRight,outerTop] → [outerLeft,outerTop]`
    2. For each top notch: insert a CCW V-shaped indentation into the top edge
    3. For each bottom notch: insert a CW V-shaped indentation into the bottom edge
    4. For each left notch: insert a CW V-shaped indentation into the left edge
    5. For each right notch: insert a CCW V-shaped indentation into the right edge
    6. Return the unified polygon (notches are naturally subtractive because they indent inward)
  - `function isPointInsidePolygon(poly, point): boolean` — ray-casting or winding number
  - `function clipLineSegment(poly, p1, p2): Point[] | null` — Sutherland–Hodgman or Cyrus–Beck clipping of a single line segment against the polygon; returns the visible sub-segment(s). For concave polygons, this may return multiple disjoint segments.

- [ ] **Add visual debugging capability**  
  Optionally render the `MetalRegion` polygon as a semi-transparent overlay in `preview-canvas.tsx` to verify correctness during development.

- [ ] **Unit-test `buildMetalRegion` and `clipLineSegment`**  
  - Unit polygon: rectangle with no notches → should be the outer rectangle
  - Single top notch → should have a V-indent at the top
  - Two overlapping top notches → should produce a merged indentation (this will expose whether the simple indentation approach handles overlap)
  - Clip horizontal line through a notch → should return two segments with a gap

### Phase 3: Replace Trimming System with Polygon Clipping

**Goal**: Delete the ad-hoc trimming logic and use `MetalRegion` clipping for all non-CUT lines.

- [ ] **Implement `clipFrezLine(region, line) → LineShape[]`**  
  A generic utility that:
  1. Calls `clipLineSegment(region, start, end)` to get the visible portion(s)
  2. Wraps each visible portion in a `LineShape` with the specified layer
  3. Handles zero-length results by returning empty array
- [ ] **Replace `addTrimmableHorizontalLine` calls** with `clipFrezLine(metalRegion, ...)`  
  Update Phase 2 of `_computeSheetMetalGeometry`:
  - Flange fold lines
  - Outer FREZ lines
  - Inner FREZ lines
- [ ] **Replace `addTrimmableVerticalLine` calls** similarly.
- [ ] **Replace `addTrimmableDiagonalLine` calls** similarly.
- [ ] **Delete `geometry/trim.ts`** — the old `isInsideMetal*`, `getHorizontalCritXs`, etc. are no longer referenced.
- [ ] **Delete console.log debug statements** (`[TRIM] Horizontal line...`, `[TRIM]   REMOVED segment...`) that were left in production code.
- [ ] **Run golden-file regression tests** on all golden models. Expect minimal line-order changes but the same set of segments (within floating-point tolerance).

### Phase 4: Handle Edge Cases & Degeneracies

**Goal**: Ensure the polygon approach is robust for the configurations that broke the old system.

- [ ] **Overlapping notches on the same edge**  
  When two notches on the same edge overlap, `buildMetalRegion` must produce a single merged indentation rather than a self-intersecting polygon. Implement a notch-merge step before polygon construction, or use a polygon-union approach for the indentations.
- [ ] **Notches that reach past the perpendicular edge (span clipping)**  
  The existing `clipHorizontalSpan` and `clipVerticalSpan` logic is still needed for CUT-layer edges. These functions should remain in `geometry/edges.ts` but can now optionally consume the `MetalRegion` polygon for a unified intersection calculation instead of the hand-written diagonal-intersection formulas.
- [ ] **Zero-offset / offset-cut duality**  
  `computeSheetMetalGeometry` runs `_computeSheetMetalGeometry` twice (zero offset + actual offset). Ensure `MetalRegion` is computed efficiently in both passes (the zero-offset region is a subset of the offset region; consider caching or parametrizing).
- [ ] **Diagonal flap lines that terminate inside a notch**  
  `clipLineSegment` on a concave polygon naturally handles this: the diagonal enters the metal, exits into the notch void, and possibly re-enters if the notch geometry allows.

### Phase 5: Hotkey ↔ Formula Integration

**Goal**: Wire the existing tanstack-hotkeys into the new formula state layer so that every hotkey action updates the formula bar and vice versa.

- [ ] **Refactor hotkey handler** to use `formula/applyHotkey()` instead of directly mutating model state  
  Each hotkey maps to a formula token:
  - `W/A/S/D` → inserts side-switch token (`W`, `A`, `S`, `D`)
  - `F` → appends `F25` (or last-used flange amount, or prompts for amount)
  - `Z` → appends `Z20` (or last-used frez amount)
  - `Q` → appends `N+` or toggles start-notch on last feature
  - `E` → appends `N-` or toggles end-notch on last feature
  - Numeric keys `0-9` → if in "amount input mode", append digits to current feature amount
- [ ] **Add "amount input mode"**  
  When `F` or `Z` is pressed, briefly enter a mode where the next typed digits update the amount. This prevents needing a modal dialog and keeps the fast workflow.
- [ ] **Sync formula bar with external edits**  
  When the user edits the model via the sidebar forms (not hotkeys), call the serializer to update the formula bar. This keeps the formula as the single source of truth.
- [ ] **Add formula history / presets**  
  Save recently used formulas to localStorage so the user can recall them (e.g., `↑`-key in the formula bar shows history dropdown).
- [ ] **Keyboard shortcut to focus formula bar**  
  E.g., `Ctrl+K` or `/` focuses the formula input for quick text entry.

### Phase 6: Validation, Test Coverage & Documentation

**Goal**: Prove correctness and prevent regression.

- [ ] **Write unit tests for each geometry module**
  - `geometry/math.ts`: cumulative offsets, flange depth calculations
  - `geometry/notches.ts`: notch evaluation at sample points, offset transformation
  - `geometry/region.ts`: point-in-polygon for convex and concave cases, line clipping against V-notch
  - `geometry/edges.ts`: CUT edge output for known configurations
  - `geometry/holes.ts`: hole placement for all 4 sides × 2 placements × 2 orientations
  - `geometry.ts` (integration): end-to-end `SheetMetalModel → GeometryResult` for the golden models
- [ ] **Write unit tests for formula system**
  - `formula/parser.ts`: valid formulas, invalid formulas, edge cases
  - `formula/serializer.ts`: canonical output, default-value omission
  - Round-trip property tests: parse(serialize(model)) ≈ model for all golden models
- [ ] **Add property-based tests** (optional, if time allows)  
  - For random `SheetMetalModel` configurations with small values, verify that all emitted CUT lines form a closed contour.
  - Verify that no FREZ line segment has both endpoints outside the metal region.
- [ ] **Update or replace `SHEET_METAL_EXPLAINED_v1.md`**  
  Document the new architecture, the `MetalRegion` abstraction, the clipping pipeline, **and the formula DSL grammar**.
- [ ] **Backend validation**  
  Run the full CNC pipeline on DXFs produced by the refactored geometry engine and compare G-code output against golden G-code. Toolpath order may vary but the geometric paths must match.

### Phase 7: Performance Polish & Cleanup

**Goal**: Ensure the refactor does not degrade preview/DXF generation performance.

- [ ] **Profile `computeSheetMetalGeometry`** on a complex model (e.g., 8 flanges per side, 10 FREZ lines, all with notches). The polygon-clipping approach should be comparable or faster than the old critical-point + midpoint-check system because it avoids O(n²) pairwise intersection computations.
- [ ] **Optimize `clipLineSegment`** if needed. Since all notches are 45°, the polygon is x-monotone and y-monotone in quadrants, which permits O(log n) edge lookups instead of O(n) full polygon iteration.
- [ ] **Profile formula parsing/serialization** on long formulas (e.g., 50 features). The parser should be O(n) or O(n log n) and complete in < 5ms.
- [ ] **Remove any dead code** identified during the refactor.
- [ ] **Final code review** focusing on:
  - No remaining magic numbers without named constants
  - Consistent error handling for degenerate inputs (zero-width flanges, negative offsets, malformed formulas)
  - Type safety — all internal functions should have explicit return types

---

## Verification Criteria

1. **Zero regression on golden models**: For every golden model, the refactored `GeometryResult.shapes` contains the same lines (within `1e-5` coordinate tolerance) as the original implementation, excluding the buggy trimming edge cases which are intentionally corrected.
2. **Trimming edge cases fixed**: For each cataloged failing configuration, the refactored engine produces FREZ/HOLES lines that do not extend into notch voids.
3. **Backend compatibility**: DXF files from the refactored engine pass `test_dxf_reader.py` and `test_geometry.py` without modification.
4. **Test coverage**: The new `geometry/` directory achieves >80% line coverage for `math.ts`, `notches.ts`, `region.ts`, and `edges.ts`.
5. **Formula round-trip stability**: For every golden model, `parse(serialize(model))` produces a model identical to the original (deep equality within epsilon).
6. **Formula completeness**: Every hotkey action has a corresponding formula token, and every `SheetMetalModel` field that affects geometry can be expressed in the formula DSL.
7. **Bundle size**: Net change in frontend bundle size is within ±10 kB gzipped (acceptable for both improved robustness and formula DSL features).

---

## Potential Risks and Mitigations

1. **Risk: Polygon merging for overlapping notches introduces complexity**
   Mitigation: Start with a simple indentation approach; if overlapping notches produce self-intersections, fall back to a 2D boolean library (Path B) specifically for the `buildMetalRegion` step, while keeping the rest of the architecture.

2. **Risk: The old trimming system had subtle epsilon-dependent behavior that downstream code implicitly relies on**
   Mitigation: Maintain the `1e-5` epsilon convention throughout the refactor. The golden-file regression tests will catch any shift in emitted coordinates.

3. **Risk: `preview-canvas.tsx` rendering order changes cause visual flicker**
   Mitigation: `preview-canvas.tsx` renders lines in `shapes` array order; keep the same emission order (CUT → FREZ → HOLES) within `_computeSheetMetalGeometry`.

4. **Risk: CNC backend expects exact layer names and colors**
   Mitigation: `dxf.ts` is untouched in this refactor; the plan explicitly preserves the `GeometryResult → dxf.ts` interface.

5. **Risk: Refactor takes longer than estimated because the monolith is deeply tangled**
   Mitigation: Phase 1 (extraction) is performed as a pure code-move with zero logic changes. If at any point a module boundary is unclear, preserve the original inline logic and add a `// TODO: refactor` comment rather than attempting a risky rewrite.

6. **Risk: Formula DSL grammar becomes bloated or ambiguous as features are added**
   Mitigation: Start with a minimal v1 grammar (only features used in the current hotkey set). Version-tag formulas (e.g., `v1:2000x2000WF25`) so future grammar expansions are backwards-compatible. Favor explicit single-character flags over multi-character keywords to keep formulas concise.

7. **Risk: Formula bar feels sluggish if serializer runs on every keystroke**
   Mitigation: Debounce formula parsing at 100ms. Only serialize when the model is changed externally (via form/hotkey), not on every internal state tick.

---

## Alternative Approaches

1. **Use `polygon-clipping` or `clipper-lib` for boolean operations**  
   Trade-off: Simplifies `buildMetalRegion` (just union rectangle minus notch polygons) but adds an external dependency. Recommended if overlapping notch merging proves difficult in custom code.

2. **Keep the old trimming but extract and unit-test it heavily**  
   Trade-off: Lowest initial effort, but does not address the fundamental architectural problem. The midpoint-sampling heuristic will always have edge cases for degenerate notch arrangements.

3. **Generate geometry as SVG paths first, then rasterize/trace to lines**  
   Trade-off: Radically different architecture; would simplify the geometry problem but complicate DXF export (`dxf.ts` would need a vectorizer). Not recommended for this iteration.

4. **Use a JSON editor instead of a compact formula**  
   Trade-off: More verbose but trivial to parse. Not recommended because the primary UX goal is fast, golfed input — the user explicitly wants `2000x2000WF25F20AF25F20S100DF100`-style compact codes.

5. **Use a Lisp-like S-expression formula**  
   Trade-off: Easier to parse and extensible, but harder for non-programmers and AI agents to write quickly. Rejected in favor of the flat token stream which matches the existing hotkey mental model.

---

## Affected Files & Modules

| File | Action | Rationale |
|------|--------|-----------|
| `alugamma/src/features/sheet-metal/geometry.ts` | **Major refactor / shrink to ~200–300 lines** | Becomes an orchestrator importing sub-modules |
| `alugamma/src/features/sheet-metal/geometry/math.ts` | **New file** | Pure math utilities |
| `alugamma/src/features/sheet-metal/geometry/notches.ts` | **New file** | Notch computation & boundary evaluation |
| `alugamma/src/features/sheet-metal/geometry/region.ts` | **New file** | `MetalRegion` polygon & line clipping |
| `alugamma/src/features/sheet-metal/geometry/edges.ts` | **New file** | CUT edge drawing (moved from monolith) |
| `alugamma/src/features/sheet-metal/geometry/holes.ts` | **New file** | Hole generation (moved from monolith) |
| `alugamma/src/features/sheet-metal/geometry/trim.ts` | **Create then delete** | Temporary extraction of old trimming logic |
| `alugamma/src/features/sheet-metal/formula/parser.ts` | **New file** | Formula string → SheetMetalModel |
| `alugamma/src/features/sheet-metal/formula/serializer.ts` | **New file** | SheetMetalModel → canonical formula string |
| `alugamma/src/features/sheet-metal/formula/state.ts` | **New file** | Bi-directional formula/model state hook |
| `alugamma/src/features/sheet-metal/formula/grammar.md` | **New file** | Formal grammar specification documentation |
| `alugamma/src/features/sheet-metal/types.ts` | **No changes** (stable contract) | Must preserve `SheetMetalModel` and `GeometryResult` |
| `alugamma/src/features/sheet-metal/dxf.ts` | **No changes** | Stable downstream consumer |
| `alugamma/src/features/sheet-metal/preview-canvas.tsx` | **Minimal changes** | Optional MetalRegion debug overlay; formula bar integration |
| `alugamma/src/routes/sheet-metal.tsx` or sibling | **Likely changes** | Inject `FormulaBar` component and wire formula state |
| `cnc-pipeline-backend/cnc_pipeline/dxf_reader.py` | **No changes** | Backend validation only |
| `cnc-pipeline-backend/tests/*.py` | **No changes** | Run as regression validation |
| `SHEET_METAL_EXPLAINED_v1.md` | **Update** | Document new architecture and formula DSL |
| `plans/useless-line-trimmer-plan.md` | **Archive / mark obsolete** | Superseded by this plan |
| `plans/useless-line-trimmer-impl-analysis.md` | **Archive / mark obsolete** | Historical reference only |

---

## Assumptions

1. The notch geometry domain remains restricted to **45° V-notches with axis-aligned shoulders** — no arbitrary-angle notches, no curved reliefs. This assumption underlies the viability of the `MetalRegion` polygon approach.
2. `SheetMetalModel` and `GeometryResult` types in `types.ts` are **frozen** during this refactor. If new fields are needed for internal computation (e.g., caching derived notch data), they will be added to internal types, not to the public API.
3. The project uses a standard Vite + TypeScript build pipeline; adding new source files under `src/features/sheet-metal/geometry/` and `src/features/sheet-metal/formula/` does not require build configuration changes.
4. The reporter can provide 2–3 specific `SheetMetalModel` JSON examples that trigger the known trimming edge cases.
5. The tanstack-hotkeys setup is in place and can dispatch to React state hooks; no changes to the hotkey library itself are needed.
6. The formula DSL v1 will cover all features currently accessible via hotkeys (flanges, frez lines, inner frez lines, reliefs, notches, spans, offsetCut). Features not yet in the hotkey set (holes, cornerReliefs, invert flags, arrow, etc.) may be deferred to DSL v1.1.
7. The user accepts that formula strings are a **new file format** for the app and may need clipboard sharing / localStorage persistence as a follow-up feature.
