# CNC Pipeline — Frontend UI Plan

**Stack:** React + Vite + react-router-dom + shadcn/ui  
**New route:** `/cnc-pipeline`  
**Feature folder:** `src/features/cnc-pipeline/`  
**Goal:** MVP to test the Python backend end-to-end. No custom styling — use shadcn components as-is.

---

## 1. Sidebar addition

The existing sidebar has a "Sheet Metal" navigation item. Add a "CNC Pipeline" item directly below it following the exact same pattern as the Sheet Metal button.

File to edit: wherever the sidebar navigation links are defined (likely `src/components/sidebar.tsx` or similar layout file — the agent will find it by looking for where the Sheet Metal nav item is rendered).

Add this link in the same style as the existing Sheet Metal entry:

```tsx
<Link to="/cnc-pipeline">
  CNC Pipeline
</Link>
```

Use whatever nav item component pattern already exists for Sheet Metal. Do not invent a new pattern.

---

## 2. Route registration

File to edit: wherever react-router-dom routes are defined (likely `src/App.tsx` or `src/router.tsx`).

Add:
```tsx
import CNCPipelinePage from "@/features/cnc-pipeline/CNCPipelinePage"

// inside the Routes / router definition:
<Route path="/cnc-pipeline" element={<CNCPipelinePage />} />
```

---

## 3. Feature folder structure

Create exactly these files:

```
src/features/cnc-pipeline/
├── CNCPipelinePage.tsx       ← main page, top-level state
├── api.ts                    ← all fetch calls to the backend
├── types.ts                  ← TypeScript types shared across this feature
├── components/
│   ├── BackendStatus.tsx     ← shows if backend is online/offline
│   ├── DXFDropZone.tsx       ← file upload area
│   ├── ScenarioCard.tsx      ← shows detected layers, tool sequence, warnings
│   ├── LayerControls.tsx     ← checkboxes to toggle layer visibility
│   ├── GeometryViewer.tsx    ← SVG canvas showing DXF geometry
│   └── NCPreview.tsx         ← scrollable monospace NC text output
└── hooks/
    ├── useBackendHealth.ts   ← polls /api/health every 5s
    └── useGenerate.ts        ← manages the upload → result state machine
```

---

## 4. `types.ts`

```typescript
// src/features/cnc-pipeline/types.ts

export type Scenario =
  | "most_common"
  | "common"
  | "rare"
  | "very_rare"
  | "cut_only"

export interface GenerateResponse {
  job_id:           string
  filename:         string
  scenario:         Scenario
  layers_detected:  string[]
  tools_used:       number[]
  contour_count:    number
  lift_count:       number
  estimated_time:   number      // seconds
  warnings:         string[]
}

export interface PreviewResponse {
  nc_text: string
}

// One segment = a straight line from point A to point B, belonging to a layer
export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  layer: string
  // sequence index within the full cutting order (0-based)
  // set by the backend in the /api/geometry response
  seq_index: number
}

export interface GeometryResponse {
  segments:    Segment[]
  layers:      string[]           // all layer names present
  bbox: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
}

// Page-level state machine
export type PageState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "ready"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse }
  | { status: "generating" }
  | { status: "done"; jobId: string; generate: GenerateResponse; geometry: GeometryResponse; ncText: string }
  | { status: "error"; message: string }
```

---

## 5. `api.ts`

```typescript
// src/features/cnc-pipeline/api.ts

import type { GenerateResponse, GeometryResponse, PreviewResponse } from "./types"

const BASE = "/api"

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

// Upload DXF → get job_id + analysis + geometry in one shot
export async function uploadDXF(file: File): Promise<{
  generate: GenerateResponse
  geometry: GeometryResponse
}> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Upload failed")
  }
  return res.json()
}

export async function fetchNCText(jobId: string): Promise<string> {
  const res = await fetch(`${BASE}/preview/${jobId}`)
  if (!res.ok) throw new Error("Preview fetch failed")
  const data: PreviewResponse = await res.json()
  return data.nc_text
}

export function downloadURL(jobId: string): string {
  return `${BASE}/download/${jobId}`
}
```

> **Note for backend agent:** The `/api/generate` endpoint needs to return BOTH the `GenerateResponse` fields AND a `geometry` field containing the `GeometryResponse`. The geometry is needed by the frontend to render the DXF viewer. The backend must parse the DXF segments and return them with their `seq_index` (their position in the final cutting order) alongside the usual generate response. Alternatively, add a separate `/api/geometry/{job_id}` endpoint if you prefer to keep the generate response unchanged.

---

## 6. `hooks/useBackendHealth.ts`

```typescript
// src/features/cnc-pipeline/hooks/useBackendHealth.ts

import { useState, useEffect } from "react"
import { checkHealth } from "../api"

export function useBackendHealth(): boolean {
  const [online, setOnline] = useState(false)

  useEffect(() => {
    const check = () => checkHealth().then(setOnline)
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])

  return online
}
```

---

## 7. `hooks/useGenerate.ts`

```typescript
// src/features/cnc-pipeline/hooks/useGenerate.ts

import { useState, useCallback } from "react"
import { uploadDXF, fetchNCText } from "../api"
import type { PageState } from "../types"

export function useGenerate() {
  const [state, setState] = useState<PageState>({ status: "idle" })

  const upload = useCallback(async (file: File) => {
    setState({ status: "uploading" })
    try {
      const { generate, geometry } = await uploadDXF(file)
      setState({ status: "ready", jobId: generate.job_id, generate, geometry })
    } catch (e: any) {
      setState({ status: "error", message: e.message })
    }
  }, [])

  const generateNC = useCallback(async (jobId: string, generate: any, geometry: any) => {
    setState({ status: "generating" })
    try {
      const ncText = await fetchNCText(jobId)
      setState({ status: "done", jobId, generate, geometry, ncText })
    } catch (e: any) {
      setState({ status: "error", message: e.message })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: "idle" })
  }, [])

  return { state, upload, generateNC, reset }
}
```

---

## 8. `components/BackendStatus.tsx`

```tsx
// src/features/cnc-pipeline/components/BackendStatus.tsx

import { useBackendHealth } from "../hooks/useBackendHealth"
import { Badge } from "@/components/ui/badge"

export function BackendStatus() {
  const online = useBackendHealth()
  return (
    <Badge variant={online ? "default" : "destructive"}>
      {online ? "Backend online" : "Backend offline — run uvicorn main:app --port 8765"}
    </Badge>
  )
}
```

---

## 9. `components/DXFDropZone.tsx`

```tsx
// src/features/cnc-pipeline/components/DXFDropZone.tsx

import { useRef } from "react"
import { Button } from "@/components/ui/button"

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function DXFDropZone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.toLowerCase().endsWith(".dxf")) onFile(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ border: "2px dashed", padding: "2rem", textAlign: "center" }}
    >
      <p>Drop a .dxf file here or</p>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Browse
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        style={{ display: "none" }}
        onChange={handleChange}
      />
    </div>
  )
}
```

---

## 10. `components/ScenarioCard.tsx`

```tsx
// src/features/cnc-pipeline/components/ScenarioCard.tsx

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { GenerateResponse } from "../types"

const SCENARIO_LABELS: Record<string, string> = {
  most_common: "FREZ → CUT",
  common:      "HOLES → FREZ → CUT",
  rare:        "FREZ → FREZ_135 → CUT",
  very_rare:   "HOLES → FREZ → FREZ_135 → CUT",
  cut_only:    "CUT only",
}

interface Props {
  data: GenerateResponse
}

export function ScenarioCard({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis — {data.filename}</CardTitle>
      </CardHeader>
      <CardContent>
        <p><strong>Scenario:</strong> {SCENARIO_LABELS[data.scenario] ?? data.scenario}</p>
        <p><strong>Layers detected:</strong> {data.layers_detected.join(", ")}</p>
        <p><strong>Tools:</strong> T{data.tools_used.join(" → T")}</p>
        <p><strong>Contours:</strong> {data.contour_count}</p>
        <p><strong>Lifts:</strong> {data.lift_count}</p>
        <p><strong>Est. time:</strong> {Math.round(data.estimated_time)}s</p>
        {data.warnings.length > 0 && (
          <div>
            <p><strong>Warnings:</strong></p>
            <ul>
              {data.warnings.map((w, i) => (
                <li key={i}><Badge variant="destructive">{w}</Badge></li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

---

## 11. `components/LayerControls.tsx`

```tsx
// src/features/cnc-pipeline/components/LayerControls.tsx

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

// One fixed color per layer name — these are just for visual distinction in the viewer
export const LAYER_COLORS: Record<string, string> = {
  CUT:      "#22c55e",   // green
  FREZ:     "#a855f7",   // purple
  FREZ_135: "#f97316",   // orange
  HOLES:    "#f9ca01",   // yellow
  SHEETS:   "#6b7280",   // gray
  "0":      "#71717a",   // zinc
}

interface Props {
  layers:   string[]
  visible:  Record<string, boolean>
  onChange: (layer: string, value: boolean) => void
}

export function LayerControls({ layers, visible, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      {layers.map((layer) => (
        <div key={layer} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              background: LAYER_COLORS[layer] ?? "#fff",
            }}
          />
          <Checkbox
            id={`layer-${layer}`}
            checked={visible[layer] ?? true}
            onCheckedChange={(v) => onChange(layer, !!v)}
          />
          <Label htmlFor={`layer-${layer}`}>{layer}</Label>
        </div>
      ))}
    </div>
  )
}
```

---

## 12. `components/GeometryViewer.tsx`

This is the most complex component. It renders the DXF geometry as SVG, with:
- Per-layer color coding
- Layer visibility toggling
- Hover on a segment → shows its sequence number and the next segment number

```tsx
// src/features/cnc-pipeline/components/GeometryViewer.tsx

import { useState, useMemo } from "react"
import type { Segment, GeometryResponse } from "../types"
import { LAYER_COLORS } from "./LayerControls"

interface Props {
  geometry:   GeometryResponse
  visible:    Record<string, boolean>
}

export function GeometryViewer({ geometry, visible }: Props) {
  const [hoveredSeq, setHoveredSeq] = useState<number | null>(null)

  const { segments, bbox } = geometry
  const { min_x, min_y, max_x, max_y } = bbox

  const viewW = max_x - min_x
  const viewH = max_y - min_y

  // Padding around the geometry inside the SVG
  const PAD = viewW * 0.03

  const viewBox = `${min_x - PAD} ${min_y - PAD} ${viewW + PAD * 2} ${viewH + PAD * 2}`

  // SVG Y axis is flipped vs DXF — transform Y to flip vertically
  const flipY = (y: number) => max_y - y + min_y

  const visibleSegments = useMemo(
    () => segments.filter((s) => visible[s.layer] !== false),
    [segments, visible]
  )

  const hoveredSegment = hoveredSeq !== null
    ? segments.find((s) => s.seq_index === hoveredSeq)
    : null

  const nextSeq = hoveredSeq !== null ? hoveredSeq + 1 : null
  const nextSegment = nextSeq !== null
    ? segments.find((s) => s.seq_index === nextSeq)
    : null

  return (
    <div style={{ position: "relative" }}>
      {/* Hover tooltip */}
      {hoveredSegment && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "black",
            color: "white",
            padding: "4px 8px",
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div>Segment #{hoveredSeq! + 1} — layer: {hoveredSegment.layer}</div>
          {nextSegment && <div>Next: #{nextSeq! + 1} — layer: {nextSegment.layer}</div>}
          {!nextSegment && nextSeq !== null && <div>Next: end of program</div>}
        </div>
      )}

      <svg
        viewBox={viewBox}
        style={{ width: "100%", height: "100%", display: "block" }}
        // SVG default is Y-down; DXF is Y-up. We flip via transform on a group.
      >
        <g transform={`scale(1,-1) translate(0,${-(min_y + max_y)})`}>
          {visibleSegments.map((seg) => {
            const isHovered  = seg.seq_index === hoveredSeq
            const isNext     = seg.seq_index === nextSeq
            const color      = LAYER_COLORS[seg.layer] ?? "#ffffff"

            return (
              <line
                key={seg.seq_index}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={isHovered ? "#ffffff" : isNext ? "#facc15" : color}
                strokeWidth={isHovered || isNext ? 3 : 1.5}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredSeq(seg.seq_index)}
                onMouseLeave={() => setHoveredSeq(null)}
              />
            )
          })}

          {/* Sequence number label on hovered segment midpoint */}
          {hoveredSegment && (
            <text
              x={(hoveredSegment.x1 + hoveredSegment.x2) / 2}
              y={(hoveredSegment.y1 + hoveredSegment.y2) / 2}
              fontSize={viewW * 0.012}
              fill="white"
              textAnchor="middle"
              // flip the text back upright since we flipped the group
              transform={`scale(1,-1) translate(0,${-(hoveredSegment.y1 + hoveredSegment.y2)})`}
            >
              #{hoveredSeq! + 1}
            </text>
          )}
        </g>
      </svg>
    </div>
  )
}
```

---

## 13. `components/NCPreview.tsx`

```tsx
// src/features/cnc-pipeline/components/NCPreview.tsx

import { Button } from "@/components/ui/button"
import { downloadURL } from "../api"

interface Props {
  ncText:  string
  jobId:   string
  onReset: () => void
}

export function NCPreview({ ncText, jobId, onReset }: Props) {
  const lines = ncText.split("\n")

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
        <a href={downloadURL(jobId)} download>
          <Button>Download .nc</Button>
        </a>
        <Button variant="outline" onClick={onReset}>
          Generate another
        </Button>
        <span style={{ fontSize: 12, opacity: 0.6, alignSelf: "center" }}>
          {lines.length} lines
        </span>
      </div>
      <pre
        style={{
          height: 400,
          overflowY: "auto",
          fontSize: 12,
          lineHeight: 1.5,
          padding: "0.5rem",
          border: "1px solid",
        }}
      >
        {ncText}
      </pre>
    </div>
  )
}
```

---

## 14. `CNCPipelinePage.tsx` — the main page

This is the top-level component. It owns all state and composes the components above.

```tsx
// src/features/cnc-pipeline/CNCPipelinePage.tsx

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

import { BackendStatus }   from "./components/BackendStatus"
import { DXFDropZone }     from "./components/DXFDropZone"
import { ScenarioCard }    from "./components/ScenarioCard"
import { LayerControls }   from "./components/LayerControls"
import { GeometryViewer }  from "./components/GeometryViewer"
import { NCPreview }       from "./components/NCPreview"
import { useGenerate }     from "./hooks/useGenerate"
import { fetchNCText }     from "./api"

export default function CNCPipelinePage() {
  const { state, upload, generateNC, reset } = useGenerate()

  // Layer visibility — default all visible, updated when geometry loads
  const [visible, setVisible] = useState<Record<string, boolean>>({})

  const handleLayerToggle = (layer: string, value: boolean) => {
    setVisible((prev) => ({ ...prev, [layer]: value }))
  }

  // When geometry first loads, initialise all layers as visible
  const handleFile = async (file: File) => {
    setVisible({})  // reset visibility on new file
    await upload(file)
  }

  // Initialise visibility when geometry becomes available
  if (
    (state.status === "ready" || state.status === "done") &&
    state.geometry.layers.some((l) => !(l in visible))
  ) {
    const init: Record<string, boolean> = {}
    state.geometry.layers.forEach((l) => { init[l] = true })
    setVisible(init)
  }

  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>CNC Pipeline</h1>
        <BackendStatus />
      </div>

      <Separator />

      {/* IDLE — show drop zone */}
      {state.status === "idle" && (
        <DXFDropZone onFile={handleFile} />
      )}

      {/* UPLOADING */}
      {state.status === "uploading" && (
        <p>Uploading and analysing DXF…</p>
      )}

      {/* ERROR */}
      {state.status === "error" && (
        <div>
          <p style={{ color: "red" }}>{state.message}</p>
          <Button variant="outline" onClick={reset}>Try again</Button>
        </div>
      )}

      {/* READY or DONE — show analysis + viewer + optionally NC */}
      {(state.status === "ready" || state.status === "done") && (
        <>
          {/* Analysis card */}
          <ScenarioCard data={state.generate} />

          {/* Layer controls */}
          <Card>
            <CardHeader><CardTitle>Layers</CardTitle></CardHeader>
            <CardContent>
              <LayerControls
                layers={state.geometry.layers}
                visible={visible}
                onChange={handleLayerToggle}
              />
            </CardContent>
          </Card>

          {/* Geometry viewer */}
          <Card>
            <CardHeader><CardTitle>Geometry preview</CardTitle></CardHeader>
            <CardContent style={{ height: 500 }}>
              <GeometryViewer
                geometry={state.geometry}
                visible={visible}
              />
            </CardContent>
          </Card>

          {/* Generate NC button — only in ready state */}
          {state.status === "ready" && (
            <Button
              onClick={() => generateNC(state.jobId, state.generate, state.geometry)}
            >
              Generate NC program
            </Button>
          )}

          {/* GENERATING */}
          {state.status === "generating" && (
            <p>Generating NC program…</p>
          )}

          {/* NC output */}
          {state.status === "done" && (
            <Card>
              <CardHeader><CardTitle>NC Program</CardTitle></CardHeader>
              <CardContent>
                <NCPreview
                  ncText={state.ncText}
                  jobId={state.jobId}
                  onReset={reset}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
```

---

## 15. Backend contract addendum — what the backend must return from `/api/generate`

The frontend expects `/api/generate` to return a single JSON response with two top-level keys:

```json
{
  "generate": {
    "job_id":          "uuid",
    "filename":        "part.dxf",
    "scenario":        "most_common",
    "layers_detected": ["FREZ", "CUT"],
    "tools_used":      [9, 7],
    "contour_count":   5,
    "lift_count":      4,
    "estimated_time":  162,
    "warnings":        []
  },
  "geometry": {
    "segments": [
      { "x1": 35, "y1": 35, "x2": 200, "y2": 35, "layer": "FREZ", "seq_index": 0 },
      { "x1": 200, "y1": 35, "x2": 200, "y2": 100, "layer": "FREZ", "seq_index": 1 }
    ],
    "layers": ["FREZ", "CUT", "SHEETS", "0"],
    "bbox": {
      "min_x": 0, "min_y": 0, "max_x": 1250, "max_y": 3200
    }
  }
}
```

The `seq_index` on each segment is its position in the final cutting order (0-based across all layers and all contours in the order they will actually be machined). This is what drives the hover-to-see-sequence-number feature in `GeometryViewer`.

The backend already has the correct cutting order after `toolpath.py` runs — the segments just need to be flattened in that order and tagged with their index before being returned. Each segment in the geometry response corresponds to one straight-line move in the NC program.

---

## 16. Summary of what the agent needs to do

1. **Find the sidebar component** — add `CNC Pipeline` nav link below the Sheet Metal one using the exact same component pattern
2. **Find the router** — add the `/cnc-pipeline` route pointing to `CNCPipelinePage`
3. **Create** `src/features/cnc-pipeline/` with all files listed in Section 3
4. **Add Vite proxy** to `vite.config.ts` if not already there (see `init-and-structure.md` Section 8)
5. **Do not** create any new shadcn components — only use ones already installed (`Badge`, `Button`, `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Checkbox`, `Label`, `Separator`)
6. **Do not** add Tailwind classes beyond what is already in the existing codebase style — inline styles are fine for this MVP