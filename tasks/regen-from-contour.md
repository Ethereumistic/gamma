# NC Programs — Algorithm Regeneration Without DXF

## Goal

Allow the user to switch algorithms and regenerate the NC program directly
from a saved NC program page (`/cnc-pipeline/:programId`) with no DXF upload
required. This is achieved by persisting the pre-sort contour data at save
time and adding a lightweight `/api/regenerate` endpoint that skips DXF
parsing entirely.

---

## Architecture Overview

```
Current flow:
  DXF → [parse → simplify → sort(algo) → gcode] → geometry_data + nc_code

New flow (save):
  DXF → [parse → simplify] → contours_by_layer  ← SAVE THIS
                           → [sort(algo) → gcode] → geometry_data + nc_code  ← ALREADY SAVED

New flow (regenerate):
  contours_by_layer (from Convex) → POST /api/regenerate?algorithm=X
                                  → [sort(algo) → gcode]
                                  → geometry_data + nc_code  (new, update Convex record)
```

The contours are captured at the exact point after `simplify_contour` and
`optimize_closed_start_and_direction` have run, but before any sorting
algorithm touches them. This is the minimal sufficient input for every
algorithm in `sort_frez_outer_to_inner`.

---

## Part 1 — Python Backend

### 1.1 — Serialize Contours in `pipeline.py`

In `cnc_pipeline/pipeline.py`, inside `run_pipeline`, after the per-layer
contour extraction and simplification loop (Phase 2) and before the sorting
step (still Phase 2), collect the prepared contours into a serializable
structure.

Find the section that looks roughly like:

```python
for layer_name in active_layers:
    raw = get_contours(reader, layer_name)
    simplified = [simplify_contour(c) for c in raw]
    # ... then sorting happens below
```

After simplification, before sorting, build:

```python
contours_by_layer: dict[str, list[dict]] = {}
for layer_name, contours in prepared_contours.items():
    contours_by_layer[layer_name] = [
        {
            "points": [{"x": p.x, "y": p.y} for p in c.points],
            "is_closed": c.is_closed,
        }
        for c in contours
    ]
```

The exact variable names will depend on how the loop is structured in your
`pipeline.py`. The key requirement is: capture contours **after**
`simplify_contour` and `optimize_closed_start_and_direction`, **before**
`sort_frez_outer_to_inner` or `sort_nearest_neighbour`.

Also capture:

```python
stock_bbox_serial = {
    "min_x": stock_bbox.min_x,
    "max_x": stock_bbox.max_x,
    "min_y": stock_bbox.min_y,
    "max_y": stock_bbox.max_y,
}
```

`stock_bbox` is the bounding box of all contours combined — already computed
by the pipeline for the sorting algorithms. If it is not already a named
variable, compute it as:

```python
from .geometry import contour_bbox, BBox
all_points = [p for contours in prepared_contours.values() for c in contours for p in c.points]
stock_bbox = BBox(
    min(p.x for p in all_points),
    min(p.y for p in all_points),
    max(p.x for p in all_points),
    max(p.y for p in all_points),
)
```

### 1.2 — Return `contours_by_layer` from `run_pipeline`

Add `contours_by_layer` and `stock_bbox` to the return value of `run_pipeline`
so `main.py` can include them in the API response.

If `run_pipeline` currently returns a dataclass or dict, add:

```python
"contours_by_layer": contours_by_layer,   # dict[str, list[dict]]
"stock_bbox": stock_bbox_serial,           # dict with min_x/max_x/min_y/max_y
"scenario": detected_scenario,            # already returned, confirm it is here
```

### 1.3 — Expose in `POST /api/generate` Response

In `main.py`, the `POST /api/generate` handler already builds a JSON response.
Add the two new fields:

```python
return {
    # ... all existing fields ...
    "contours_by_layer": result["contours_by_layer"],
    "stock_bbox": result["stock_bbox"],
}
```

The frontend will receive these alongside `geometry_data` and
`line_to_segment_map`.

### 1.4 — Add `POST /api/regenerate` Endpoint

Add a new endpoint to `main.py`. This endpoint accepts the stored contour
data and a new algorithm name, runs only the sort + gcode phase, and returns
the same shape as `POST /api/generate` (so the frontend can reuse all
existing state update logic).

```python
class RegenerateRequest(BaseModel):
    contours_by_layer: dict[str, list[dict]]  # same structure as stored
    stock_bbox: dict                           # {min_x, max_x, min_y, max_y}
    scenario: str                              # e.g. "most_common"
    algorithm: str                             # e.g. "juggler_claude"

@app.post("/api/regenerate")
async def regenerate(req: RegenerateRequest):
    from cnc_pipeline.models import Point, Contour, BBox
    from cnc_pipeline.geometry import sort_frez_outer_to_inner, sort_nearest_neighbour
    from cnc_pipeline.pipeline import run_from_contours  # see 1.5

    result = run_from_contours(
        contours_by_layer=req.contours_by_layer,
        stock_bbox=req.stock_bbox,
        scenario=req.scenario,
        algorithm=req.algorithm,
    )

    job_id = str(uuid.uuid4())
    job_store[job_id] = result["nc_text"]

    return {
        "job_id": job_id,
        "scenario": req.scenario,
        "algorithm": req.algorithm,
        "geometry_data": result["geometry_data"],
        "line_to_segment_map": result["line_to_segment_map"],
        "estimated_time": result["estimated_time"],
        "contours_by_layer": req.contours_by_layer,  # pass through unchanged
        "stock_bbox": req.stock_bbox,                 # pass through unchanged
    }
```

### 1.5 — Add `run_from_contours` in `pipeline.py`

Extract the sort + gcode phases of `run_pipeline` into a reusable function.
Do not duplicate code — have `run_pipeline` call `run_from_contours` for
its own sort+gcode phase as well.

```python
def run_from_contours(
    contours_by_layer: dict[str, list[dict]],
    stock_bbox: dict,
    scenario: str,
    algorithm: str,
) -> dict:
    """
    Phase 3+4 only. Deserializes contours, runs sorting and gcode writing.
    Returns the same keys as run_pipeline's sort+gcode output.
    """
    from .models import Point, Contour, BBox

    bbox = BBox(
        stock_bbox["min_x"], stock_bbox["min_y"],
        stock_bbox["max_x"], stock_bbox["max_y"],
    )

    # Deserialize
    prepared: dict[str, list[Contour]] = {}
    for layer, raw_contours in contours_by_layer.items():
        prepared[layer] = [
            Contour(
                points=[Point(p["x"], p["y"]) for p in rc["points"]],
                is_closed=rc["is_closed"],
            )
            for rc in raw_contours
        ]

    # Sort — same logic as run_pipeline's sort phase
    sorted_contours: dict[str, list[Contour]] = {}
    config = Config.for_scenario(scenario)  # however Config is accessed in your pipeline

    for layer_name, contours in prepared.items():
        if layer_name == "FREZ" or layer_name == "FREZ_135":
            sorted_contours[layer_name] = sort_frez_outer_to_inner(
                contours, bbox, algorithm=algorithm
            )
        else:
            sorted_contours[layer_name] = sort_nearest_neighbour(contours)

    # Gcode writing — same as run_pipeline's gcode phase
    # ... generate_toolpath, GCodeWriter, validate, stats ...
    # Return same dict shape as run_pipeline's sort+gcode output
```

The exact internals here depend on how `run_pipeline` is structured. The
agent should extract rather than duplicate — pull the sort+gcode block out of
`run_pipeline` into `run_from_contours`, then call
`run_from_contours` from `run_pipeline` at the same point in the flow.

---

## Part 2 — Frontend Types

File: `src/features/cnc-pipeline/types.ts`

Add the new fields to `GenerateResponse` (the type for the `POST /api/generate`
response):

```typescript
export interface ContoursPoint {
  x: number
  y: number
}

export interface StoredContour {
  points: ContoursPoint[]
  is_closed: boolean
}

export interface StockBbox {
  min_x: number
  max_x: number
  min_y: number
  max_y: number
}

// Add to GenerateResponse:
export interface GenerateResponse {
  // ... all existing fields ...
  contours_by_layer: Record<string, StoredContour[]>
  stock_bbox: StockBbox
}
```

---

## Part 3 — Frontend API Layer

File: `src/features/cnc-pipeline/api.ts`

Add a `regenerate` function alongside the existing `generate`:

```typescript
export interface RegeneratePayload {
  contours_by_layer: Record<string, StoredContour[]>
  stock_bbox: StockBbox
  scenario: string
  algorithm: string
}

export async function regenerate(payload: RegeneratePayload): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Regenerate failed: ${res.status}`)
  return res.json()
}
```

---

## Part 4 — Convex Schema

File: `convex/schema.ts`

Add two fields to `nc_programs`. These join the `geometryData` and
`lineToSegmentMap` fields added in the previous plan:

```typescript
nc_programs: defineTable({
  // ... all existing fields ...
  geometryData: v.object({ ... }),      // already added
  lineToSegmentMap: v.any(),            // already added

  // ADD THESE:
  contoursByLayer: v.any(),
  // Stored as Record<string, Array<{points: {x,y}[], is_closed: boolean}>>
  // v.any() used for the same reason as lineToSegmentMap — nested generic
  // structure that does not benefit from verbose validator spelling.

  stockBbox: v.object({
    min_x: v.number(),
    max_x: v.number(),
    min_y: v.number(),
    max_y: v.number(),
  }),
})
```

---

## Part 5 — Convex `saveNcProgram` Mutation

File: `convex/nc_programs.ts`

Add the two new fields to the mutation validator and to both the insert and
patch payloads. No other logic changes:

```typescript
// In validator args:
contoursByLayer: v.any(),
stockBbox: v.object({
  min_x: v.number(),
  max_x: v.number(),
  min_y: v.number(),
  max_y: v.number(),
}),

// In ctx.db.insert and ctx.db.patch:
contoursByLayer: args.contoursByLayer,
stockBbox: args.stockBbox,
```

---

## Part 6 — Save Payload in `CNCPipelinePage.tsx`

Where the Save button calls `saveNcProgram`, add the two new fields. They are
already in the generate response state:

```typescript
await saveNcProgram({
  // ... all existing fields ...
  contoursByLayer: generateResult.contours_by_layer,
  stockBbox: generateResult.stock_bbox,
})
```

---

## Part 7 — Regenerate UI on the Saved Program Page

File: `CNCProgramViewerPage.tsx`

### 7.1 — State

```typescript
const [isRegenerating, setIsRegenerating] = useState(false)
const [currentGeometry, setCurrentGeometry] = useState<GeometryResponse | null>(null)
const [currentNcLines, setCurrentNcLines] = useState<string[]>([])
const [currentLineToSegmentMap, setCurrentLineToSegmentMap] = useState<Record<number, number>>({})
const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>("")
```

On mount (once `program` loads), initialize all current* state from the stored
record and `selectedAlgorithm` from `program.algorithm`.

### 7.2 — Regenerate Handler

```typescript
async function handleRegenerate(newAlgorithm: string) {
  if (!program?.contoursByLayer || !program?.stockBbox) return
  if (newAlgorithm === selectedAlgorithm) return  // no-op if same algo

  setIsRegenerating(true)
  resetPlayback()  // always reset to position 0

  try {
    const result = await regenerate({
      contours_by_layer: program.contoursByLayer,
      stock_bbox: program.stockBbox,
      scenario: program.scenario,
      algorithm: newAlgorithm,
    })

    // Update local view state
    setCurrentGeometry(result.geometry_data)
    setCurrentNcLines(result.nc_text.split("\n"))
    setCurrentLineToSegmentMap(
      Object.fromEntries(
        Object.entries(result.line_to_segment_map).map(([k, v]) => [Number(k), v])
      )
    )
    setSelectedAlgorithm(newAlgorithm)

  } catch (err) {
    toast.error("Regeneration failed", { description: String(err) })
  } finally {
    setIsRegenerating(false)
  }
}
```

Note: regeneration **does not auto-save**. The user sees the new NC and
geometry immediately, but the Convex record is only updated if they explicitly
click Save again. This is intentional — they may be comparing algorithms
before committing.

### 7.3 — Algorithm Selector in Page Header

Add the algorithm dropdown to the saved program page header (same
`FREZ_ALGORITHMS` map used on the `/new` page):

```tsx
<Select
  value={selectedAlgorithm}
  onValueChange={handleRegenerate}
  disabled={isRegenerating}
>
  <SelectTrigger className="w-[200px]">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {Object.entries(FREZ_ALGORITHMS).map(([key, label]) => (
      <SelectItem key={key} value={key}>{label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

Selecting a new algorithm immediately triggers `handleRegenerate`. The
dropdown is disabled while regeneration is in flight.

### 7.4 — Loading Overlay

While `isRegenerating` is true, show a semi-transparent overlay on the
`GeometryViewer` and `NCPreview` panels — same overlay pattern used on
`/cnc-pipeline/new` during initial generation.

### 7.5 — Save After Regenerate

The existing Save button on this page should, after regeneration, save the
updated `geometryData`, `lineToSegmentMap`, `ncCode`, and `algorithm` back
to Convex. The `contoursByLayer` and `stockBbox` do not change on
regeneration — pass through the original values from `program`.

```typescript
await saveNcProgram({
  // identity fields unchanged:
  projectId: program.projectId,
  organizationId: program.organizationId,
  dxfSourceName: program.dxfSourceName,
  scenario: program.scenario,
  contoursByLayer: program.contoursByLayer,  // unchanged
  stockBbox: program.stockBbox,              // unchanged

  // updated fields:
  algorithm: selectedAlgorithm,
  ncCode: currentNcLines.join("\n"),
  geometryData: currentGeometry,
  lineToSegmentMap: currentLineToSegmentMap,
  estimatedTimeSeconds: latestEstimatedTime,  // from regenerate response
  name: rebuildName(program.dxfSourceName, selectedAlgorithm, ...),
})
```

---

## Part 8 — Remove the "Drop DXF to Regenerate" Warning

File: wherever the current regeneration warning/drop zone is rendered on the
saved program page.

Now that contour-based regeneration is available, the warning that says
*"requires the original DXF vectors — drop the file below"* should be removed
entirely. Replace it with the algorithm selector from Part 7.3.

The backwards-compatibility guard from the geometry persistence plan still
applies: if `program.contoursByLayer` is `undefined` (record saved before
this feature), show a gentler message:

```tsx
{!program.contoursByLayer && (
  <p className="text-xs text-muted-foreground">
    Algorithm switching is available for programs saved after [date].
    Re-save this program to enable it.
  </p>
)}
```

Do not show a DXF drop zone — that flow belongs on `/cnc-pipeline/new` only.

---

## Summary of Files to Touch

| File | Change |
|---|---|
| `cnc_pipeline/pipeline.py` | Capture `contours_by_layer` + `stock_bbox` after simplify; extract `run_from_contours`; return new fields |
| `main.py` | Add new fields to `POST /api/generate` response; add `POST /api/regenerate` endpoint |
| `src/features/cnc-pipeline/types.ts` | Add `StoredContour`, `StockBbox`, new fields to `GenerateResponse` |
| `src/features/cnc-pipeline/api.ts` | Add `regenerate()` function |
| `convex/schema.ts` | Add `contoursByLayer` + `stockBbox` to `nc_programs` |
| `convex/nc_programs.ts` | Add both fields to `saveNcProgram` validator + insert/patch |
| `CNCPipelinePage.tsx` | Pass new fields in save payload |
| `CNCProgramViewerPage.tsx` | Add `handleRegenerate`, algorithm selector, loading overlay, remove DXF warning |

No changes needed to: `GeometryViewer.tsx`, `usePlayback.ts`, `NCPreview.tsx`,
`PlaybackControls.tsx`, `geometry.py`, or any sorting algorithm files.