# Execution Plan: CNC Bulk Upload & Download

> **Status**: Ready for implementation  
> **Estimated effort**: 1–2 focused sessions

---

## What we're building

Replace the `/cnc-pipeline` dashboard page: **remove the broken "Saved NC Programs" listing entirely**, and turn the page into a **bulk upload + download workspace**. The flow:

1. User drops multiple DXF files on the page
2. Files are processed **sequentially** (upload → generate → get NC text) one at a time
3. Each result is kept in memory and shown in a queue panel
4. Once done, user clicks **"Download .ZIP"** — zips up all generated `.nc` files and downloads
5. Optionally: "Save all to project" persists each program to Convex

No Convex query is needed for the listing. No summary table. No bug fix. The broken `listAllForViewer` is simply not called from this page anymore.

---

## Step-by-step implementation

### Step 1 — Extend `DXFDropZone` for multi-file

**File**: `alugamma/src/features/cnc-pipeline/components/DXFDropZone.tsx`

Add two new optional props:

```ts
interface Props {
  onFile: (file: File) => void
  onFiles?: (files: File[]) => void   // NEW: bulk callback
  disabled?: boolean
  compact?: boolean
  multiple?: boolean                  // NEW: enables multi-file
}
```

Changes:

1. `<input>` element: add `multiple={multiple}` (or `{...(multiple ? { multiple: true } : {})}`)
2. `handleDrop`: when `onFiles` is provided, collect **all** `.dxf` files from `e.dataTransfer.files` (use `Array.from`). When `onFiles` is not provided, keep existing single-file behavior with `files[0]`.
3. `handleChange`: when `multiple`, collect all selected files from `e.target.files`, call `onFiles`. Otherwise, take first file and call `onFile`.
4. In the large (non-compact) variant, update the display text from "Drop your DXF file here" → "Drop your DXF files here" when `multiple` is true. Update subtitle to "or click to browse files" (no change needed, already generic).

**Backward compat**: The compact variant (used in `CNCPipelinePage.tsx` navbar) doesn't pass `multiple`, so it works exactly as before. The `onFile` single-file path is untouched.

---

### Step 2 — Create `useBulkGenerate` hook

**File**: `alugamma/src/features/cnc-pipeline/hooks/useBulkGenerate.ts` (new file)

```ts
import { useState, useCallback, useRef } from "react"
import { uploadDXF, fetchNCText } from "../api"

export type BulkItemStatus =
  | "pending"
  | "uploading"
  | "generating"
  | "saving"
  | "done"
  | "error"

export interface BulkQueueItem {
  id: string                // crypto.randomUUID()
  file: File
  name: string              // file.name without .dxf extension — used as NC filename
  status: BulkItemStatus
  error?: string
  ncText?: string           // generated NC code (available when status is "done")
  convexId?: string        // ID of saved NC program (after optional save step)
}

export interface BulkState {
  items: BulkQueueItem[]
  isProcessing: boolean
  completedCount: number
  errorCount: number
  totalCount: number
}

const INITIAL_STATE: BulkState = {
  items: [],
  isProcessing: false,
  completedCount: 0,
  errorCount: 0,
  totalCount: 0,
}

export function useBulkGenerate() {
  const [state, setState] = useState<BulkState>(INITIAL_STATE)
  const abortRef = useRef(false)
  const itemsRef = useRef<BulkQueueItem[]>([])

  // Keep a ref in sync so processQueue always reads latest items
  // (avoids stale closure issues when processing async)
  itemsRef.current = state.items

  const addFiles = useCallback((files: File[]) => {
    const newItems: BulkQueueItem[] = files
      .filter(f => f.name.toLowerCase().endsWith(".dxf"))
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        name: file.name.replace(/\.dxf$/i, ""),
        status: "pending" as BulkItemStatus,
      }))

    if (newItems.length === 0) return

    setState(prev => {
      const updated = [...prev.items, ...newItems]
      return {
        items: updated,
        isProcessing: prev.isProcessing,
        completedCount: updated.filter(i => i.status === "done").length,
        errorCount: updated.filter(i => i.status === "error").length,
        totalCount: updated.length,
      }
    })
  }, [])

  const processQueue = useCallback(async (
    algorithm: string,
    toolOverrides?: Record<string, any>,
  ) => {
    abortRef.current = false
    setState(prev => ({ ...prev, isProcessing: true }))

    // Process all pending items sequentially
    // Read from ref to get latest state
    const pending = itemsRef.current.filter(i => i.status === "pending")

    for (const item of pending) {
      if (abortRef.current) break

      // Set status helper
      const setItemStatus = (id: string, patch: Partial<BulkQueueItem>) => {
        setState(prev => {
          const items = prev.items.map(i => i.id === id ? { ...i, ...patch } : i)
          return {
            ...prev,
            items,
            completedCount: items.filter(i => i.status === "done").length,
            errorCount: items.filter(i => i.status === "error").length,
          }
        })
      }

      try {
        // Step 1: Upload DXF → backend runs pipeline, returns geometry + metadata
        setItemStatus(item.id, { status: "uploading" })
        const { generate, geometry } = await uploadDXF(item.file, algorithm, toolOverrides)

        // Step 2: Fetch the generated NC text from the backend's in-memory store
        setItemStatus(item.id, { status: "generating" })
        const ncText = await fetchNCText(generate.job_id)

        // Done — NC text is now in memory, ready for download or save
        setItemStatus(item.id, { status: "done", ncText })
      } catch (e: any) {
        setItemStatus(item.id, { status: "error", error: e.message || "Unknown error" })
      }
    }

    setState(prev => ({ ...prev, isProcessing: false }))
  }, [])

  // Save all completed items to Convex, one at a time
  const saveAll = useCallback(async (
    saveNcProgram: (args: any) => Promise<any>,
    projectId: string,
    organizationId: string,
  ) => {
    const doneItems = itemsRef.current.filter(i => i.status === "done" && !i.convexId)

    for (const item of doneItems) {
      try {
        // We don't have the full generate metadata here, only the NC text
        // We need to store the generate response too. Let's add it to BulkQueueItem.
        // Actually, let's handle this in the component — see note below.
      } catch (e: any) {
        // Mark as error? Or just skip?
      }
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current = true
    setState(prev => {
      const items = prev.items.map(item =>
        item.status === "pending" || item.status === "uploading" || item.status === "generating"
          ? { ...item, status: "error" as BulkItemStatus, error: "Cancelled" }
          : item
      )
      return {
        ...prev,
        items,
        isProcessing: false,
        completedCount: items.filter(i => i.status === "done").length,
        errorCount: items.filter(i => i.status === "error").length,
      }
    })
  }, [])

  const clear = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return { state, addFiles, processQueue, cancel, clear }
}
```

**Important design note on `saveAll`**: To save programs to Convex, we need more than just `ncText` — we also need `algorithm`, `scenario`, `estimatedTimeSeconds`, `geometryData`, etc. These come from the `uploadDXF` response but are currently discarded. We should store the `generate` + `geometry` data in the `BulkQueueItem` so both download and save are possible. Update `BulkQueueItem`:

```ts
export interface BulkQueueItem {
  id: string
  file: File
  name: string
  status: BulkItemStatus
  error?: string
  ncText?: string
  generate?: GenerateResponse   // stored when generation succeeds
  geometry?: GeometryResponse    // stored when generation succeeds
  convexId?: string             // set after Convex save
}
```

And in `processQueue`, when setting status to `done`:

```ts
setItemStatus(item.id, {
  status: "done",
  ncText,
  generate,    // store the full response
  geometry,     // store the geometry
})
```

Now the `saveAll` function has all the data it needs.

Update `saveAll` implementation:

```ts
const saveAll = useCallback(async (
  saveNcProgram: (args: any) => Promise<any>,
  projectId: string,
  organizationId: string,
) => {
  const doneItems = itemsRef.current.filter(i => i.status === "done" && !i.convexId)

  for (const item of doneItems) {
    try {
      setState(prev => {
        const items = prev.items.map(i => i.id === item.id ? { ...i, status: "saving" as BulkItemStatus } : i)
        return { ...prev, items }
      })

      const gen = item.generate!
      const geo = item.geometry!
      const convexId = await saveNcProgram({
        projectId,
        organizationId,
        name: item.name,
        algorithm: gen.algorithm,
        scenario: gen.scenario,
        estimatedTimeSeconds: gen.estimated_time,
        ncCode: item.ncText!,
        dxfSourceName: item.file.name,
        geometryData: {
          segments: geo.segments,
          bbox: geo.bbox,
        },
        lineToSegmentMap: gen.line_to_segment_map || undefined,
        contoursByLayer: gen.contours_by_layer || undefined,
        stockBbox: gen.stock_bbox || undefined,
      })

      setState(prev => {
        const items = prev.items.map(i => i.id === item.id ? { ...i, status: "done" as BulkItemStatus, convexId } : i)
        return { ...prev, items }
      })
    } catch (e: any) {
      setState(prev => {
        const items = prev.items.map(i => i.id === item.id ? { ...i, status: "error" as BulkItemStatus, error: `Save failed: ${e.message}` } : i)
        return { ...prev, items }
      })
    }
  }
}, [])
```

---

### Step 3 — Create `BulkUploadPanel` component

**File**: `alugamma/src/features/cnc-pipeline/components/BulkUploadPanel.tsx` (new file)

Collapsible panel showing per-file progress and actions:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Check, X, Loader2, FileCode, AlertCircle, Download, Save } from "lucide-react"
import type { BulkState, BulkItemStatus } from "../hooks/useBulkGenerate"

interface Props {
  state: BulkState
  onCancel: () => void
  onClear: () => void
  onDownload: () => void
  onSaveAll: () => void
  hasProject: boolean   // whether a project is selected (enables save)
}

const STATUS_DISPLAY: Record<BulkItemStatus, { icon: JSX.Element; color: string }> = {
  pending:    { icon: <span className="text-slate-600 text-xs">⏳</span>, color: "text-slate-600" },
  uploading:  { icon: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />, color: "text-blue-400" },
  generating: { icon: <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />, color: "text-amber-400" },
  saving:     { icon: <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />, color: "text-emerald-400" },
  done:       { icon: <Check className="h-3.5 w-3.5 text-emerald-400" />, color: "text-emerald-400" },
  error:      { icon: <AlertCircle className="h-3.5 w-3.5 text-red-400" />, color: "text-red-400" },
}

export function BulkUploadPanel({ state, onCancel, onClear, onDownload, onSaveAll, hasProject }: Props) {
  if (state.items.length === 0) return null

  const progress = state.totalCount > 0
    ? ((state.completedCount + state.errorCount) / state.totalCount) * 100
    : 0

  const allDone = !state.isProcessing && state.completedCount + state.errorCount === state.totalCount
  const hasCompletedItems = state.completedCount > 0

  return (
    <Card className="bg-transparent border-white/10 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-white">
            {state.isProcessing
              ? `Processing (${state.completedCount + state.errorCount}/${state.totalCount})`
              : `Queue (${state.completedCount} done${state.errorCount > 0 ? `, ${state.errorCount} failed` : ""})`
            }
          </CardTitle>
          <div className="flex items-center gap-2">
            {!allDone && state.isProcessing && (
              <Button variant="ghost" size="sm" onClick={onCancel} className="text-red-400 hover:text-red-300 text-xs h-7">
                Cancel
              </Button>
            )}
            {allDone && (
              <Button variant="ghost" size="sm" onClick={onClear} className="text-xs h-7">
                Clear
              </Button>
            )}
          </div>
        </div>
        <Progress value={progress} className="h-1" />
      </CardHeader>
      <CardContent className="pt-2">
        {/* Queue items */}
        <div className="max-h-[300px] overflow-y-auto space-y-0.5">
          {state.items.map(item => {
            const display = STATUS_DISPLAY[item.status]
            return (
              <div key={item.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/5 text-xs">
                {display.icon}
                <FileCode className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="truncate flex-1 text-slate-300">{item.name}</span>
                {item.status === "error" && item.error && (
                  <span className="text-red-400 text-[10px] truncate max-w-[200px]">{item.error}</span>
                )}
                {item.status === "done" && (
                  <span className="text-emerald-400 text-[10px] font-mono">{item.ncText?.split("\n").length} lines</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Action buttons shown when queue is complete */}
        {allDone && hasCompletedItems && (
          <div className="flex items-center gap-2 pt-3 border-t border-white/10 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="text-xs border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-400 h-7"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .ZIP
            </Button>
            {hasProject && (
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveAll}
                className="text-xs border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400 h-7"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save all to project
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

---

### Step 4 — Rewrite the dashboard page

**File**: `alugamma/src/routes/cnc-pipeline/index.tsx`

Complete rewrite — remove the broken query and program listing, replace with bulk upload workspace:

```tsx
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { useWorkspace } from "@/features/workspace/context"
import { toast } from "sonner"
import JSZip from "jszip"
import { saveAs } from "file-saver"

import { DXFDropZone } from "@/features/cnc-pipeline/components/DXFDropZone"
import { BulkUploadPanel } from "@/features/cnc-pipeline/components/BulkUploadPanel"
import { useBulkGenerate } from "@/features/cnc-pipeline/hooks/useBulkGenerate"
import { Button } from "@/components/ui/button"
import { ArrowRight, Settings2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ALGORITHMS = [
  { value: "juggler_gemini", label: "Juggler G" },
  { value: "juggler_claude", label: "Juggler C" },
]

export default function CNCPipelineDashboardPage() {
  const { authenticated, selectedProjectId, selectedOrganizationId } = useWorkspace()
  const navigate = useNavigate()
  const saveNcProgram = useMutation(api.nc_programs.saveNcProgram)

  // Algorithm selection (persisted to localStorage)
  const [algorithm, setAlgorithm] = useState(
    () => localStorage.getItem("cnc_default_algorithm") || "juggler_gemini"
  )

  // Fetch org tool overrides (same as CNCPipelinePage)
  const cncSettings = useQuery(
    api.cnc_settings.getByOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip"
  )
  const toolOverrides = cncSettings?.toolOverrides

  // Bulk state
  const { state: bulkState, addFiles, processQueue, cancel, clear } = useBulkGenerate()

  // Auto-start processing when files are added
  useEffect(() => {
    if (
      bulkState.items.length > 0 &&
      !bulkState.isProcessing &&
      bulkState.items.some(i => i.status === "pending")
    ) {
      processQueue(algorithm, toolOverrides)
    }
  }, [bulkState.items.length, bulkState.isProcessing, algorithm, toolOverrides, processQueue])

  // Guard: warn before navigating away during processing
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (bulkState.isProcessing) e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [bulkState.isProcessing])

  // Handle files dropped/selected
  const handleFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    addFiles(files)
  }, [addFiles])

  // Download all completed items as .ZIP
  const handleDownload = useCallback(() => {
    const zip = new JSZip()
    let count = 0

    for (const item of bulkState.items) {
      if (item.status === "done" && item.ncText) {
        zip.file(`${item.name}.nc`, item.ncText)
        count++
      }
    }

    if (count === 0) {
      toast.error("No completed programs to download")
      return
    }

    zip.generateAsync({ type: "blob" }).then(content => {
      saveAs(content, `nc-programs-${new Date().toISOString().slice(0, 10)}.zip`)
      toast.success(`Downloaded ${count} NC program${count > 1 ? "s" : ""}`)
    })
  }, [bulkState.items])

  // Save all completed items to Convex (one at a time)
  const handleSaveAll = useCallback(async () => {
    if (!selectedProjectId || !selectedOrganizationId) {
      toast.error("Select a project first")
      return
    }

    const doneItems = bulkState.items.filter(i => i.status === "done" && !i.convexId && i.generate && i.geometry)
    if (doneItems.length === 0) {
      toast.info("Nothing to save")
      return
    }

    toast.info(`Saving ${doneItems.length} programs to project...`)
    let savedCount = 0

    for (const item of doneItems) {
      try {
        const gen = item.generate!
        const geo = item.geometry!
        await saveNcProgram({
          projectId: selectedProjectId,
          organizationId: selectedOrganizationId,
          name: item.name,
          algorithm: gen.algorithm,
          scenario: gen.scenario,
          estimatedTimeSeconds: gen.estimated_time,
          ncCode: item.ncText!,
          dxfSourceName: item.file.name,
          geometryData: { segments: geo.segments, bbox: geo.bbox },
          lineToSegmentMap: gen.line_to_segment_map || undefined,
          contoursByLayer: gen.contours_by_layer || undefined,
          stockBbox: gen.stock_bbox || undefined,
        })
        savedCount++
      } catch (e: any) {
        console.error(`Failed to save ${item.name}:`, e)
      }
    }

    if (savedCount > 0) {
      toast.success(`Saved ${savedCount} program${savedCount > 1 ? "s" : ""} to project`)
    } else {
      toast.error("Failed to save programs")
    }
  }, [bulkState.items, selectedProjectId, selectedOrganizationId, saveNcProgram])

  // Algorithm change handler
  const handleAlgorithmChange = (val: string) => {
    setAlgorithm(val)
    localStorage.setItem("cnc_default_algorithm", val)
  }

  if (!authenticated) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">CNC Pipeline</h1>
        <p className="text-slate-400">Please sign in to use the CNC pipeline.</p>
      </div>
    )
  }

  return (
    <div className="p-6 h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white tracking-tight">CNC Batch Pipeline</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/cnc-pipeline/new")}
            className="text-xs text-slate-400 hover:text-white"
          >
            Single file <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>

        {/* Algorithm selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Algorithm</span>
          <Select value={algorithm} onValueChange={handleAlgorithmChange} disabled={bulkState.isProcessing}>
            <SelectTrigger className="h-8 w-[160px] bg-black/20 border-white/10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map(a => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* DXF Drop Zone (multi-file) */}
        <DXFDropZone onFiles={handleFiles} multiple disabled={bulkState.isProcessing} />

        {/* Bulk Queue Panel */}
        <BulkUploadPanel
          state={bulkState}
          onCancel={cancel}
          onClear={clear}
          onDownload={handleDownload}
          onSaveAll={handleSaveAll}
          hasProject={!!selectedProjectId && !!selectedOrganizationId}
        />

      </div>
    </div>
  )
}
```

Key differences from the old page:
- **No `useQuery(api.nc_programs.listAllForViewer)`** — the broken query is gone
- **No program listing section** — removed entirely
- **DXFDropZone** now uses `onFiles` + `multiple` for bulk support
- **Algorithm selector** right on the page (no need to go to `/new` to pick one)
- **Link to `/cnc-pipeline/new`** for single-file detailed viewer
- **BulkUploadPanel** shows queue progress, download, and save actions

---

### Step 5 — (Optional) Remove dead code

After the rewrite, the following Convex query is no longer called from the frontend:

- `api.nc_programs.listAllForViewer` — no page uses it anymore

**Decide**: Keep it in `nc_programs.ts` for potential future use, or delete it. It's harmless to keep (it just won't be called). Recommend keeping it for now — deleting it is a one-line change later.

---

## How the bulk flow works end-to-end

```
User drops 5 DXF files
  │
  ▼
addFiles() → 5 BulkQueueItems with status "pending"
  │
  ▼
useEffect triggers processQueue()
  │
  ├─ Item 1: uploading → generating → done (ncText in memory)
  ├─ Item 2: uploading → generating → done
  ├─ Item 3: uploading → error (invalid DXF — skipped)
  ├─ Item 4: uploading → generating → done
  └─ Item 5: uploading → generating → done

BulkUploadPanel shows: 4 done, 1 failed
  │
  ├─ "Download .ZIP" → JSZip zips 4 .nc files → saveAs()
  └─ "Save all to project" → saveNcProgram × 4 → Convex

User can also drop MORE files while processing — they get added to the queue
and processed after the current batch.
```

---

## Files changed

| File | Action |
|---|---|
| `alugamma/src/features/cnc-pipeline/components/DXFDropZone.tsx` | Add `multiple` + `onFiles` props |
| `alugamma/src/features/cnc-pipeline/hooks/useBulkGenerate.ts` | **NEW** — queue state machine |
| `alugamma/src/features/cnc-pipeline/components/BulkUploadPanel.tsx` | **NEW** — progress + action panel |
| `alugamma/src/routes/cnc-pipeline/index.tsx` | **REWRITE** — remove listing, add bulk workspace |

**Files NOT changed**:
- `alugamma/convex/nc_programs.ts` — no schema/mutation changes needed
- `alugamma/convex/schema.ts` — no new tables
- `alugamma/src/features/cnc-pipeline/CNCPipelinePage.tsx` — single-file page untouched
- `cnc-pipeline-backend/` — no backend changes

---

## Implementation Checklist

- [ ] Step 1: Extend `DXFDropZone` with `multiple` + `onFiles`
- [ ] Step 2: Create `useBulkGenerate` hook in `hooks/useBulkGenerate.ts`
- [ ] Step 3: Create `BulkUploadPanel` component in `components/BulkUploadPanel.tsx`
- [ ] Step 4: Rewrite `cnc-pipeline/index.tsx` — remove listing, add bulk workspace
- [ ] Test: drop a single DXF, verify it processes and download works
- [ ] Test: drop 3+ DXF files, verify sequential processing
- [ ] Test: "Download .ZIP" produces a valid zip with .nc files
- [ ] Test: "Save all to project" saves to Convex (check dashboard)
- [ ] Test: invalid DXF file — should show error, others continue
- [ ] Test: cancel during processing
- [ ] Test: navigate away during processing — beforeunload fires
- [ ] Test: `/cnc-pipeline/new` still works normally (compact DXFDropZone unchanged)