# Research: CNC Bulk Upload & Download

> **Purpose**: This document is a research task — NOT an execution plan. An AI research agent should investigate all open questions below, then produce a separate **executable plan** for a third agent to implement.

---

## 1. Problem Statement

### Bug: `listAllForViewer` Convex query exceeds 16 MB read limit

When navigating to `/cnc-pipeline`, the `listAllForViewer` query fetches **every** `nc_programs` document across all the user's organizations and projects — including the massive `ncCode` (full G-code text), `geometryData` (all segments), `lineToSegmentMap`, `contoursByLayer`, and `stockBbox` fields. With many/large NC programs, this immediately hits Convex's 16 MB per-function-read limit.

**Why**: The index page (`routes/cnc-pipeline/index.tsx`) calls `useQuery(api.nc_programs.listAllForViewer, {})` and then renders cards with only `name`, `algorithm`, `scenario`, `estimatedTimeSeconds`, `isStarred`, `updatedAt`. It does NOT need the NC code, geometry, or contour data at all.

**Current query code** (`convex/nc_programs.ts:210`):
```ts
export const listAllForViewer = query({
  args: {},
  handler: async (ctx) => {
    // ... iterates all orgs → all projects → collects ALL nc_programs docs
    return allPrograms.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
```

### Feature: Bulk DXF upload → batch NC program generation → bulk download

Currently the pipeline accepts **one DXF at a time**. The user wants to:

1. **Drag & drop 10+ DXF files** onto the CNC pipeline page
2. Each file is **uploaded to the Python backend one-by-one** (sequential, not parallel — to avoid overloading the server)
3. Each generated NC program is **saved to Convex one-by-one** after generation completes
4. Users can **bulk download** all generated NC programs as a `.zip` file

---

## 2. Research Questions

### 2.1 — Fix `listAllForViewer` overflow (critical bug, must be solved first)

**Investigation needed:**

- **[R1]** What fields does the `/cnc-pipeline` index page actually render? Confirm: `name`, `algorithm`, `scenario`, `estimatedTimeSeconds`, `isStarred`, `updatedAt`, `dxfSourceName`, `_id`, `projectId`. It does NOT need `ncCode`, `geometryData`, `lineToSegmentMap`, `contoursByLayer`, `stockBbox`.

- **[R2]** Convex does not support field-level projection in queries. Can we create a **separate "summary" table** (e.g. `nc_program_summaries`) that stores only the lightweight display fields? Or should we switch to **pagination** with `db.query(...).paginate()`?

- **[R3]** If we use pagination on `listAllForViewer`: the current UI has no pagination controls — it's a simple card list. How many programs would typical users have? Is cursor-based pagination worth the UI complexity, or is a summary table simpler?

- **[R4]** Alternative: Can we add a Convex **index on `nc_programs`** that only covers summary fields, and use `db.query(...).withIndex(...).order("desc").collect()`? Research whether Convex indexes help limit bytes read or whether the full doc is always fetched.

- **[R5]** Check Convex docs / known patterns for "list large documents without heavy fields". Look at https://docs.convex.dev/database/reading-data#pagination and any community patterns for field projection or summary tables.

- **[R6]** The `listByProject` query also `.collect()`s all documents — does it hit the same limit? If a single project has many large programs, it would too. Check if that needs the same fix.

**Recommended approach to investigate**: A `nc_program_summaries` table populated via a Convex mutation (kept in sync when `saveNcProgram` / `updateNcProgram` / `deleteNcProgram` run). The index page queries the summary table only. This is the most robust approach because it completely avoids reading the heavy fields.

---

### 2.2 — Bulk DXF Upload

**Investigation needed:**

- **[R7]** Current `DXFDropZone` component (`components/DXFDropZone.tsx`) only accepts a single file:
  ```ts
  const file = e.dataTransfer.files[0]  // only takes first
  <input type="file" accept=".dxf" />   // no multiple attr
  ```
  Research: What's the minimal change to accept `multiple` files? The `onFile` callback signature is `(file: File) => void` — needs to become `(files: File[]) => void` or we add a separate `onFiles` callback. How does this affect the compact variant used in the navbar?

- **[R8]** The `useGenerate` hook (`hooks/useGenerate.ts`) manages a single `PageState` — it's a state machine for one file's lifecycle (`idle → uploading → generating → done`). For bulk, we need a **queue** abstraction. Research:
  - Should we create a new `useBulkGenerate` hook that manages an array of per-file states?
  - Or should we keep `useGenerate` untouched and build a queue orchestrator around it that calls `upload()` sequentially?

- **[R9]** The `CNCPipelinePage` component is a full page with a geometry viewer, NC preview, playback controls, etc. — it's designed for **one file at a time**. For bulk upload, where should the user drop files?
  - Option A: Drop on the `/cnc-pipeline` index page → creates all programs without ever opening the detailed viewer
  - Option B: Drop on `/cnc-pipeline/new` → shows a queue/progress UI instead of (or alongside) the single-file viewer
  - Option C: New dedicated page `/cnc-pipeline/batch`
  - Research: Which option best fits the current UX? What does the user see while files are processing?

- **[R10]** The current handleFile in `CNCPipelinePage.tsx` does: `upload(file, algorithm, backendToolOverrides)`. For bulk, each file needs to go through the same flow but one at a time. Research the exact sequential flow:
  ```
  for each file in queue:
    1. uploadDXF(file, algorithm, toolOverrides) → gets { generate, geometry }
    2. fetchNCText(generate.job_id) → gets ncText
    3. saveNcProgram({ ...all metadata, ncCode: ncText }) → gets convexId
    4. show success, proceed to next file
  ```
  Is this the correct flow? Are there steps missing (e.g. should the user be able to review/customize each file before saving)?

---

### 2.3 — Python Backend Capacity (Critical Research)

**Investigation needed:**

- **[R11]** Read `cnc-pipeline-backend/main.py` and `cnc-pipeline-backend/cnc_pipeline/pipeline.py` thoroughly. The `/api/generate` endpoint:
  - Accepts one file at a time (no batch endpoint exists)
  - Runs `run_pipeline()` synchronously (not async/queued)
  - Stores results in an **in-memory dict** (`_jobs: dict[str, PipelineResult]`) — lost on server restart
  - Uses `tempfile.NamedTemporaryFile` for the DXF — cleaned up after request
  
  Research: What is the typical generation time for a single DXF? Check if there are any logs, benchmarks, or timing info. If a typical file takes 5-10 seconds, 10 files sequentially would be 50-100 seconds — acceptable? What if the server is a small container with limited CPU?

- **[R12]** Does the backend support any form of concurrent requests? FastAPI runs with `uvicorn` which uses asyncio — the `/api/generate` endpoint is `async def` but `run_pipeline()` is CPU-bound and likely blocks the event loop. Research:
  - Is `run_pipeline()` truly CPU-bound? Does it release the GIL (e.g. uses numpy/shapely with C extensions that release the GIL)?
  - If we send requests sequentially from the frontend with `await`, does each request get its own server-side processing, or does it queue behind the GIL?
  - Should we intentionally add a delay/cooldown between requests to avoid overwhelming the backend?

- **[R13]** The backend has no authentication and no rate limiting. If we implement bulk upload, should we add basic rate limiting or request queuing on the backend side? Or is it sufficient to have the frontend control the rate?

- **[R14]** Research: Can/should we add a `/api/generate-batch` endpoint that accepts multiple files? This would allow the backend to control its own queue and rate. But it's more complex. Weigh the tradeoffs vs. frontend-controlled sequential requests.

- **[R15]** The in-memory `_jobs` dict is not scalable for bulk. After bulk generation, these job results are only needed temporarily (until the NC text is fetched and saved to Convex). Research: Is there a risk of the `_jobs` dict growing too large if many are stored simultaneously? (For sequential processing this is less of an issue since we fetch+save NC text before starting the next file.)

---

### 2.4 — Convex Bulk Save

**Investigation needed:**

- **[R16]** Convex mutations are called one at a time from the client. For 10 files, we'd call `saveNcProgram` 10 times sequentially. Research:
  - Can we batch Convex mutations in a single call? (Convex actions can call multiple mutations, but the client can't send a single "batch" mutation without a dedicated server function.)
  - Should we create a `saveNcProgramBatch` mutation that accepts an array and loops internally? This would be one Convex function call instead of 10, reducing overhead.
  - What are Convex's limits on mutation input size? Each NC program contains a large `ncCode` string + geometry data. A batch of 10 could be >16 MB input — hitting the same read limit but for writes.

- **[R17]** The current `saveNcProgram` has upsert logic (checks if a program from the same `dxfSourceName` exists). For bulk upload, do we want this dedup behavior, or should each file always create a new program? Research what the user expects.

- **[R18]** Convex function execution time limit is 5 minutes (for actions). For bulk generation + save, a single Convex action that calls the Python backend for each file would need to complete within 5 minutes. Research: Is this sufficient? If each file takes 10 seconds to generate + 1 second to save, 10 files = ~110 seconds — well within limits. But 50 files could be tight.

- **[R19]** Should we use a **Convex action** (can call external HTTP APIs) instead of calling the Python backend from the frontend? Currently the frontend calls the Python backend directly. For bulk, a Convex action could orchestrate the entire flow server-side: receive file URLs → call Python backend → save results. Research the tradeoffs:
  - Pros: Server-side orchestration, no browser tab dependency, can handle longer running
  - Cons: Need to store DXF files somewhere accessible to Convex (S3/Convex file storage), adds complexity
  
  This is likely over-engineering for now — the frontend sequential approach is simpler and sufficient.

---

### 2.5 — Bulk Download as .ZIP

**Investigation needed:**

- **[R20]** The sheet-metal feature already has .zip batch download using `JSZip`. Find and read the exact implementation in `src/routes/project.tsx` (lines ~95-145). Document the pattern:
  - How `JSZip` is initialized
  - How individual files are added to the zip
  - How `saveAs` (from `file-saver`) triggers download
  - Error handling per-file within the zip

- **[R21]** For CNC bulk download, the NC program content is stored in Convex (`ncCode` field), not generated client-side. Research: Do we need to fetch each program's NC code from Convex before zipping? This means:
  - The user selects programs on the index page
  - We query each program's `ncCode` (heavy — same overflow risk)
  - We add each `.nc` file to a JSZip
  - We trigger download
  
  Can we fetch NC codes on-demand using the existing `getById` query (one at a time) instead of the full `listAllForViewer`? Or should we have a dedicated query that returns only `ncCode` + `name` for given IDs?

- **[R22]** Alternative: The Python backend has a `/api/download/{job_id}` endpoint that returns a single `.nc` file. But this only works for in-memory recent jobs — NOT for previously saved programs. Research: Should we add a backend endpoint that can generate-download from stored data? Or just serve from Convex?

- **[R23]** Research: How big is a typical `.nc` file? (A G-code file for a complex part could be 100 KB to several MB). 10 files x 1 MB = 10 MB in memory for JSZip. Is this acceptable, or do we need streaming?

- **[R24]** The `package.json` already has `jszip` as a dependency. Confirm it's the same package used in sheet-metal and that `file-saver` is also available.

---

### 2.6 — UI/UX for Bulk Operations

**Investigation needed:**

- **[R25]** What does the `/cnc-pipeline` index page look like after the `listAllForViewer` fix? If we use a summary table, the card list stays the same but queries a lighter table. Should bulk upload happen from this page?

- **[R26]** Bulk upload progress UI options:
  - **Toast notifications**: Simple but disappears quickly
  - **Inline progress bar**: Show a queue panel on the index page with per-file status (pending / uploading / generating / saving / done / error)
  - **Dedicated modal/drawer**: Opens when bulk upload starts, shows progress, closes when done
  Research which fits best with the existing UI patterns in the app.

- **[R27]** After bulk upload completes, should the user be redirected to the index page to see all new programs? Or stay on the upload page?

- **[R28]** Bulk download: Should there be a multi-select UI on the index page (checkboxes on cards, "Download selected" button)? Or a select-all / per-project download option?

- **[R29]** Should bulk operations allow the user to select which **algorithm** to use for all files? Or should each file use the default/last-selected algorithm? What about custom tool sequences — can those be applied to all files in a batch?

---

### 2.7 — Edge Cases & Error Handling

**Investigation needed:**

- **[R30]** What happens if one file in a batch fails to generate (e.g. invalid DXF, backend error)? Should the batch:
  - Stop entirely and report the failed file?
  - Skip the failed file and continue with remaining files?
  - Retry the failed file N times then skip?
  Research the best UX pattern.

- **[R31]** What if the user navigates away during bulk processing? Should we warn them? Can we use `beforeunload` to prevent accidental navigation? Should there be a "cancel batch" button?

- **[R32]** What if the browser tab crashes or loses connection mid-batch? Is it acceptable to lose progress, or do we need persistent queue state (e.g. localStorage/sessionStorage)?

- **[R33]** The backend's in-memory `_jobs` dict means old job IDs get lost on server restart. If a user starts a bulk upload and the backend restarts mid-batch, what happens? Should we handle this gracefully?

---

## 3. Files to Investigate (for the research agent)

| File | What to study |
|---|---|
| `alugamma/convex/nc_programs.ts` | All queries/mutations — understand the overflow root cause, check `listByProject` too |
| `alugamma/convex/schema.ts` | `nc_programs` table schema, indexes — understand what can be optimized |
| `alugamma/src/routes/cnc-pipeline/index.tsx` | Dashboard page — what it renders, how it queries |
| `alugamma/src/features/cnc-pipeline/CNCPipelinePage.tsx` | Single-file generation page — understand the upload→generate→save flow |
| `alugamma/src/features/cnc-pipeline/hooks/useGenerate.ts` | State machine for single file — understand the lifecycle |
| `alugamma/src/features/cnc-pipeline/api.ts` | Python backend API client — all endpoints |
| `alugamma/src/features/cnc-pipeline/components/DXFDropZone.tsx` | Single-file drop zone — how to extend for multi-file |
| `cnc-pipeline-backend/main.py` | FastAPI endpoints — understand capacity, synchronous vs async, job storage |
| `cnc-pipeline-backend/cnc_pipeline/pipeline.py` | Core pipeline logic — understand CPU cost, timing |
| `alugamma/src/routes/project.tsx` | Sheet-metal .zip batch export — reuse pattern for CNC |
| `alugamma/convex/helpers.ts` | Auth/access patterns — needed if creating new queries/mutations |

---

## 4. Expected Research Output Structure

The research agent should produce a document structured as:

1. **Findings** — concise answers to each [R1]-[R33] question
2. **Architecture Decision** — for each major decision (summary table vs pagination, frontend vs backend queue, etc.), recommend one approach with rationale
3. **Risk Assessment** — what could go wrong, what limits we might hit
4. **Implementation Outline** — high-level ordered steps (NOT detailed code) that the execution agent will turn into an actionable plan

---

## 5. Constraints (do NOT research / change)

- Do NOT change the Python backend's generation algorithm logic
- Do NOT change the `nc_programs` table's existing field structure (adding a summary table is fine; modifying the existing table is not)
- Do NOT change how `$programId` (saved program viewer) works — it already fetches one program by ID and works fine
- Do NOT change the CNC pipeline's single-file page (`CNCPipelinePage`) — bulk is a separate flow on the index page
- Keep the Convex auth/access control patterns (`requireViewer`, `requireProjectManager`, `requireProjectAccess`)