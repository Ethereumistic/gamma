# Sheet-Metal Geometry Engine Refactor & Robust Trimming Resolution

## Objective

Replace the ad-hoc, edge-case-prone "useless-line trimming" system with a **unified polygon-based metal-region representation** that clips FREZ/HOLES lines against the actual valid metal area. Simultaneously refactor the 1,524-line `geometry.ts` monolith into a modular, tested architecture that is simpler to reason about, easier to maintain, and robust against all notch configurations.

**Additionally**, implement a **bi-directional Sheet-Metal Formula DSL** — a compact textual notation (e.g. `500x500 WF60 Q20 AF120 SF120 Q20H DF20E20`) that:
1. Uses **spaces** for visual/logical separation of tokens
2. Can be fully typed into the formula bar (repurposed preset dropdown) to instantly generate a `SheetMetalModel` and its geometry/DXF
3. Is synchronized with hotkeys (F, Z, Q, E, WASD) so every action appends the corresponding token to the formula
4. Supports hole shorthand (`HS28E28L19O` / `HS28E28L19OR`) attached to flanges/FREZ lines
5. Provides a canonical human-readable and AI-parseable representation of any sheet-metal part

---

## Current State Analysis

### What's Working Well
- **Geometric correctness**: All CUT-layer outlines, V-notch edge contours, offset-cut dual-pass logic, and hole generation produce the correct DXF output for the vast majority of configurations.
- **Backend compatibility**: The Python CNC pipeline consumes the DXF without issues as long as layer semantics (`CUT`, `FREZ`, `0`, `HOLES`) are preserved.
- **Hotkeys are functional**: tanstack-hotkeys for F (outer flange), Z (inner bend line), Q/E (V-notch toggles), WASD (side selector: W=Top, A=Left, S=Bottom, D=Right).

### What's Broken / Fragile
- **Useless-line trimming (lines 453–863)**: A hand-written BSP-like midpoint-segmentation system with `isInsideMetalHorizontal`, `isInsideMetalVertical`, `getHorizontalCritXs`, `getVerticalCritYs`, and three `addTrimmable*` variants. This system:
  - Has known edge cases where FREZ lines are not trimmed correctly (adjacent overlapping notches, diagonal lines crossing multiple notch boundaries, near-zero shoulder offsets)
  - Uses duplicated logic for horizontal/vertical/diagonal cases
  - Has console.log debug statements (`[TRIM] REMOVED segment`) left in production
  - Is extremely difficult to unit-test because embedded inside the monolithic `_computeSheetMetalGeometry`
- **No formula serializer**: Despite hotkeys building complex models, there is no way to capture a model as a concise code string, paste it, share it, or let AI agents reason about it symbolically.
- **No dedicated 2D geometry dependency**: We are implementing polygon intersection and line clipping manually when lightweight, battle-tested libraries exist for this exact domain.

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

## Strategic Decision: Geometry Approach

### The Right Choice: Custom `MetalRegion` Polygon + Lightweight Line Clipping

For this specific domain (axis-aligned rectangle with 45° V-notch cutouts), the geometry is **trivial for a custom implementation** and overkill for a heavy library. A concave polygon with diagonal edges is straightforward to construct and clip against.

**Why not a heavy 2D boolean library (Clipper2, paper.js, etc.)?**
- Adds 50–500 KB to the bundle for a problem that is essentially "rectangle minus V-shaped triangles"
- Introduces C++ WASM dependencies or complex纯 JS algorithms that are harder to debug than 100 lines of custom clipping
- The notch geometry is **restricted**: 45° diagonals, axis-aligned shoulders. No arbitrary angles, no curves, no self-intersecting paths

**What we will use:**
- A **custom `MetalRegion` polygon** built by indenting the outer rectangle with notch V-shapes
- A **custom `clipLineSegment` against that polygon** using the Liang–Barsky algorithm adapted for concave polygons, or a simple scanline approach that walks the polygon edges
- If we ever need robust boolean ops, `flatten-js` (~20 KB,纯 JS) is the fallback — it has polygon boolean, point-in-polygon, and line intersection out of the box

**Why this is the right choice:**
- It collapses the 4 duplicated trimming systems into **one** operation: `clipLine(poly, segment) → segments[]`
- It is deterministic and eliminates the midpoint-sampling heuristic that causes edge cases
- It keeps dependencies minimal (zero new deps for the core; optional `flatten-js` as fallback)
- It is simple enough that a junior dev can understand and debug it in an afternoon

### Architecture Principle: Obey Simplicity

> *"Creating such sheet metal ACM panel models is simple geometry. We are not trying to reinvent the wheel."*

Every decision in this plan is filtered through:
1. **Is this simpler than what we have?** If not, reject it.
2. **Can we unit-test this in isolation?** If not, split it.
3. **Do we need a library?** Only if the custom alternative is >200 lines or mathematically error-prone.

---

## Strategic Decision: Formula DSL Design

### Design Goals
1. **Bi-directional**: `formula ⇄ SheetMetalModel` — formula bar builds the model; hotkeys and form edits update the formula bar
2. **Space-separated**: Tokens are visually separated by spaces for readability
3. **Human-legible**: `500x500 WF60 Q20 AF120` should be readable by a CNC operator
4. **AI-parseable**: LLMs/agents can read and write formulas without knowing the JSON schema
5. **Hotkey-native**: Every hotkey action maps to a single token appended to the formula
6. **Holes are first-class**: Hole config is attached to the feature it belongs to via inline suffixes

### Formula Grammar v1

```
formula := base side-features*
base    := <width>x<height>
side-features := side-switch feature*
side-switch   := W | A | S | D           (Top, Left, Bottom, Right)
feature := flange | outer-frez | inner-frez | frez-mode | offset | hole-suffix
```

**Concrete tokens (space-separated):**

| Token | Syntax | Meaning |
|-------|--------|---------|
| Base | `500x500` or `1200x800` | Width × Height |
| Side switch | `W` `A` `S` `D` | Activate Top / Left / Bottom / Right side |
| Flange | `F<amount>` | Add flange with amount. `F60` = 60mm flange |
| Flange relief | `Q` or `E` | Toggle start (Q) or end (E) relief on the **last** flange. `WF60 Q E` = top 60mm flange with both reliefs |
| Flange flap | `V<amount>` | Add flap to last flange. `WF60 V5` = flange with 5mm flap |
| Outer FREZ | `Z<amount>` | Add outer FREZ line. `Z20` = 20mm outer frez |
| FREZ notch | `Q` or `E` | Toggle start (Q) or end (E) notch on the **last** FREZ line |
| FREZ span | `S` or `D` | Toggle span-start (S=Shift?) or span-end (D?) on last inner FREZ. *Clarification needed — see Assumptions* |
| Inner FREZ | `I<amount>` | Add inner FREZ line. `I20` = 20mm inner frez |
| FREZ mode | `M<inner\|outer>` | Set frez mode for current side. `Minner` or `Mouter` |
| Offset | `O<amount>` | Set offsetCut. `O3` = 3mm offset |
| All-sides prefix | `A` before feature | Apply next feature to all 4 sides. `AF25` = 25mm flange on all sides |
| Holes (suffix) | `H<attr><val>...` | Attach to last feature. `HS28E28L19O` = sideOffset 28, endOffset 28, length 19, placement outer |
| Holes side | `L` / `R` / nothing | At end of hole suffix: `L`=line1 only, `R`=line2 only, nothing=both |

**Hole attribute map:**
- `S<number>` → `sideOffset` (mm)
- `E<number>` → `endOffset` (mm)
- `L<number>` → `length` (mm)
- `I` → placement `inner`
- `O` → placement `outer`
- `H` → orientation `horizontal` ( implicit default )
- `V` → orientation `vertical`
- `L` at end → `line1Enabled`
- `R` at end → `line2Enabled`

**Example formulas:**

| Formula | Meaning |
|---------|---------|
| `500x500 WF60 Q20 AF120 SF120 Q20H DF20E20` | 500×500 base. Top: 60mm flange (Q relief=start, E=end?), 20mm? Wait, let me re-parse: `WF60 Q20` — Q is relief toggle, 20 is not attached. The user's example had `500x500 WF60 Q20 AF120 SF120 Q20H DF20E20` — this needs clearer parsing rules. |

**Canonical parsing rules:**
- Tokens are strictly space-separated. No spaces inside a token.
- A token is either a single letter (side switch, relief toggle, span toggle) or a letter+number (dimension, feature amount, offset).
- `Q` and `E` are **toggle actions** on the most recently added feature on the current side. They do not take arguments.
- Numbers are always positive integers (mm). Decimals are permitted but rounded/truncated.
- Holes are a single token `H...` attached to the last feature. No spaces inside the H token.
- If a token is unparseable, the parser stops at that token, returns `lastValidModel`, and highlights the error token.

### Repurposing the Preset Dropdown

The existing **"Select Preset" dropdown** in the sheet-metal navbar becomes the **Formula Bar**.

Changes:
- **Visual**: Replace dropdown with a text `<input>` that shows the current formula
- **Behavior**: Typing in the input parses in real time (debounced 100ms) and updates the model
- **Dropdown preserved**: Clicking a chevron icon next to the input opens the **preset list** (existing JSON presets + recent formulas from localStorage)
- **Placeholder**: Shows a short example like `500x500 WF25 Q E`
- **Copy button**: One-click copies the formula to clipboard
- **Filename prefix**: Optional `(filename_x2)` prefix for batch orders. Stripped during parsing, stored separately.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  FORMULA BAR (repurposed preset dropdown)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ (filename_x2) 500x500 WF60 Q20 AF120 SF120 Q20H ... │ │
│  └────────────────────────────────────────────────────────┘ │
│  [▼ presets] [📋 copy]                                       │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  FORMULA STATE (React hook)                                  │
│  rawFormula: string                                           │
│  parsedModel: SheetMetalModel | null                          │
│  lastValidModel: SheetMetalModel                            │
│  parseErrors: { token, message }[]                            │
└──────────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
┌────────────────────┐         ┌────────────────────────────┐
│  HOTKEY HANDLER    │         │  SIDEBAR FORMS (existing)  │
│  (tanstack-hotkeys)│         │                              │
│  F → append " F25" │         │  On model change → call     │
│  Z → append " Z20" │         │  serializer(rawFormula,     │
│  W→" W" A→" A" etc │         │  newModel) → update bar     │
└────────────────────┘         └────────────────────────────┘
                                          │
                                          ▼
                           ┌──────────────────────────┐
                           │  computeSheetMetalGeometry│
                           │  GeometryResult → DXF    │
                           └──────────────────────────┘
```

**State flow:**
1. **User types formula** → parser runs → `parsedModel` → geometry recomputes
2. **User presses hotkey** → token appended to formula → parser runs → same flow
3. **User edits sidebar form** → `lastValidModel` updated → serializer produces new formula → formula bar updates

---

## Implementation Plan

### Phase -1: Formula DSL Foundation

**Goal**: Build the formula parser, serializer, state layer, and UI input.

- [ ] **Create `formula/grammar.ts`**  
  Single source of truth for token definitions:
  ```typescript
  const TOKENS = {
    BASE: /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/,
    SIDE_SWITCH: /^[WASD]$/,
    FLANGE: /^F(\d+(?:\.\d+)?)$/,
    OUTER_FREZ: /^Z(\d+(?:\.\d+)?)$/,
    INNER_FREZ: /^I(\d+(?:\.\d+)?)$/,
    FREZ_MODE: /^M(inner|outer)$/,
    OFFSET: /^O(\d+(?:\.\d+)?)$/,
    RELIEF_TOGGLE: /^[QE]$/,           // toggles start/end on last feature
    HOLES: /^H([S\d]+[E\d]+[L\d]+[IO]?[HV]?[LR]?)$/,
    ALL_SIDES: /^A$/,
  } as const;
  ```
- [ ] **Create `formula/parser.ts`**  
  - Input: `string` → Output: `{ model: SheetMetalModel; errors: ParseError[] }`
  - Tokenizer: split on spaces, then regex-match each token against `grammar.ts`
  - State machine: `activeSide`, `lastFeatureRef` (pointer to last flange/frez on active side)
  - `Q`/`E` tokens mutate `reliefs`/`notches` on `lastFeatureRef`
  - `H...` token mutates `holes` on `lastFeatureRef`
  - Graceful degradation: on first error, return `lastValidModel` + errors up to that token
- [ ] **Create `formula/serializer.ts`**  
  - Input: `SheetMetalModel` → Output: `string`
  - Rules:
    1. Start with `WxH`
    2. For each side in TRBL order:
       - Emit side switch (`W`/`A`/`S`/`D`) if side has features
       - Emit flanges first (outermost to innermost), then outer frez lines, then inner frez lines
       - Emit `Q`/`E` tokens after each feature that has them enabled
       - Emit `H<...>` token after each feature that has holes
    3. Emit `Minner`/`Mouter` if non-default
    4. Emit `O<amount>` if non-default
    5. Collapse identical all-side patterns into `A`-prefixed tokens where possible
- [ ] **Create `formula/state.ts`** (React hook)  
  ```typescript
  interface FormulaState {
    formula: string;
    model: SheetMetalModel;
    errors: ParseError[];
    setFormula: (f: string) => void;
    applyToken: (token: string) => void;  // used by hotkeys
    setModel: (m: SheetMetalModel) => void; // used by sidebar forms
  }
  ```
  - `setFormula` → debounced parse at 100ms
  - `applyToken` → immediate append + parse (for hotkey responsiveness)
  - `setModel` → immediate serialize + update formula
  - `lastValidModel` preserved so incomplete formulas don't blank the canvas
- [ ] **Write unit tests for parser/serializer round-trip**  
  - 5 golden models must survive `parse(serialize(model)) === model`
  - Every token type must have at least one parse test and one serialize test
- [ ] **Write unit tests for partial/incomplete formulas**  
  - `500x500` → valid model, empty sides
  - `500x500 W` → valid, top selected, no features
  - `500x500 WF` → error: "F requires a number" at token 3
  - `500x500 WFabc` → error: "invalid amount 'abc'" at token 3
  - `500x500 WF60 Q Q` → error: "Q toggles relief but no feature exists" at second Q

### Phase 0: Pre-Flight Safety & Baseline (Geometry)

**Goal**: Lock in regression safety before touching geometry logic.

- [ ] **Audit the trimming edge cases**: Catalog every failing configuration. Collect:
  - Exact `SheetMetalModel` JSON that triggers failure
  - Screenshot of current vs expected
  - Whether failure is horizontal, vertical, or diagonal trimming
- [ ] **Establish golden-file regression tests**: For 5 representative models, compute current `GeometryResult`, commit as `geometry.golden.json`
- [ ] **Verify backend compatibility**: Run `test_geometry.py` and `test_dxf_reader.py` against DXFs from golden models
- [ ] **Seed formula grammar with golden models**: Each golden model gets a canonical formula string for parser/serializer test suite

### Phase 1: Modularize `geometry.ts` — Extraction Without Logic Change

**Goal**: Split the monolith into coherent modules. **Zero behavioral changes.**

- [ ] **Create `geometry/math.ts`**  
  Extract pure math: `EPS`, `clamp`, `isNearlyEqual`, `sumMeasurements`, `getCumulativeOffsets`, `getFlangeDepths`, `getFrezOffsets`, `getResolvedFrezPositions`, `getCornerShoulderOffset`, `collectWarnings`
- [ ] **Create `geometry/notches.ts`**  
  Extract: `HorizontalNotch`, `VerticalNotch`, `evaluateTopBoundaryY`, `evaluateBottomBoundaryY`, `evaluateLeftBoundaryX`, `evaluateRightBoundaryX`, `computeNotches`, `offsetNotches`
- [ ] **Create `geometry/edges.ts`**  
  Extract: `addHorizontalCutEdge`, `addVerticalCutEdge`, `clipHorizontalSpan`, `clipVerticalSpan`
- [ ] **Create `geometry/holes.ts`**  
  Extract: `addHoleLines`, `processHoles`
- [ ] **Create `geometry/trim.ts`** (temporary)  
  Extract old trimming verbatim: `isInsideMetal*`, `getHorizontalCritXs`, `getVerticalCritYs`, `addTrimmableHorizontalLine`, `addTrimmableVerticalLine`, `addTrimmableDiagonalLine`
- [ ] **Rewrite `geometry.ts`** as a thin orchestrator (~200–300 lines)  
  Keep only: `_computeSheetMetalGeometry`, `computeSheetMetalGeometry`, public exports
- [ ] **Run golden-file tests after every extraction**

### Phase 2: Introduce `MetalRegion` Polygon Abstraction

**Goal**: Replace implicit region with explicit polygon.

- [ ] **Create `geometry/region.ts`**  
  ```typescript
  type Point = { x: number; y: number };
  type Polygon = Point[]; // closed CCW
  
  function buildMetalRegion(model: SheetMetalModel, notches: NotchArrays): Polygon;
  function isPointInside(poly: Polygon, p: Point): boolean;
  function clipLine(poly: Polygon, p1: Point, p2: Point): Array<{p1: Point; p2: Point}> | null;
  ```
  - `buildMetalRegion`: start with outer rect, then for each top/bottom/left/right notch, indent the corresponding edge with a V-shape
  - `clipLine`: Liang–Barsky adapted for concave polygons, or simple scanline edge intersection
  - Handle overlapping same-edge notches by pre-merging their V-indents (take the deeper/more inward boundary)
- [ ] **Add visual debugging in preview-canvas.tsx** (optional overlay, dev-only)
- [ ] **Unit-test `buildMetalRegion` and `clipLine`**  
  - No notches → outer rect
  - Single top notch → V-indent
  - Two overlapping top notches → merged indent
  - Horizontal line through notch → two segments with gap
  - Diagonal line → correct partial segments

### Phase 3: Replace Trimming System with Polygon Clipping

**Goal**: Delete ad-hoc trimming, use `MetalRegion` clipping.

- [ ] **Implement `clipFrezLine(region, line, layer) → LineShape[]`**  
  A thin wrapper that calls `clipLine(region, start, end)` and maps results to `LineShape`
- [ ] **Replace all `addTrimmable*` calls** with `clipFrezLine(...)`:
  - Flange fold lines (horizontal + vertical)
  - Outer FREZ lines
  - Inner FREZ lines
  - Flap diagonals
- [ ] **Delete `geometry/trim.ts`**
- [ ] **Delete console.log debug statements** (`[TRIM] ...`)
- [ ] **Run golden-file regression tests**

### Phase 4: Handle Edge Cases & Degeneracies

- [ ] **Overlapping notches on same edge**: Merge indentations in `buildMetalRegion` to prevent self-intersections
- [ ] **Span clipping for CUT edges**: Keep `clipHorizontalSpan`/`clipVerticalSpan` in `edges.ts` but refactor to optionally use `MetalRegion` for unified intersection instead of hand-written diagonal formulas
- [ ] **Zero-offset dual-pass**: Ensure `MetalRegion` is computed correctly in both passes. Cache or parameterize.

### Phase 5: Hotkey ↔ Formula Integration

- [ ] **Refactor hotkey handler** to call `formula/applyToken(token)`:
  - `F` → `" F25"` (or last-used flange amount)
  - `Z` → `" Z20"` (or last-used frez amount)
  - `I` → `" I20"` (inner frez)
  - `W`/`A`/`S`/`D` → `" W"`, `" A"`, etc.
  - `Q` → `" Q"` (toggle start relief/notch)
  - `E` → `" E"`
  - `M` prompt → `" M..."` toggle
  - `O` prompt → `" O..."`
- [ ] **Add "amount input mode"**: After `F`/`Z`/`I`, next typed digits update the amount inline in the formula
- [ ] **Sync sidebar forms → formula**: On any form change, serializer rebuilds formula, input updates
- [ ] **Persist recent formulas** to localStorage for recall via preset dropdown
- [ ] **Keyboard shortcut `Ctrl+K`** to focus formula bar

### Phase 6: Validation, Tests & Docs

- [ ] **Unit tests for all geometry modules** (target >80% coverage for `math.ts`, `notches.ts`, `region.ts`, `edges.ts`)
- [ ] **Unit tests for all formula modules** (parser, serializer, state hook)
- [ ] **Round-trip property tests**: `parse(serialize(model)) ≈ model` for all golden models
- [ ] **Backend validation**: DXFs pass `test_dxf_reader.py` and `test_geometry.py`
- [ ] **Update `SHEET_METAL_EXPLAINED_v1.md`** with:
  - New modular architecture
  - `MetalRegion` abstraction
  - Formula DSL grammar and examples
  - Migration notes for old presets

### Phase 7: Performance Polish & Cleanup

- [ ] **Profile `computeSheetMetalGeometry`** on a complex model. Expect polygon clipping to be faster than O(n²) pairwise intersection
- [ ] **Optimize `clipLine`** if needed: since notches are 45°, polygon is monotone, allowing O(log n) edge lookups
- [ ] **Profile formula parsing**: long formulas (50+ tokens) should parse in < 5ms
- [ ] **Remove dead code**, eliminate magic numbers, enforce explicit return types
- [ ] **Final code review**

---

## Verification Criteria

1. **Zero regression on golden models**: Refactored `GeometryResult.shapes` matches original within `1e-5` tolerance, except intentionally fixed trimming edge cases
2. **Trimming edge cases fixed**: All cataloged failing configs produce correct FREZ/HOLES lines
3. **Backend compatibility**: DXFs pass `test_dxf_reader.py` and `test_geometry.py` without changes
4. **Test coverage**: >80% line coverage on `geometry/{math,notches,region,edges}.ts`
5. **Formula round-trip**: `parse(serialize(model))` deep-equals original model for all golden models
6. **Formula completeness**: Every hotkey action has a formula token; every geometry-relevant `SheetMetalModel` field is expressible
7. **Bundle size**: Net change within ±10 kB gzipped

---

## Risks & Mitigations

1. **Polygon merging for overlapping notches**  
   Mitigation: Pre-merge same-edge notches by taking max-indent boundary. If complexity explodes, use `flatten-js` (20KB纯 JS) for polygon boolean ops.

2. **Epsilon-dependent coordinate drift**  
   Mitigation: Keep `1e-5` convention. Golden-file tests catch drift.

3. **Preview-canvas flicker**  
   Mitigation: Preserve emission order (CUT → FREZ → HOLES).

4. **Formula bar sluggishness**  
   Mitigation: Debounce parsing at 100ms. Serialize only on external model changes, not internal ticks.

5. **Refactor takes too long**  
   Mitigation: Phase 1 is pure code-move with zero logic changes. If stuck, preserve inline logic with `// TODO`.

6. **Grammar ambiguity with H suffix**  
   Mitigation: Strict tokenization rules: H token is a single contiguous string with no spaces. `L`/`R` only valid at end of H token.

---

## Affected Files

| File | Action |
|------|--------|
| `alugamma/src/features/sheet-metal/geometry.ts` | Shrink to ~200–300 line orchestrator |
| `alugamma/src/features/sheet-metal/geometry/math.ts` | **New** — Pure math |
| `alugamma/src/features/sheet-metal/geometry/notches.ts` | **New** — Notch computation |
| `alugamma/src/features/sheet-metal/geometry/region.ts` | **New** — `MetalRegion` polygon |
| `alugamma/src/features/sheet-metal/geometry/edges.ts` | **New** — CUT edge drawing |
| `alugamma/src/features/sheet-metal/geometry/holes.ts` | **New** — Hole generation |
| `alugamma/src/features/sheet-metal/geometry/trim.ts` | Create in Phase 1, delete in Phase 3 |
| `alugamma/src/features/sheet-metal/formula/grammar.ts` | **New** — Token definitions |
| `alugamma/src/features/sheet-metal/formula/parser.ts` | **New** — String → model |
| `alugamma/src/features/sheet-metal/formula/serializer.ts` | **New** — Model → string |
| `alugamma/src/features/sheet-metal/formula/state.ts` | **New** — Bi-directional hook |
| `alugamma/src/features/sheet-metal/types.ts` | **Frozen** — No changes |
| `alugamma/src/features/sheet-metal/dxf.ts` | **No changes** |
| `alugamma/src/features/sheet-metal/preview-canvas.tsx` | Optional debug overlay |
| `alugamma/src/routes/sheet-metal.tsx` | Inject FormulaBar; repurpose preset dropdown |
| `SHEET_METAL_EXPLAINED_v1.md` | Update with new architecture |
| `plans/useless-line-trimmer-*.md` | Archive |

---

## Assumptions

1. Notch geometry is restricted to **45° V-notches with axis-aligned shoulders** — no arbitrary angles or curves
2. `SheetMetalModel` and `GeometryResult` types in `types.ts` are **frozen**
3. Build pipeline is standard Vite + TypeScript; new files under `src/features/sheet-metal/{geometry,formula}/` require no config changes
4. The existing preset dropdown is located in the sheet-metal navbar/route and can be replaced by a text input + dropdown hybrid
5. Reporter can provide 2–3 `SheetMetalModel` JSONs that trigger known trimming failures
6. `flatten-js` is acceptable as an optional dependency if custom polygon boolean proves insufficient
7. Hotkey actions are dispatched through tanstack-hotkeys and can be refactored to call `formula/applyToken` instead of direct model mutation — the plan explicitly calls this out as Phase 5 work
8. Formula grammar v1 covers all hotkey-accessible features; cornerReliefs, invert flags, arrow, rubberband, etc. may be deferred to v1.1
9. Holes syntax `HS28E28L19O`: `S` = sideOffset, `E` = endOffset, `L` = length, `I/O` = placement inner/outer, `H/V` = orientation horizontal/vertical, trailing `L/R` = line1/line2 only. If trailing `L`/`R` absent, both lines are enabled.
10. `Q` toggles **start** relief/notch on last feature; `E` toggles **end** relief/notch on last feature. These are stateful toggle tokens, not attribute-setters.
11. Side switch tokens (`W`/`A`/`S`/`D`) mean: **all subsequent features apply to this side until another side switch**. This is the canonical parsing mode.
12. The optional filename prefix `(filename_x2)` is stripped during parse, stored separately, and re-prepended by serializer. It does not affect geometry.
